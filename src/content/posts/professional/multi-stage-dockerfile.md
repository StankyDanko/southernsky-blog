---
title: "Multi-Stage Dockerfile: From 1.2GB to 180MB"
description: "OMNI's Docker image was 1.2GB. Three stages — deps, build, runtime — brought it to 180MB. Here's the exact Dockerfile with annotations."
publishDate: 2026-03-18
author: j-martin
tier: professional
postType: tutorial
difficulty: advanced
estimatedMinutes: 14
prerequisites: ["docker-basics"]
category: devops
tags: ["docker", "dockerfile", "optimization", "nextjs", "deployment", "containers"]
certTracks: ["aws-saa", "docker-dca"]
featured: false
draft: false
---

## Why Should You Care?

A 1.2GB container image means slower CI, slower deploys, and more attack surface. It also means your image pull on cold start takes 3 minutes instead of 30 seconds when you're trying to recover from an incident at 2am.

OMNI's production image went through exactly this problem. The initial Dockerfile was naive — one stage, full Node.js base, everything dumped in. The result: 1.2GB of dev dependencies, build tooling, and source files that the runtime never needs.

Multi-stage builds fix this by treating your container like a build pipeline: each stage does its job and hands off only what the next stage needs. The final image sees none of the intermediate cruft.

Here's the exact process, with the before/after image sizes and the reasoning behind every decision.

---

## The Before State

The original single-stage Dockerfile:

```dockerfile
# BEFORE — naive single-stage
FROM node:20

WORKDIR /app

COPY . .

RUN npm install
RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]
```

```
$ docker images omni-web
REPOSITORY   TAG       IMAGE ID       CREATED        SIZE
omni-web     latest    a3f9c2d81b4e   2 minutes ago  1.21GB
```

What's in that 1.21GB:
- Node 20 Debian base: ~340MB
- Full `node_modules` including devDependencies: ~620MB
- Source files, TypeScript, test files: ~180MB
- `.next/cache`, intermediate build artifacts: ~70MB

None of the dev tooling, TypeScript compiler, or build cache needs to exist in the final running container. The app only needs the compiled output and its production dependencies.

---

## The Three-Stage Approach

```
Stage 1: deps
  └─ Install production + dev node_modules (layer-cached)

Stage 2: build
  └─ Copy source + deps, run next build, emit standalone output

Stage 3: runtime
  └─ Alpine base + standalone output only → shipped image
```

Each stage starts from scratch. Only explicit `COPY --from=<stage>` directives move artifacts between stages.

---

## The Dockerfile

```dockerfile
# syntax=docker/dockerfile:1

# ─── Stage 1: deps ──────────────────────────────────────────────────────────
# Install node_modules in isolation. This layer is cached as long as
# package.json and package-lock.json don't change — which is most builds.
FROM node:20-alpine AS deps

WORKDIR /app

# Copy lockfiles ONLY — not source. This is the cache key.
# If only source changes, this entire layer hits cache.
COPY package.json package-lock.json ./

RUN npm ci --frozen-lockfile


# ─── Stage 2: build ─────────────────────────────────────────────────────────
# Full build environment. Has dev dependencies (TypeScript, ESLint, etc.)
# Produces the .next/standalone output and nothing else we care about.
FROM node:20-alpine AS build

WORKDIR /app

# Bring in node_modules from the deps stage (already installed, cached)
COPY --from=deps /app/node_modules ./node_modules

# Now copy source — this layer invalidates on any source change,
# but deps layer above is still cached
COPY . .

# next.config.js must set output: 'standalone' for this to work
# NEXT_TELEMETRY_DISABLED prevents build-time network calls
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build


# ─── Stage 3: runtime ───────────────────────────────────────────────────────
# Minimal Alpine base. No dev tools, no source, no node_modules bloat.
# Only what Next.js standalone needs at runtime.
FROM node:20-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Non-root user for security
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# The standalone output includes its own minimal node_modules
# (only production deps actually imported at runtime)
COPY --from=build /app/.next/standalone ./

# Static assets and public dir are NOT included in standalone — copy separately
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

USER nextjs

EXPOSE 3000

# standalone outputs a server.js at the root
CMD ["node", "server.js"]
```

---

## The next.config.js Requirement

The standalone output is a Next.js feature, not a Docker trick. You have to opt in:

```javascript
// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',

  // other config...
  images: {
    domains: ['cdn.example.com'],
  },
};

module.exports = nextConfig;
```

What `output: 'standalone'` does: instead of requiring the full `node_modules` at runtime, Next.js traces the actual imports and bundles only the modules that will be executed. The trace output lives at `.next/standalone/node_modules` and is typically 20–40MB for a mid-sized app vs. 500MB+ for the full tree.

The standalone server entry point is `.next/standalone/server.js`. The Dockerfile copies the entire `standalone/` directory to get both the server and its traced dependencies in one `COPY`.

---

## Size Progression

