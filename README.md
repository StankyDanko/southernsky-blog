# SouthernSky Engineering Blog

**Practical tech education from a working software engineer.**

Live at [blog.southernsky.cloud](https://blog.southernsky.cloud)

## What Is This

A tech education blog with 48 posts across three tiers — Foundations (high school), Applied (college), and Professional (career). Project-based tutorials, certification study tracks, and real-world infrastructure insights.

Built with Astro 4, Tailwind CSS, and deployed as an nginx:alpine container.

## Features

- **48 blog posts** with Zod-validated frontmatter and structured content
- **Animated hero images** — id8 I2V renders (Wan 2.1), progressive enhancement via WebM
- **Hover-to-animate** post cards on desktop (lazy-loaded, no mobile)
- **6 certification study tracks** (CompTIA A+, Network+, Security+, Linux+, AWS SAA, Docker DCA)
- **Agent content pipeline** — Blog Writer + Blog Polish agents for assisted authoring
- **OG image** and structured data (JSON-LD) for social sharing
- **RSS feed** at /rss.xml

## Quick Start

```bash
npm install
npm run dev          # Dev server on localhost:3458
npm run build        # Production build
npm run check        # Validate content schemas
```

## Content Pipeline

```
Blog Writer agent → markdown with frontmatter
Blog Polish agent → reputation/tone/influence review
generate-hero.mjs  → branded 1200x630 WebP hero image
id8 I2V batch      → animated WebM hero (convert-animations.sh)
Security sweep     → grep for PII per SANITIZATION-GUIDE.md
npm run check      → Zod validation
node deploy.mjs    → Build + deploy to VPS
```

## Deployment

```bash
node deploy.mjs    # Builds, containerizes, ships to VPS
```

Deploys to blog.southernsky.cloud (port 4006) via Caddy reverse proxy.

## Tech Stack

- **Astro 4** — markdown-first static site generator
- **React 19** — interactive islands (search)
- **Tailwind CSS 3** + @tailwindcss/typography
- **nginx:alpine** — production container
- **ffmpeg** — WebM video conversion (libvpx-vp9)

## Content Tiers

| Tier | Audience | Posts | Color |
|------|----------|-------|-------|
| Foundations | High school | 18 | Green |
| Applied | College | 15 | Blue |
| Professional | Career | 15 | Amber |

## License

All content copyright J. Martin / SouthernSky Cloud LLC.
