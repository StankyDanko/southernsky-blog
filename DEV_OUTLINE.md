# SouthernSky Engineering Blog — Development Outline

**Living roadmap for blog.southernsky.cloud — from content creation to distribution to intelligent analytics.**

Last updated: 2026-05-02

---

## Current State

| Metric | Value |
|--------|-------|
| **Posts** | 49 (18 Foundations, 16 Applied, 15 Professional) |
| **Pages** | 228 static pages |
| **Cert Tracks** | 6 (A+, Net+, Sec+, Linux+, AWS SAA, Docker DCA) |
| **Heroes** | All 49 with static WebP + animated WebM |
| **Pipeline** | Blog Writer → Blog Polish → generate-hero --animate → deploy |
| **Deploy** | blog.southernsky.cloud (VPS port 4006, nginx:alpine, Caddy HTTPS) |
| **Status** | LIVE and share-ready |

---

## Completed Phases

### Phase 1: Foundation (COMPLETE)
- Astro 4 + React 19 islands + Tailwind CSS 3 + @tailwindcss/typography
- Zod-validated content schema (posts, authors, cert-tracks)
- Three-tier content model: Foundations / Applied / Professional
- Full page system: blog posts, categories, tags, cert tracks, about, RSS, sitemap, 404
- JSON-LD structured data, OG meta tags, canonical URLs
- Dark theme (slate-950), Inter + JetBrains Mono fonts

### Phase 2: Content (COMPLETE)
- 49 posts across all three tiers
- 6 certification study tracks with sequenced post lists
- Author profile with real headshot
- Content drawn from real projects (OMNI, SaySee, Cairn, ZenoType, dedit, etc.)
- Security sanitization sweep (no PII, real IPs, machine names)

### Phase 3: Deployment (COMPLETE)
- nginx:alpine container, deploy.mjs pipeline (build → podman → SCP → docker load)
- Caddy HTTPS with ACME on VPS
- GitHub repo (StankyDanko/southernsky-blog)

### Phase 4: Agent Pipeline (COMPLETE)
- Blog Writer agent (Grok API + local Claude Code) with 6-point guardrails
- Blog Polish agent (7-task influence/tone checklist)
- generate-hero.mjs → Grok Imagine → branded 1200x630 WebP
- animate-hero.mjs → id8 I2V → 3s WebM animation (one-shot via --animate)
- Full pipeline documented in CLAUDE.md

### Phase 5: Visual Polish (COMPLETE)
- Animated WebM heroes on all 49 posts (progressive enhancement)
- Hover-to-animate on post cards (desktop only, lazy video creation)
- OG image (1200x630 PNG, created with dedit editor)
- Mobile responsive: hamburger menu, overflow-x locked
- Favicon (SVG + ICO fallback)

---

## Active Phases

### Phase 6: Analytics Infrastructure

**Goal:** Privacy-first analytics that feeds an intelligent content decision system.

#### 6.1 Umami Setup (Self-Hosted)

Umami is open-source, cookieless, GDPR/CCPA compliant, MIT licensed, ~2KB script. Self-hosted on the existing VPS alongside other services.

**Architecture:**
```
blog.southernsky.cloud → tracking script → analytics.southernsky.cloud
                                              ↓
                                         Umami (Docker)
                                              ↓
                                         PostgreSQL
                                              ↓
                                         REST API
                                              ↓
                                    n8n workflows + AI agents
```

**Setup tasks:**
- [ ] Docker Compose: Umami + PostgreSQL on VPS
- [ ] Caddy route: analytics.southernsky.cloud → Umami container
- [ ] Add tracking script to BaseLayout.astro
- [ ] Change default admin password
- [ ] Add blog.southernsky.cloud as tracked website
- [ ] Configure UFW for analytics subdomain

**Custom events to implement:**
- [ ] Newsletter signup (with source property: sidebar, footer, post-end)
- [ ] Outbound clicks (URL, link text, source section)
- [ ] Scroll depth milestones (50%, 75%, 90% per post)
- [ ] Animated hero video play events
- [ ] Cert track navigation (which tracks readers explore)
- [ ] Search interactions (when search is implemented)
- [ ] Time-on-page milestones (30s, 1min, 3min, 5min for engagement scoring)

