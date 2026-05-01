# SouthernSky Engineering Blog — Development Outline

## Status: LIVE at blog.southernsky.cloud (2026-05-01)

---

## Phase 1: Foundation (COMPLETE)

- [x] Astro 4 project scaffolded with content collections
- [x] Zod-validated post schema (title, tier, category, tags, certTracks, heroImage, etc.)
- [x] Three-tier content model: Foundations / Applied / Professional
- [x] BaseLayout with JSON-LD structured data
- [x] BlogPost layout with breadcrumbs, ToC sidebar, tag links, author footer
- [x] Header with nav links (Home, Foundations, Applied, Professional, Cert Tracks, About)
- [x] Footer, PostCard, DifficultyBadge components
- [x] Category pages (`/category/{tier}`) with getStaticPaths
- [x] Tag pages (`/tag/{tag}`)
- [x] Cert track index + detail pages (`/cert-track`, `/cert-track/{track}`)
- [x] About page with constructivist learning philosophy
- [x] RSS feed (`/rss.xml`)
- [x] 404 page with brand styling
- [x] Sitemap generation via @astrojs/sitemap
- [x] Dark theme: slate-950 background, Inter + JetBrains Mono fonts
- [x] Tailwind CSS 3 + @tailwindcss/typography for prose styling

## Phase 2: Content (COMPLETE)

- [x] 23 seed posts written (5 Foundations, 8 Applied, 10 Professional)
- [x] All posts drawn from real projects (OMNI, SaySee, Cairn, ZenoType, etc.)
- [x] 6 certification study tracks (A+, Net+, Sec+, Linux+, AWS SAA, Docker DCA)
- [x] FRA post rewritten — "Building a Professional Demo Site" (CDN scraping frame removed)
- [x] Author YAML with j-martin profile
- [x] Author headshot at public/images/posts/j-martin.webp (256x256 WebP)

## Phase 3: Deployment (COMPLETE)

- [x] Dockerfile (nginx:alpine container)
- [x] deploy.mjs pipeline (build → podman → SCP → docker load → run)
- [x] nginx.conf with `absolute_redirect off` (fixes Caddy reverse proxy redirects)
- [x] Caddy config on VPS (blog.southernsky.cloud → 172.28.0.1:4006)
- [x] DNS A record pointing to VPS
- [x] HTTPS working via Caddy ACME
- [x] 142 static pages, 3.25s build time

## Phase 4: Agent Pipeline (COMPLETE)

- [x] Blog Writer agent — generates complete Astro markdown with Zod frontmatter
  - System prompt at `~/projects/SouthernSky/src/agents/blog-writer.md`
  - Knowledge base at `blog-writer-knowledge.md`
  - Profile image at `blog-writer-v4.png`
  - "Core Non-Negotiable Principles" guardrails (6-point reputation/framing safety)
  - Deployed to chat.southernsky.cloud (ID: blog-writer, base: grok-4-1-fast)
  - Ported to local Claude Code agent at `~/.claude/agents/blog-writer.md`

- [x] Blog Polish agent — reviews posts for reputation, tone, and influence
  - System prompt at `~/projects/SouthernSky/src/agents/blog-polish.md`
  - Knowledge base at `blog-polish-knowledge.md`
  - Profile image at `blog-polish-v4.png`
  - 7-task checklist with Architect/Svengali/Morpheus influence toolkit
  - Deployed to chat.southernsky.cloud (ID: blog-polish, knowledge: 971dcc56)
  - Ported to local Claude Code agent at `~/.claude/agents/blog-polish.md`

- [x] Full workflow documented in CLAUDE.md:
  Blog Writer → Blog Polish → npm run check → human review → node deploy.mjs

## Phase 5: Visual Polish (COMPLETE)

