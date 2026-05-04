# SouthernSky Engineering Blog

**Tech education blog at blog.southernsky.cloud — authored by J. Martin, Software Engineer at SouthernSky Cloud LLC.**

Practical, project-based tech education inspired by Network Chuck. Three content tiers, certification study tracks, agent-assisted content pipeline.

## Core Ethos

**Performative Exemplification:** Every post must BE what it teaches. A post about clean code is itself clean code. The blog's codebase exemplifies the engineering standards it teaches. The medium enacts the message.

**Constructivist Learning:** Teachers don't "teach" — learning happens on the student's side. Lead with curiosity ("why should you care?"), structure as guided discovery, let students arrive at insights through doing. Never lecture — ignite, then feed the fire.

When writing or reviewing posts, ask: "Does this post perform what it teaches? Would a curious student discover the insight themselves?"

## Live Deployment

| Target | URL | Port | Status |
|--------|-----|------|--------|
| **VPS** | https://blog.southernsky.cloud | 4006:3000 | LIVE (2026-05-01) |

## Stack

- **Astro 4** (markdown-first static site generator)
- **React 19** (interactive islands only — search widget, code playgrounds)
- **Tailwind CSS 3** + **@tailwindcss/typography** (prose styling)
- **nginx:alpine** container (same deploy pattern as all SouthernSky projects)

## Dev Commands

```bash
npm run dev          # Dev server on localhost:3458
npm run build        # Production build to dist/
npm run preview      # Preview production build
npm run check        # Validate content schemas (Zod)
npm run new-post     # Scaffold a new post with frontmatter template
```

## Project Structure

```
southernsky-blog/
├── src/
│   ├── content/              # Astro content collections
│   │   ├── config.ts         # Zod schemas (posts, authors, cert-tracks)
│   │   ├── posts/            # Markdown blog posts
│   │   │   ├── foundations/   # High school tier
│   │   │   ├── applied/      # College tier
│   │   │   └── professional/ # Career tier
│   │   ├── authors/          # Author YAML files
│   │   └── cert-tracks/      # Certification track definitions
│   ├── layouts/
│   │   ├── BaseLayout.astro  # HTML shell, meta tags, JSON-LD
│   │   ├── BlogPost.astro    # Individual post layout
│   │   └── ListLayout.astro  # Post listing pages
│   ├── pages/
│   │   ├── index.astro       # Homepage
│   │   ├── blog/             # Post routes
│   │   ├── category/         # Category listings
│   │   ├── tag/              # Tag listings
│   │   ├── cert-track/       # Study path pages
│   │   ├── about.astro       # About J. Martin
│   │   └── rss.xml.ts        # RSS feed
│   ├── components/           # Astro + React components
│   ├── styles/global.css     # Tailwind directives, prose overrides
│   └── lib/                  # Utilities (reading time, structured data, search index)
├── public/                   # Static assets (images, fonts, favicon)
├── scripts/                  # CLI tools (new-post, generate-hero, animate-hero, convert-animations)
├── CONTENT-PLAN.md           # 23 seed posts mapped from real projects
├── STRATEGY.md               # Distilled strategic playbook
├── research-content-strategy.md  # Early content strategy (in-project; 13+ newer research files in ~/tools/research/archive/)
├── DEV_OUTLINE.md            # Living roadmap — phases, analytics, distribution, research archive
├── DISTRIBUTION-PLAN.md      # Platform playbooks, timing, automation, compliance
├── Dockerfile                # nginx:alpine static container
├── docker-compose.yml        # VPS deployment (port 4006:3000)
└── nginx.conf                # SPA routing
```

## Content Model

### Post Frontmatter (Zod-enforced)

```yaml
---
title: "Post Title" # max 80 chars
description: "Meta description" # max 160 chars
publishDate: 2026-05-01
author: j-martin
tier: foundations | applied | professional
postType: tutorial | explainer | project-walkthrough | cert-study-notes | today-i-learned
difficulty: beginner | intermediate | advanced | expert
estimatedMinutes: 15
prerequisites: []
category: networking | web-development | cybersecurity | ai-ml | linux | cloud-computing | python | javascript-typescript | devops | career
tags: ["tag1", "tag2"]
certTracks: ["comptia-a-plus"] # optional
heroImage: "/images/posts/slug.webp" # optional
featured: false
draft: false
---
```

### Content Tiers