**Implementation pattern:**
```html
<!-- Data attribute (simple) -->
<button data-umami-event="Newsletter Signup" data-umami-event-source="footer">Subscribe</button>

<!-- JavaScript (dynamic) -->
<script>
umami.track('Scroll Depth', { percent: 75, page: location.pathname });
umami.track('Outbound Click', { url: link.href, source: 'article_body' });
</script>
```

#### 6.2 Google Search Console
- [ ] Verify blog.southernsky.cloud ownership
- [ ] Submit sitemap (already at /sitemap-index.xml)
- [ ] Monitor: impressions, clicks, CTR, average position
- [ ] Identify keyword opportunities (high impressions, low CTR = title/meta optimization)
- [ ] Detect content decay (declining impressions on older posts)

#### 6.3 KPIs for a Content Blog

**Primary (review weekly):**
| KPI | What It Tells You | Umami Source |
|-----|-------------------|--------------|
| Time on page (avg) | Are readers actually reading? | Stats API |
| Scroll depth completion | Do they finish the post? | Custom event |
| Newsletter signup rate | Converting readers to owned audience | Custom event + Goal |
| Returning visitors % | Are you building loyalty? | Cohort/retention |
| Referrer engagement quality | Which platforms send readers who stay? | Segments by referrer |

**Secondary (review monthly):**
| KPI | What It Tells You | Source |
|-----|-------------------|--------|
| Organic search growth | SEO compounding | GSC + Umami referrers |
| Top posts by engaged time | What topics resonate deeply | Umami pages sorted by time |
| Content decay (declining traffic) | What needs refreshing | GSC impressions trend |
| Bounce rate by source | Platform quality comparison | Umami segments |
| Device/geo distribution | Audience composition | Umami devices/locations |

