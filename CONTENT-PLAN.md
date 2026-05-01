# SouthernSky Engineering Blog — Content Plan

## Seed Content: 23 Posts from Real Projects (Feb–May 2026)

Posts are backdated to actual project ship dates. Dates TBD from `git log` across repos.

### Foundations Tier (High School)

| # | Title | Category | Type | Difficulty | Est. Min | Source Project |
|---|-------|----------|------|------------|----------|----------------|
| 1 | What Is the Internet, Really? A Tour of the Cables Under Your Feet | networking | explainer | beginner | 8 | Home Lab |
| 2 | What Is a Reverse Proxy and Why Does Every Developer Need One? | networking | explainer | beginner | 10 | Caddy/VPS |
| 3 | Backups Are Boring Until You Lose Everything — Here's My 5-Tier System | linux | project-walkthrough | beginner | 10 | Backup System |
| 4 | What Is GPU Power Management and Why Should You Care? | linux | today-i-learned | beginner | 7 | GPU Service |
| 5 | You Don't Need the Cloud: Building a Personal AI Lab on a Single Machine | ai-ml | explainer | beginner | 12 | Ollama/Zeus |

### Applied Tier (College)

| # | Title | Category | Type | Difficulty | Est. Min | Source Project |
|---|-------|----------|------|------------|----------|----------------|
| 6 | How I Deployed 90+ AI Agents with Zero Repetitive Clicking | ai-ml | project-walkthrough | intermediate | 18 | SouthernSky Chat |
| 7 | Bandwidth Monitoring with vnstat and systemd Timers | linux | tutorial | intermediate | 10 | Bandwidth Monitor |
| 8 | Real-Time AI Typing Coach — Building ZenoType | javascript-typescript | project-walkthrough | intermediate | 15 | ZenoType |
| 9 | Scraping a School's CDN for Real Photos — FRA Demo Build | web-development | project-walkthrough | intermediate | 14 | FRA Demo |
| 10 | Audio Fingerprinting at Scale: Building a 5-Second Ambient Sound Classifier | ai-ml | project-walkthrough | intermediate | 18 | Cairn |
| 11 | Building a Home Lab Dashboard with Preact, Express 5, and SQLite | web-development | project-walkthrough | intermediate | 16 | dankMire |
| 12 | 5-Stage AI Prompt Engine: Building an Automated Newsletter System | ai-ml | project-walkthrough | intermediate | 15 | Agent Newsletters |
| 13 | Selective Face Recognition for Documentary Privacy | ai-ml | project-walkthrough | intermediate | 14 | Tactical ID Mgmt |

### Professional Tier (Career)

| # | Title | Category | Type | Difficulty | Est. Min | Source Project |
|---|-------|----------|------|------------|----------|----------------|
| 14 | Fusing 25 Live Data Feeds on a 3D Globe — Layer Pipeline Architecture | web-development | project-walkthrough | advanced | 25 | OMNI |
| 15 | Imperative vs Declarative 3D: Why CesiumJS Crashes at Scale | web-development | today-i-learned | advanced | 12 | OMNI |
| 16 | Race Conditions in Cesium Click Handlers — A Three-Week Bug Story | web-development | today-i-learned | expert | 14 | OMNI |
| 17 | Zustand at Scale: 4-Slice Architecture for a Real-Time Platform | web-development | explainer | advanced | 16 | OMNI |
| 18 | Building a Production API Proxy: Rate Limiting, Caching, and SSRF Protection | cybersecurity | tutorial | advanced | 16 | OMNI |
| 19 | Natural Language Commanding: Building an NLP Action Dispatcher | ai-ml | project-walkthrough | advanced | 20 | OMNI/LENS |
| 20 | Multi-Stage Dockerfile: From 1.2GB to 180MB | devops | tutorial | advanced | 14 | OMNI Deploy |
| 21 | SaaS Billing with Stripe — Checkout, Webhooks, Tier Sync | web-development | tutorial | advanced | 18 | Market Data |
| 22 | Documentary Beat Indexing — 17-Class Scene Taxonomy with FCP XML | ai-ml | project-walkthrough | advanced | 16 | ScorsAI |
| 23 | Building a Video Intelligence Pipeline: Scene Detection + Audio + Face Recognition | ai-ml | project-walkthrough | expert | 22 | SaySee+Cairn+TacID |

## Certification Track Alignment

| Track | Aligned Posts |
|-------|-------------|
| CompTIA A+ | #1, #3, #4, #5 |
| CompTIA Network+ | #1, #2, #7 |
| CompTIA Security+ | #13, #18 |
| CompTIA Linux+ | #3, #4, #7 |
| AWS SAA | #20 |
| Docker DCA | #20 |

## Content Velocity Plan

- **Launch backfill:** 23 posts backdated across Feb–Apr 2026
- **Ongoing cadence:** 2 posts/week (agent-drafted, human-polished)
- **Mix:** 1 tutorial/walkthrough + 1 TIL or explainer per week
- **Cert track posts:** 1 per month minimum to build study paths

## Agent Content Pipeline

1. Blog Writer agent (Open WebUI) generates markdown with complete frontmatter
2. Save to `src/content/posts/{tier}/{slug}.md`
3. `npx astro check` validates frontmatter via Zod
4. Quick human review (Justin scans the diff)
5. `git commit` + `node deploy.mjs`

## Lead Magnets (Phase 2)

- Free cert study checklist PDFs (one per track)
- "30 Days to Network+" challenge tracker
- Home lab setup guide PDF
- Project starter templates (GitHub repos)

## Legal Notes

- CompTIA prohibits brain dumps and AI-generated practice exams mimicking real questions
- Use "aligned with CompTIA objectives" language, never imply official endorsement
- Create original explanations, labs, and analogies — never simulate actual exam content
- Do not use CompTIA logos without permission