| Tier | Audience | Difficulty | Color |
|------|----------|------------|-------|
| Foundations | High school | Beginner | Green (#22c55e) |
| Applied | College | Intermediate | Blue (#3b82f6) |
| Professional | Career | Advanced/Expert | Amber (#f59e0b) |

### Categories (fixed, expand slowly)

networking, web-development, cybersecurity, ai-ml, linux, cloud-computing, python, javascript-typescript, devops, career

## Brand

- **Background:** slate-950 (#020617)
- **Cards:** slate-900 (#0f172a)
- **Brand blue:** #3b82f6 (SouthernSky primary)
- **Green accent:** #22c55e
- **Fonts:** Inter (body), JetBrains Mono (code)
- **Logo:** SouthernSky blue outlined cloud (port from SouthernSky project)

## Agent Content Pipeline

### Automated Pipeline (preferred — one command does everything)

When Justin says **"create a blog post about [topic]"**, run the full automated pipeline:

```bash
cd ~/projects/southernsky-blog
node scripts/blog-pipeline.mjs "topic description" [--tier applied] [--category ai-ml]
```

This chains all 6 stages automatically: Blog Writer → Blog Polish → Hero Image + Animation → Sanitization Sweep → Build Validation → Deploy to VPS.

Options: `--no-animate` (skip animation), `--no-deploy` (skip deploy), `--dry-run` (writer only, draft mode).

### Manual Workflow (individual steps when needed)

```
"Invoke the Blog Writer agent for [topic]"
  → Blog Writer agent researches + generates markdown
  → File saved to src/content/posts/{tier}/{slug}.md
"Invoke the Blog Polish agent on [path]"
  → Blog Polish agent reviews: reputation, tone, influence, structure
  → Polished file replaces original
node scripts/generate-hero.mjs <slug> --animate   → hero image + animated WebM (one-shot)
npm run check    → Zod validates frontmatter
node deploy.mjs  → Build + deploy to blog.southernsky.cloud
```

### Agents (Two Locations)

| Agent | Local (Claude Code) | Remote (chat.southernsky.cloud) |
|-------|--------------------|---------------------------------|
| **Blog Writer** | `~/.claude/agents/blog-writer.md` | ID: `blog-writer` |
| **Blog Polish** | `~/.claude/agents/blog-polish.md` | ID: `blog-polish` |

- **Search existing research** before invoking new queries: `node ~/tools/research/search-research.mjs "topic"` (FTS5, 501+ files)
- **Local agents** run via Claude Code subagent dispatch — no VPS needed, can research codebase directly
- **Remote agents** run on Grok API through Open WebUI — good for standalone use from any device
- Both share the same system prompts and guardrails

### Blog Writer

Generates complete Astro markdown with Zod-validated frontmatter. Has "Core Non-Negotiable Principles" guardrails:
1. Reputation awareness (no scraping, grey-hat, or hacking framing)
2. Audience sensitivity (students, educators, employers will read this)
3. Performative exemplification (post embodies what it teaches)
4. Strategic framing (first-person, portfolio-worthy, ethical)
5. Tier tone baseline (Foundations=encouraging, Applied=collaborative, Professional=experienced)
6. Pre-output checklist (verify all of the above before outputting)

### Blog Polish

Reviews posts through a 7-task checklist integrating influence techniques from The Architect (presuppositions, yes-sets, future pacing), Svengali (pacing/leading, ethical status), and Morpheus (truism chains, metaphor as vehicle). All techniques applied subtly and ethically in service of better learning outcomes.

### Full Pipeline (step by step)

1. Blog Writer agent generates markdown with complete frontmatter
2. Save to `src/content/posts/{tier}/{slug}.md`
3. Blog Polish agent reviews and refines (reputation, tone, influence)
4. `node scripts/generate-hero.mjs <slug> --animate` generates branded hero + animated WebM in one shot
   - Requires id8 server + ComfyUI running (`http://localhost:8802` + `http://localhost:8188`)
   - Without `--animate`: static hero only (use `node scripts/animate-hero.mjs <slug>` later)
5. Security sweep: grep for PII per `SANITIZATION-GUIDE.md` rules
6. `npm run check` validates frontmatter via Zod
7. Human review (Justin scans the diff)
8. `git commit` + `node deploy.mjs`

### Hero Image Pipeline

**Static heroes** (`scripts/generate-hero.mjs`):
- Maps post title/description to visual subject via keyword matching (30+ patterns)
- Calls Grok Imagine API with brand style (dark slate #0f172a bg, blue/green neon accents)
- Converts to 1200x630 WebP via ImageMagick
- Usage: `node scripts/generate-hero.mjs <slug>` or `--all` for batch

**Animated heroes** (`scripts/animate-hero.mjs` + id8 I2V):
- `animate-hero.mjs` handles the full animation lifecycle: copy to id8 input → queue I2V render → poll → convert to WebM
- id8 batch processor renders 3-second I2V clips (Wan 2.1 14B, 624x352, 24fps, 73 frames)
- Converts MP4 output → WebM (libvpx-vp9, 500k, CRF 35, crop to 1200x630)
- **One-shot:** `node scripts/generate-hero.mjs <slug> --animate` (generates static + animated in one command)
- **Standalone:** `node scripts/animate-hero.mjs <slug>` (queue + wait + convert)
- **Batch convert:** `node scripts/animate-hero.mjs --convert` (convert all completed renders)
- **Legacy:** `bash scripts/convert-animations.sh` (reads from id8 DB, same as animate-hero --convert)
- `AnimatedHero.astro` — progressive enhancement on post pages and homepage featured: static WebP first, video loaded via JS on `canplay`
- `PostCard.astro` — hover-to-animate on listing pages (homepage recent, category, tag pages). Desktop only via `matchMedia('(hover: hover)')`. Video created lazily on first hover, no bandwidth cost for un-hovered cards.
- Requires: id8 server running on port 8802, ComfyUI on port 8188

**OG Image:**
- Site-wide default: `/images/og-image.png` (1200x630, created with dedit editor at `~/tools/image-editor/`)
- Individual posts use their hero image as OG via `ogImage` prop
- BaseLayout falls back to the default when no `ogImage` is passed

**Gotchas:**
- `ffmpeg` in a `while read` loop eats stdin — always use `ffmpeg -nostdin`
- ffmpeg `pad` filter bakes letterbox bars into frames — use `crop` + `force_original_aspect_ratio=increase` when browser handles sizing via `object-fit: cover`
- Dynamically-created DOM elements can't use Tailwind classes (purged at build) — use inline styles
- `((count++))` returns exit code 1 when incrementing from 0 with `set -e` — use `count=$((count + 1))`
- id8 `batch.mjs` hardcodes portrait dimensions in INSERT — pass width/height explicitly via SQLite
- `certTracks` is optional in frontmatter — always use optional chaining: `p.data.certTracks?.includes()`

### Security Sanitization

All posts must pass sanitization before publishing. See `SANITIZATION-GUIDE.md` for full rules.

**Quick sweep** (run after writing new posts):
```bash
grep -rn '104\.243\.' src/content/posts/         # Real server IPs
grep -rn -i 'zeus\|hera\|atlas\|artemis' src/content/posts/  # Machine names
grep -rn '/home/danko' src/content/posts/         # Real username/paths
grep -rn '\.env-ai-keys' src/content/posts/       # Credential file paths
grep -rn -i 'tailscale' src/content/posts/        # VPN references
grep -rn '/mnt/sandisk\|/mnt/onyx' src/content/posts/  # Real mount paths
```

**Safe to keep:** GitHub username (StankyDanko), generic architecture descriptions, generic tool references.

## Deployment

Same pattern as all SouthernSky projects:
```bash
npm run build
podman build -t southernsky-blog:latest .
podman save southernsky-blog:latest | gzip > /tmp/southernsky-blog.tar.gz
scp /tmp/southernsky-blog.tar.gz jmartin@104.243.45.247:/tmp/
ssh jmartin@104.243.45.247 "gunzip -c /tmp/southernsky-blog.tar.gz | docker load && \
  docker stop southernsky-blog; docker rm southernsky-blog; \
  docker run -d --name southernsky-blog --restart unless-stopped -p 4006:3000 localhost/southernsky-blog:latest"
```

Caddy routes `blog.southernsky.cloud` → Docker bridge gateway:4006.

## Legal

- No brain dumps or simulated CompTIA/AWS exam questions
- "Aligned with objectives" language only — never imply official endorsement
- Original explanations, labs, and analogies
- No vendor logos without permission

## YouTube Channel (J. Kenneth Martin)

Full strategy in `YOUTUBE-STRATEGY.md`. The blog is the content engine that feeds the YouTube channel:
- Blog post → video script adaptation → OBS recording → DaVinci Resolve edit → YouTube publish
- Every video links back to its blog post for the written version
- Playlists function as modular curriculum (Computer Science 101, Web Dev Bootcamp, etc.)
- Channel serves dual purpose: developer audience + FRA teaching portfolio
- 30-video roadmap mapped to existing blog content categories
- Identity: J. Kenneth Martin (educator) is strictly firewalled from StankyDanko (creative)

## Related Projects

- `~/projects/SouthernSky/` — Company landing page (southernsky.cloud)
- `~/projects/fra/` — FRA demo site (fra-demo.southernsky.cloud)
- `~/projects/coach-martin/` — Educator portfolio (coachmartin.southernsky.cloud)
- `~/projects/kenneth-martin/` — Documentary + movement + brand (separate from YouTube educator channel)