```
$ docker build --target deps   -t omni-web:deps   .
$ docker build --target build  -t omni-web:build  .
$ docker build --target runtime -t omni-web:latest .

$ docker images omni-web
REPOSITORY   TAG       IMAGE ID       CREATED          SIZE
omni-web     latest    9c1f44a7b2d0   12 seconds ago   181MB   ← ships
omni-web     build     e8a342c91f6b   45 seconds ago   1.24GB  ← never ships
omni-web     deps      d3b9a11c0e7a   2 minutes ago    932MB   ← never ships
```

The `build` and `deps` tagged images are intermediates useful for debugging. In CI you'd only tag and push `runtime`.

---

## Layer Cache Strategy

The cache ordering is deliberate:

```dockerfile
# 1. Copy lockfiles only (rarely changes)
COPY package.json package-lock.json ./
RUN npm ci                          # ← cached on most builds

# 2. Copy source (changes every build)
COPY . .
RUN npm run build                   # ← always runs
```

If you `COPY . .` before `npm ci`, every source change busts the install cache. That's an extra 60–90 seconds per build for no reason. Always copy the minimum required for each RUN command, then expand.

In practice, the deps layer cache hit rate is ~95% — only dependency updates (which happen infrequently) invalidate it.

---

## The Deployment Pipeline

OMNI runs on a VPS that doesn't have a container registry. The deploy pattern is: build locally → export → SCP → load → restart.

```bash
#!/usr/bin/env bash
# deploy.mjs equivalent in bash for illustration

set -euo pipefail

IMAGE="omni-web"
TAG="$(git rev-parse --short HEAD)"
SERVER="jmartin@104.243.45.247"
REMOTE_PATH="/opt/omni"

echo "Building $IMAGE:$TAG..."
podman build -t "$IMAGE:$TAG" -t "$IMAGE:latest" .

echo "Exporting image..."
podman save "$IMAGE:latest" | gzip > "/tmp/$IMAGE.tar.gz"
# 181MB image → ~68MB compressed

echo "Uploading to server..."
scp "/tmp/$IMAGE.tar.gz" "$SERVER:$REMOTE_PATH/"

echo "Loading and restarting..."
ssh "$SERVER" "
  cd $REMOTE_PATH
  docker load < $IMAGE.tar.gz
  docker compose up -d --no-deps --pull never omni-web
"

echo "Deploy complete: $IMAGE:$TAG"
```

The compressed transfer is 68MB. That's the real win: 1.2GB image compresses to ~350MB and takes nearly 3 minutes to upload on a typical connection. 181MB compresses to 68MB and transfers in 35 seconds.

---

## Debugging Multi-Stage Builds

When something breaks in the build stage, you don't want to run the full pipeline to debug it. Target a specific stage:

```bash
# Drop into the build stage to inspect artifacts
podman build --target build -t omni-web:debug .
podman run --rm -it omni-web:debug sh

# Inspect the standalone output
/app/.next/standalone $ ls -lh
total 148K
drwxr-xr-x  node_modules/     # traced deps only
-rw-r--r--  package.json
-rw-r--r--  server.js         # entry point

/app/.next/standalone $ du -sh node_modules/
38M     node_modules/         # vs 620MB in the original
```

If `server.js` is missing, `output: 'standalone'` isn't set in `next.config.js`. If the app crashes at runtime with module-not-found errors, a dynamic require is escaping the static trace — add it to `serverExternalPackages` in `next.config.js`.

---

## Common Pitfalls

**Pitfall 1: Missing static files**

The standalone output does NOT include `.next/static` or `public/`. If you forget those two `COPY` lines in the runtime stage, the app starts but serves no CSS, no images, no client-side JS.

```dockerfile
# Both of these are required
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
```

**Pitfall 2: Build-time env vars vs runtime env vars**

Next.js bakes `NEXT_PUBLIC_*` variables into the client bundle at build time. If you need different values per environment (staging vs. production), you either need separate builds or a runtime injection pattern (write a `__ENV.js` file and load it in `_document.tsx`).

Server-side env vars can be provided at runtime via `docker compose` — no rebuild needed.

**Pitfall 3: Root running the container**

The `USER nextjs` line isn't optional on a production system. Running as root means any path traversal vulnerability in your app has immediate filesystem access. Add the user, change the user, ship it that way.

---

## What You Learned

- **Multi-stage builds separate concerns:** install, build, and runtime are distinct phases with different dependencies — model them as distinct stages.
- **The cache key is the lockfile, not the source:** copy `package*.json` before your source to maximize layer cache hits and avoid reinstalling dependencies on every source change.
- **Next.js standalone output is the critical enabler:** without `output: 'standalone'`, you'd need to copy the full `node_modules` into the runtime stage, and most of the size reduction evaporates.
- **The real deployment win is transfer size:** 181MB compresses to 68MB. That 5x reduction compounds across every deploy — faster pipelines, faster incident response, lower bandwidth costs.
- **Target stages for debugging:** `--target build` lets you inspect intermediate artifacts without running the full pipeline.