- [x] Favicon — SouthernSky cloud icon (SVG + ICO fallback)
- [x] Real headshot on About page (replace "JM" initials)
- [x] Real headshot in BlogPost author footer
- [x] Hero images for all 23 posts via Grok Imagine
  - Style: dark backgrounds (#0f172a), blue/green accent glow, minimalist tech illustrations
  - 1200x630 WebP at quality 82 (OG-standard dimensions)
  - Agent deploy post regenerated with holographic portrait grid (inspired by StankyDanko portfolio)
- [x] heroImage rendering in BlogPost layout (full-width banner above title)
- [x] heroImage thumbnail in PostCard component
- [x] Featured post hero image on homepage
- [x] og:image meta tags using hero images (social sharing previews)
- [x] Trailing slashes on all internal nav links (fixes cached 301 redirect with :3000 port)
- [x] Build + deploy with visual updates

## Phase 6: Content Expansion (NEXT — 25 new posts)

- [ ] Research projects + git history for 25 new post ideas
- [ ] Priority: Foundations tier (fill out entry-level content for students/novices)
- [ ] Feature overview posts for major projects (Noita DM/Ukko, ZenoType, Cairn, etc.)
- [ ] Deep-dive posts on interesting commits (pman, psudo, etc.)
- [ ] Use Blog Writer + Blog Polish pipeline for each post
- [ ] Generate hero images via Grok Imagine for each new post
- [ ] Deploy in batches

## Phase 7: Animated Heroes via id8 (PLANNED — after Phase 6)

- [ ] Test id8 (ComfyUI + Wan 2.2) on one hero image — subtle 2-3s loop
- [ ] Format: WebM for web, fallback to static WebP
- [ ] Animation rules:
  - Individual post pages: animated hero banner (full-width)
  - Overview/listing pages: static thumbnails only (no chaos)
  - Homepage featured post: animated (it's the only large hero)
- [ ] If test passes: generate animated versions for all post heroes
- [ ] Implement `<video>` tag with autoplay/loop/muted in BlogPost layout
- [ ] PostCard keeps static `<img>` thumbnails

## Phase 8: Enhancement (PLANNED)

- [ ] Reading progress bar for long posts
- [ ] Social sharing buttons on post pages
- [ ] Newsletter/CTA prompt at bottom of posts (visit chat.southernsky.cloud)
- [ ] Search functionality (Pagefind or Fuse.js)
- [ ] Post series/navigation (prev/next within cert tracks)
- [ ] Dark/light theme toggle

## Key Lessons Learned

### nginx behind reverse proxy
`absolute_redirect off;` is mandatory when nginx runs inside a container behind Caddy. Without it, nginx generates 301 redirects with the internal container port (`:3000`), which breaks all directory URLs.

### Cached 301 redirects are permanent
Chrome caches 301 (permanent) redirects. If nginx ever sent a bad 301 with the container port (`:3000`), browsers remember it even after the server is fixed. Prevention: always use trailing slashes on internal links so nginx never issues the redirect in the first place.

### Astro asset paths
Astro outputs hashed assets to `_astro/`, not `assets/`. The nginx caching location block must match `/_astro/`.

### Content framing matters
AI-generated post titles can be technically accurate but reputationally dangerous. "Scraping a School's CDN" became "Building a Professional Demo Site." The Blog Writer now has 6-point guardrails and the Blog Polish agent provides a second layer of review.

### OWUI API paths
Trailing slash on OWUI model endpoints serves HTML (frontend catch-all). Correct paths: `GET /api/v1/models` (list), `POST /api/v1/models/create`, `POST /api/v1/models/model/update`.

### Hero image generation
Grok Imagine produces high-quality dark-mode tech illustrations. Use `--n 2` for options, pick the best. Convert to 1200x630 WebP at quality 82 for OG-standard dimensions. For agent/character grids, reference existing portfolio art for style consistency.

### Content doesn't have to be a historical record
Real project work inspires post content, but posts can be massaged for quality — the work inspires the content, the content doesn't have to be a forensic audit of the work. Creative freedom produces better educational material.
