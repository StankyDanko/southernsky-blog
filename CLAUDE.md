# SouthernSky Engineering Blog

**Tech education blog at blog.southernsky.cloud — authored by J. Martin, Software Engineer at SouthernSky Cloud LLC.**

Practical, project-based tech education inspired by Network Chuck. Three content tiers, certification study tracks, agent-assisted content pipeline.

## Live Deployment

| Target | URL | Port | Status |
|--------|-----|------|--------|
| **VPS** | https://blog.southernsky.cloud | 4006:3000 | Not yet deployed |

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
├── scripts/                  # CLI tools (new-post, validate, search-index)
├── CONTENT-PLAN.md           # 23 seed posts mapped from real projects
├── STRATEGY.md               # Distilled strategic playbook
├── research-content-strategy.md  # Full Grok research
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

1. Blog Writer agent (chat.southernsky.cloud) generates markdown with complete frontmatter
2. Save to `src/content/posts/{tier}/{slug}.md`
3. `npm run check` validates frontmatter via Zod
4. Human review (Justin scans the diff)
5. `git commit` + `node deploy.mjs`

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

## Related Projects

- `~/projects/SouthernSky/` — Company landing page (southernsky.cloud)
- `~/projects/fra/` — FRA demo site (fra-demo.southernsky.cloud)
- `~/projects/coach-martin/` — Educator portfolio (coachmartin.southernsky.cloud)