**Vanity (don't optimize for):**
- Raw pageviews without engagement context
- Social follower counts
- Bounce rate in isolation (sometimes high bounce = reader found what they needed)

#### 6.4 Analytics Decision Framework

```
"What should I write next?"
  1. Check Umami: top pages by TIME SPENT (not views)
  2. Check GSC: rising impressions for topics you haven't covered deeply
  3. Check referrers: what topics do Reddit/X readers engage with most?
  4. Check newsletter: which post links get the most clicks in digests?
  → Write more in the intersection of high-engagement + growing search demand

"Which platform is working?"
  1. Filter Umami by referrer domain
  2. Compare: avg time on page, scroll depth, newsletter signup rate
  3. Platform with fewer clicks but higher engagement = higher value
  → Invest more time where quality > quantity

"Is this post dying?"
  1. GSC: impressions declining over 4+ weeks
  2. Umami: traffic trend for that path
  3. If declining: refresh content, update date, improve title/meta
  → Cert content decays fastest when exam versions change

"Should I double down or pivot?"
  1. Compare this month vs last month by content category
  2. Look for emerging topics (pages going from 0 to consistent traffic)
  3. Check if social spikes convert to newsletter (flash vs sustain)
  → SEO compounds; social spikes fade — weight decisions accordingly
```

---

### Phase 7: Distribution Infrastructure

**Goal:** Systematic content distribution across platforms with automation where it helps, human touch where it matters.

See [DISTRIBUTION-PLAN.md](DISTRIBUTION-PLAN.md) for the full platform strategy, timing, and playbooks.

#### 7.1 Account Setup
- [ ] X / Twitter — brand or personal account decision
- [ ] YouTube channel — SouthernSky Engineering
- [ ] Discord server — channel structure, bots (MEE6, Statbot)
- [ ] LinkedIn — company page or personal profile
- [ ] Dev.to — cross-posting with canonical URLs
- [ ] Bluesky — tech community presence
- [ ] Facebook — page (minimal investment)
- [ ] Buttondown or Beehiiv — newsletter platform
- [ ] Google Search Console — SEO monitoring

#### 7.2 Newsletter System
- [ ] Choose platform: Buttondown (Markdown-native, dev-friendly) or Beehiiv (growth features, free to 2,500)
- [ ] Design weekly format: post recap + exclusive tip + curated resource
- [ ] Add signup CTAs: blog header, post footer, about page, social bios
- [ ] Welcome email sequence (3-email drip introducing the blog and cert tracks)
- [ ] Content upgrades as lead magnets (downloadable study checklists, cheat sheets)
- [ ] RSS-to-newsletter automation via n8n or platform native

#### 7.3 Automation Flows (n8n)
n8n already runs on the VPS. Build these workflows:

- [ ] **RSS → Discord** — New post auto-announces in #announcements channel
- [ ] **RSS → Newsletter draft** — Queue in Buttondown/Beehiiv for Thursday digest
- [ ] **RSS → Social drafts** — Create draft posts in Typefully/Buffer for human review
- [ ] **Weekly analytics digest** — Pull Umami + GSC data, generate insight report
- [ ] **Content decay alert** — Flag posts with declining GSC impressions
- [ ] **404 monitor** — Alert on broken pages from Umami event data

#### 7.4 Content Repurposing Pipeline

One blog post becomes:
```
1. Blog post published (canonical)
2. Dev.to cross-post (24-48h later, after Google indexes)
3. X thread (key takeaways + code snippets + hook)
4. LinkedIn post (career/professional angle, link in first comment)
5. YouTube tutorial (screen recording + voiceover)
6. 3-5 YouTube Shorts (aha moments, tips, gotchas)
7. Newsletter inclusion (Thursday digest)
8. Discord announcement + discussion prompt
9. Bluesky + Threads mirrors of X thread
10. Reddit contribution (genuine, not link-drop)
```

**Tooling:**
| Tool | Purpose | Cost |
|------|---------|------|
| Typefully | X/Threads/Bluesky thread scheduling | ~$10-20/mo |
| Buffer | LinkedIn + Facebook scheduling | Free or ~$6/channel |
| CapCut / Descript | YouTube Shorts editing | Free tier |
| OBS / screen.studio | Screen recording for tutorials | Free / ~$15 one-time |
| Opus Clip / Munch | AI auto-extract Shorts from long-form | Affordable plans |

---

### Phase 8: Intelligent Analytics Agents

**Goal:** AI agents that read analytics data and generate actionable content strategy recommendations.

#### 8.1 Weekly Digest Agent
- **Trigger:** n8n cron, every Monday 8 AM
- **Data sources:** Umami API (pageviews, top pages, referrers, events, time-on-page), GSC API (impressions, clicks, positions), newsletter API (opens, clicks, growth)
- **Processing:** Aggregate metrics, compute week-over-week deltas, rank content by engagement score
- **AI layer:** Feed structured data to LLM → generate insights, recommendations, top performers
- **Output:** Markdown report delivered to Discord/email with:
  - Traffic summary (visitors, pageviews, returning %)
  - Top 5 posts by engagement (time spent, scroll completion)
  - Platform performance comparison (referrer quality)
  - Content recommendations (what to write, what to refresh)
  - Anomalies (traffic spikes, new referrers, broken pages)

#### 8.2 Content Performance Scorer
- **Trigger:** 7 days after each new post publish
- **Scoring model:** Weighted composite
  - Views: 20%
  - Avg time on page: 25%
  - Scroll depth completion: 20%
  - Newsletter signup conversion: 15%
  - Social engagement (if tracked): 10%
  - Returning visitor rate: 10%
- **Output:** Score card per post, comparison to category average, "replicate attributes of top scorers" recommendations

#### 8.3 SEO Opportunity Detector
- **Trigger:** Weekly
- **Logic:** Query GSC for pages with rising impressions but low CTR → title/meta optimization candidates. Query Umami for pages with steady organic traffic growth → create cluster content. Flag keyword opportunities from search queries driving impressions.
- **Output:** Prioritized list of SEO actions with confidence scores

#### 8.4 Content Decay Monitor
- **Trigger:** Monthly
- **Logic:** Compare 30-day rolling traffic per post against 90-day baseline. Flag posts with >30% decline. Priority flag for cert content when exam versions change.
- **Output:** Refresh queue with urgency ranking

#### Architecture
```
Umami API ──┐
GSC API ────┤
Newsletter ─┤──→ n8n workflow ──→ aggregate + score ──→ LLM analysis ──→ report
YouTube ────┤                                              ↓
X API ──────┘                                         PostgreSQL
                                                     (historical)
```

**What to automate vs keep human:**
| Automate | Human judgment |
|----------|---------------|
| Data collection + aggregation | Strategic pivots |
| Metric scoring + ranking | Content ideation/voice |
| Trend detection + flagging | Brand fit decisions |
| Draft insights + reports | Acting on recommendations |
| Anomaly alerts | Interpreting ambiguous patterns |

---

### Phase 9: Content Growth

#### 9.1 Publishing Cadence
- **Target:** 1-2 polished posts/week
- **Mix:** 1 deep tutorial/walkthrough + 1 TIL or explainer
- **Cert track posts:** minimum 1/month per active track
- **Pipeline:** Blog Writer → Blog Polish → generate-hero --animate → security sweep → npm run check → deploy

#### 9.2 Content Strategy Priorities
- **Foundations tier:** Fill out entry-level content for students/novices
- **Cert content:** CompTIA A+ and Network+ are highest search volume
- **Project walkthroughs:** Real builds from SouthernSky projects
- **"How I passed X" posts:** Personal experience = strong E-E-A-T signal
- **Home lab / self-hosted content:** Strong Reddit/HN audience overlap

#### 9.3 SEO Content Types That Rank
- "How I passed [cert] in [timeframe]" — personal experience
- "Complete guide to [technology]" — comprehensive, updated regularly
- "[Tool A] vs [Tool B] for [use case]" — comparison content
- "Common mistakes when [doing thing]" — problem-solving
- Lab walkthroughs with real terminal output — practical, searchable

#### 9.4 Cross-Posting Strategy (POSSE)
- Publish on blog first (canonical)
- Wait 24-48h for Google to index
- Cross-post to Dev.to with canonical_url back to blog
- Never duplicate full content without canonical — it dilutes SEO

---

### Phase 10: Feature Enhancements

#### 10.1 High Priority
- [ ] Newsletter signup CTA (header bar, post footer, dedicated page)
- [ ] Search functionality (Pagefind — static, no server needed)
- [ ] Social sharing buttons on post pages
- [ ] Reading progress bar for long posts
- [ ] Post series navigation (prev/next within cert tracks)
- [ ] "Related posts" section at bottom of each post
- [ ] Internal linking audit (every post links to 2-3 related posts)

#### 10.2 Medium Priority
- [ ] Interactive terminal (xterm.js) for CLI posts
- [ ] Content upgrades (downloadable PDFs behind newsletter signup)
- [ ] Comments system (Giscus — GitHub Discussions powered, free)
- [ ] "Last updated" date on posts (freshness signal for SEO)
- [ ] Reading time estimates on post cards (already in frontmatter)

#### 10.3 Future Vision
- [ ] Dark/light theme toggle
- [ ] Gamification — badges for track completion
- [ ] "Wall of Success" for reader cert pass testimonials
- [ ] Family-friendly tier (parents + teens together)
- [ ] Interactive code playgrounds (React islands)

---

### Phase 11: Research Knowledge Management (COMPLETE)

**Goal:** Transform the growing research archive from timestamped logs into a discoverable, cross-project knowledge asset.

**Completed 2026-05-02:**
- [x] Centralized all research into `~/tools/research/archive/` (501+ files from 13 scattered locations)
- [x] Built `research.db` — SQLite FTS5 index across all content (title, prompt, content, project)
- [x] Built `search-research.mjs` — CLI search tool with project/date filters
- [x] Built `build-research-db.mjs` — full indexer with auto project inference
- [x] Separated non-research files into `~/tools/research/system/`
- [x] Updated all AI scripts (grok-research, gemini-deep-research, query-agent, trinity-query) to save to `~/tools/research/archive/`
- [x] Updated all CLAUDE.md files (global, OMNI, blog, trading) with search-first rule
- [x] Added backwards-compat symlink `~/tools/logs → ~/tools/research/archive/`
- [x] Created README.md for `~/tools/research/`

#### 11.6 Future Enrichment (not yet started)
- [ ] Naming convention migration: timestamp + semantic slug via Ollama
- [ ] YAML frontmatter enrichment: auto-generate title/summary/topics/tags per file
- [ ] Qdrant vector index for semantic similarity search (beyond keyword FTS5)
- [ ] Hybrid retrieval: FTS5 + vector similarity + metadata filters

---

### Phase 12: Research Engine (Active)

**Goal:** Autonomous research engine that proactively generates and executes research queries against Grok and Gemini APIs, continuously building the knowledge base. Standalone Node.js tool at `~/tools/research/`, automatable via cron when ready.

**Location:** `~/tools/research/research-engine.mjs`

#### 12.1 Core Engine — Manual Queue (BUILD FIRST)
The engine operates as a queue: add topics, run them back-to-back, review results.

**CLI interface:**
```bash
# Queue specific research topics
node research-engine.mjs add "topic description" --api gemini
node research-engine.mjs add "topic description" --api grok

# Let the engine find what needs researching (scans projects, finds gaps)
node research-engine.mjs add --auto

# Queue management
node research-engine.mjs list                    # show queue
node research-engine.mjs move <id> <position>    # reorder
node research-engine.mjs pause                   # pause execution
node research-engine.mjs resume                  # resume
node research-engine.mjs cancel <id>             # remove item
node research-engine.mjs clear                   # clear pending items

# Execution
node research-engine.mjs run                     # execute next item
node research-engine.mjs run --continuous         # run until queue empty
node research-engine.mjs status                  # what's running, queue depth

# Review
node research-engine.mjs review                  # show unreviewed research
node research-engine.mjs review --mark <id>      # mark as reviewed
```

**Queue state:** `~/tools/research/queue.json` — persistent, survives crashes.

**Execution flow per item:**
```
Queue item → Choose API (Grok instant / Gemini async poll)
           → Execute query
           → Save to archive/ with full content
           → Auto-index into research.db (FTS5)
           → Tag to relevant projects (LLM-inferred)
           → Add to review queue
           → Log execution metadata (time, cost estimate, API used)
           → Move to next queue item
```

- [ ] Build research-engine.mjs with queue management (add/list/move/pause/cancel)
- [ ] Implement Grok execution path (direct, synchronous)
- [ ] Implement Gemini Deep Research execution path (async polling)
- [ ] Auto-index new files into research.db after each execution
- [ ] Review queue tracking (unreviewed items, mark as reviewed)
- [ ] Test with simple prompts to verify end-to-end flow
- [ ] Test with real research topics and review output quality

#### 12.2 Gap Detection — Auto Research (BUILD SECOND)
When `--auto` is used, the engine scans projects and identifies knowledge gaps.

**Gap detection flow:**
```
Scan ~/projects/*/CLAUDE.md + README.md → Extract objectives/goals
                                        → Query research.db for coverage
                                        → Identify uncovered topics
                                        → Ollama scores candidates by relevance × impact × novelty
                                        → Top candidates added to queue
```

- [ ] Build project scanner: parse CLAUDE.md/README.md for goals and current state
- [ ] Build gap detector: compare goals against archive coverage via FTS5
- [ ] Build query generator: Ollama drafts research prompts from gaps
- [ ] Build candidate scorer: rank by relevance, impact, novelty
- [ ] Redundancy guard: reject candidates with >75% similarity to existing research
- [ ] Test gap detection against real projects, review candidate quality
- [ ] Iterate on scoring prompts until candidates are consistently high-quality

#### 12.3 Future: Automation and Budget Management (DEFER)
Once the engine works well manually, add automated scheduling and budget pacing.

- [ ] Cron-triggered nightly batch (2-4 Gemini queries while Zeus idles)
- [ ] Event-driven triggers (git commit or CLAUDE.md change → quick Grok gap-fill)
- [ ] API budget tracker: `api_usage` table in research.db, daily/monthly pacing
- [ ] Budget-aware scheduling: daily_target = remaining / remaining_days × 0.92
- [ ] Economy mode at 80% monthly spend (fewer deep queries, more local synthesis)
- [ ] Weekly research digest: auto-generated summary of highest-impact new research
- [ ] Project state sensor: detect meaningful project evolution, shift priorities
- [ ] n8n integration if orchestration needs outgrow cron (future, VPS optional)

---

## Key Lessons Learned

### Infrastructure
- `absolute_redirect off` in nginx behind Caddy — prevents 301 with container port
- Trailing slashes on all internal links — prevents cached 301 redirects
- `overflow-x: hidden` on html + body — prevents mobile horizontal scroll
- Prose code blocks need `overflow-x-auto` — prevents wide code from breaking mobile layout

### Content Pipeline
- ffmpeg in while-read loops eats stdin — always use `ffmpeg -nostdin`
- ffmpeg pad bakes letterbox bars — use crop + force_original_aspect_ratio=increase
- Tailwind purges classes from JS-created elements — use inline styles
- `((count++))` returns exit code 1 from 0 under set -e — use `count=$((count + 1))`
- Grok Imagine always outputs 1024x1024 — resize with ImageMagick to 1200x630
- id8 batch requires explicit width/height in SQLite INSERT

### Content Philosophy
- Content doesn't have to be forensic audit of real work — creative freedom produces better education
- Performative exemplification: the post must BE what it teaches
- Constructivist learning: create conditions for discovery, don't lecture
- Personal voice + real costs/failures = strong E-E-A-T signal
- AI drafts + human editing = best quality/velocity balance

### Distribution (from research)
- LinkedIn suppresses external links in post body — put in first comment
- Reddit bans self-promotion — build karma through genuine participation first
- Email subscribers > social followers for long-term value
- First-hour engagement signals algorithms on every platform
- Quality > quantity across all platforms in 2026
- Canonical URLs on cross-posts are non-negotiable for SEO

---

## Research Archive

All research logs are centralized at `~/tools/research/archive/`. The grok-research.mjs script saves output there regardless of which project the research was run from.

| Date | Topic | File (in ~/tools/research/archive/) |
|------|-------|------------------------|
| 2026-05-01 | Content strategy + Network Chuck analysis | In-project: research-content-strategy.md |
| 2026-05-01 | Blog polish influence techniques | In-project: research-blog-polish-strategy.md |
| 2026-05-02 | Platform timing + scheduling | grok-research-custom-2026-05-02T12-39-01.md |
| 2026-05-02 | Distribution tools + automation | grok-research-custom-2026-05-02T12-40-00.md |
| 2026-05-02 | Growth tactics + channel strategy | grok-research-custom-2026-05-02T12-41-22.md |
| 2026-05-02 | AI analytics automation architecture | grok-research-custom-2026-05-02T13-25-14.md |
| 2026-05-02 | Umami analytics deep dive | grok-research-custom-2026-05-02T13-25-24.md |
| 2026-05-02 | Analytics-driven content strategy | grok-research-custom-2026-05-02T13-28-05.md |
| 2026-05-02 | Newsletter growth mechanics | grok-research-custom-2026-05-02T13-31-29.md |
| 2026-05-02 | SEO keyword research methodology | grok-research-custom-2026-05-02T13-31-39.md |
| 2026-05-02 | YouTube production pipeline | grok-research-custom-2026-05-02T13-31-42.md |
| 2026-05-02 | Content repurposing workflow | grok-research-custom-2026-05-02T13-31-56.md |
| 2026-05-02 | Discord community management | grok-research-custom-2026-05-02T13-32-05.md |
| 2026-05-02 | Competitive landscape + differentiation | grok-research-custom-2026-05-02T13-32-09.md |
| 2026-05-02 | Research archive optimization strategy | grok-research-custom-2026-05-02T13-48-12.md |

---

## Related Documents

| Document | Purpose |
|----------|---------|
| [CLAUDE.md](CLAUDE.md) | Technical reference, pipeline commands, gotchas |
| [STRATEGY.md](STRATEGY.md) | Core ethos, SEO strategy, monetization roadmap |
| [DISTRIBUTION-PLAN.md](DISTRIBUTION-PLAN.md) | Platform playbooks, timing, automation stack |
| [CONTENT-PLAN.md](CONTENT-PLAN.md) | Original 23 seed post ideas mapped from projects |
| [SANITIZATION-GUIDE.md](SANITIZATION-GUIDE.md) | PII/security sweep rules for content |
