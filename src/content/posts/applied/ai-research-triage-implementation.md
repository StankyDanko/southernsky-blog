---
title: "From Research to Pull Requests: Automating Triage and Implementation with AI"
description: "Turn raw research into scored triage cards and draft PRs with a three-stage pipeline that runs on cron."
publishDate: 2026-05-02
author: j-martin
tier: applied
postType: project-walkthrough
difficulty: intermediate
estimatedMinutes: 18
prerequisites: []
category: ai-ml
tags: ["ai", "automation", "triage", "sqlite", "github", "pull-requests", "pipeline", "cron"]
certTracks: []
featured: false
heroImage: "/images/posts/ai-research-triage-implementation.webp"
draft: false
---

> This is **Part 2** of a three-part series on building an AI-powered development workflow. [Part 1](/blog/ai-research-pipeline) covers the research engine that feeds this pipeline. Part 3 will cover the browser dashboard that surfaces everything visually.

## Why Should You Care?

Research is only as valuable as the action it produces. If you followed Part 1, you have a system that scans your projects for knowledge gaps, queues deep research, and saves structured reports to disk. But a folder full of Markdown files is not a backlog. Nobody triages a research archive with 500+ files by hand. The research just sits there, aging.

This post covers the second and third stages of the pipeline: a triage system that reads each research report, extracts scored action items aligned to your project roadmaps, and an implementation engine that picks the top-scoring item, creates a feature branch, invokes Claude Code headlessly, and opens a draft PR. The whole thing runs three times a day via cron, unattended.

---

## The Three-Stage Sweep

The entry point is a single bash script on a cron schedule:

```bash
# crontab -e
0 5,12,18 * * * ~/research/research-sweep.sh
```

Three times daily at 5 AM, noon, and 6 PM, the sweep runs three stages in sequence:

```bash
#!/bin/bash
set -euo pipefail

# Cron doesn't source .bashrc — load API keys manually
if [ -f "$HOME/.env-keys" ]; then
  set -a
  source "$HOME/.env-keys"
  set +a
fi

LOG="/tmp/research-sweep.log"
echo "Research sweep started: $(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG"

# Stage 1: Scan projects for knowledge gaps, queue + run research
node ~/research/research-engine.mjs auto --queue --run >> "$LOG" 2>&1
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  # Rebuild full-text search index after new research lands
  node ~/research/search-research.mjs --rebuild >> "$LOG" 2>&1

  # Stage 2: Triage new research against project DEV_OUTLINEs
  node ~/research/research-triage.mjs --pending >> "$LOG" 2>&1 || true

  # Stage 3: Autonomous implementation (opt-in)
  if [ "${RESEARCH_AUTO_IMPLEMENT:-0}" = "1" ]; then
    node ~/research/research-implement.mjs \
      --next --budget "${RESEARCH_IMPLEMENT_BUDGET:-1.50}" >> "$LOG" 2>&1 || true
  fi
fi
```

Stage 1 is the research engine from Part 1 -- it scans projects for knowledge gaps and runs deep research. Stages 2 and 3 are the focus of this post. Notice that Stage 3 is gated behind `RESEARCH_AUTO_IMPLEMENT=1`. When you are first building this, you want to review triage output manually before letting an AI write code from it. Trust is earned incrementally.

---

## Stage 2: Research Triage

### The Problem

You already know this feeling: a research report on "scaling a Preact SPA with Express 5 and SQLite" lands at 8,000 words. Some of that is background theory. Some is relevant to your project. Some is scope creep disguised as a good idea. Without a filter, every finding feels equally urgent. You need a system that reads the research, compares it against your project's roadmap, and extracts only the items that advance your current milestone.

### How `research-triage.mjs` Works

The script has four modes:

```bash
$ node research-triage.mjs <file>       # Triage a single research file
$ node research-triage.mjs --pending    # Triage all untriaged completed queue items
$ node research-triage.mjs --list       # Show all triage results
$ node research-triage.mjs --actionable # Show only high-scoring items
```

The `--pending` flag is what cron uses. It reads `queue.json`, finds completed research items that have not been triaged yet, and processes each one.

### Project Detection

Before triaging, the script needs to know which project this research belongs to. It tries three strategies:

1. **Queue metadata** — if the research came from the auto-scanner, the queue entry contains the project context in its topic string.
2. **Filename pattern matching** — a lookup table maps filename fragments to project names.
3. **Content analysis** — the first 2,000 characters of the research are scanned for project references.

```javascript
const projectPatterns = {
  'blog': 'my-blog',
  'dashboard': 'admin-dashboard',
  'api': 'payment-api',
  'typing': 'typing-coach',
  'portfolio': 'portfolio-site',
  // ... add your own project patterns
};

// Try filename first, then content
for (const [pattern, project] of Object.entries(projectPatterns)) {
  if (filenameLower.includes(pattern)) return project;
}
```

Once the project is identified, the script loads that project's `DEV_OUTLINE.md` — the roadmap document that defines phases, milestones, and non-goals. This is the triage anchor. Without it, the LLM has no way to judge whether a research finding is relevant or scope creep.

### The Triage Prompt

The heart of the system is a structured prompt that forces the LLM to produce scored JSON. Here is the shape of it:

```text
You are a research triage analyst for a solo developer.
Extract ONLY actionable items from this research that
directly advance the project's DEV_OUTLINE.

## Project DEV_OUTLINE (my-project)
[... first 5000 chars of DEV_OUTLINE.md ...]

## Research Report
[... first 15000 chars of the research file ...]

## Triage Instructions
For each item:
1. Title (imperative form)
2. Category: technique | pattern | architecture | gotcha | dependency | optimization
3. Description (2-3 sentences)
4. Research excerpt (direct quote, 1-2 sentences)
5. Outline alignment (which DEV_OUTLINE section this advances)
6. Actionability score (1-10): specificity × milestone tie × feasibility × testability
7. Creep risk (1-10): 1 = aligned, 10 = scope creep
8. Effort: low (< 1 day) | medium (1-3 days) | high (3+ days)
9. Nice-to-know flag

Filter rules:
- ONLY extract items tied to unchecked items or active phases
- REJECT items that contradict Non-Goals sections
- REJECT vague advice without implementation details
- Maximum 8 items — quality over quantity
```

The prompt caps input at 15K characters for research and 5K for the outline. This keeps context usage under control while preserving the most important content. The scoring formula weights specificity (40%), milestone alignment (30%), stack feasibility (20%), and testability (10%).

The model responds with structured JSON:

```json
{
  "project": "my-blog",
  "items": [
    {
      "title": "Implement scroll depth tracking in analytics",
      "category": "technique",
      "description": "Add tracking calls for scroll milestones at 50%, 75%, 90%...",
      "research_excerpt": "Track content consumption: scroll depth, time-on-page...",
      "outline_alignment": "Phase 3: Analytics Infrastructure > Custom events",
      "actionability": 8,
      "creep_risk": 2,
      "effort": "low",
      "nice_to_know": false
    }
  ],
  "summary": "Research delivers strong alignment for Phase 3 analytics..."
}
```

### Dual-Format Output

Every triage produces two files in the `triage/` directory:

1. **JSON** — machine-readable, consumed by Stage 3 and the dashboard.
2. **Markdown** — human-readable summary with items split into "Actionable" (score >= 7, creep <= 4) and "Backlog" categories.

```
triage/
  grok-research-solo-founder-content-marketing-..._triage.json
  grok-research-solo-founder-content-marketing-..._triage.md
  deep-research-state-of-the-art-open-source-i2v-..._triage.json
  deep-research-state-of-the-art-open-source-i2v-..._triage.md
```

The markdown version looks like this:

```markdown
# Triage: grok-research-solo-founder-content-marketing-...
**Project:** my-blog
**Summary:** Research delivers strong alignment for Phase 3...

## Actionable Items (4)

### Implement newsletter signup tracking
- **Category:** technique | **Effort:** low | **Score:** 9/10 | **Creep Risk:** 1/10
- **Description:** Add event attributes to signup buttons...
- **Aligns with:** Phase 3 > Custom events > Newsletter signup
- **From research:** "Inline CTA early, mid-post, and strong end CTA..."

## Backlog / Nice-to-Know (2)
- **Evaluate CDN preload headers** (low actionability, score: 5, creep: 6)
```

After triage completes, the queue item gets a `triaged: true` flag so it is never processed again.

---

## Stage 3: Autonomous Implementation

### The Idea

If you have gotten this far, you already have something most developers never build: a system that reads research and tells you exactly what to do next, scored and ranked. The natural next question is: can the system do the work too?

Stage 3 takes the top unimplemented actionable item, invokes Claude Code in headless mode inside a feature branch, and opens a draft PR for human review. The key word is "draft." You always review before merging.

### How `research-implement.mjs` Works

```bash
$ node research-implement.mjs --next      # Implement top item
$ node research-implement.mjs --preview   # Dry run — show what would happen
$ node research-implement.mjs --list      # List all implementable items
$ node research-implement.mjs --budget 2  # Set max spend per invocation
```

The `--next` flag is what the sweep calls. Here is the flow:

### Item Selection

The script scans all triage JSON files and collects items that pass the actionability threshold:

```javascript
function gatherActionableItems() {
  const history = loadHistory();
  const implementedKeys = new Set(history.map(h => h.key));

  for (const file of triageFiles) {
    const data = JSON.parse(readFileSync(file));
    for (const item of data.items) {
      // Filter: actionability >= 7, creep_risk <= 4, not nice-to-know
      if (item.actionability < 7 || item.creep_risk > 4 || item.nice_to_know) continue;

      const key = `${data.project}:${item.title}`;
      if (implementedKeys.has(key)) continue; // Already done

      items.push({
        ...item,
        project: data.project,
        key,
        // Composite score: 60% actionability + 40% inverse creep risk
        score: item.actionability * 0.6 + (10 - item.creep_risk) * 0.4,
      });
    }
  }

  items.sort((a, b) => b.score - a.score);
  return items;
}
```

The composite score weights actionability at 60% and inverted creep risk at 40%. An item with actionability 9 and creep risk 1 scores `9*0.6 + 9*0.4 = 9.0`. An item with actionability 8 and creep risk 5 scores `8*0.6 + 5*0.4 = 6.8`. The system always picks the highest-scoring unimplemented item.

### Branch, Invoke, PR

Once an item is selected, the implementation follows a strict sequence:

1. **Verify clean working tree** — refuses to run on a dirty repo.
2. **Create a feature branch** — named `research/<slugified-title>`.
3. **Invoke Claude Code headlessly** — with `--print --max-budget-usd $BUDGET --model sonnet`.
4. **Check for commits** — count new commits on the branch.
5. **Push and open a draft PR** — via `gh pr create --draft`.
6. **Return to the original branch**.

The prompt given to Claude Code is tightly scoped:

```text
You are implementing a specific, well-scoped change for the payment-api project.

## Task
Add Stripe webhook signature verification

## Description
Validate incoming webhook payloads against the signing secret...

## Rules
1. Implement ONLY this specific task
2. Do NOT modify DEV_OUTLINE.md or CLAUDE.md
3. Do NOT add new dependencies unless absolutely required
4. Keep changes minimal and focused
5. Write tests if the project has a test suite

## Process
1. Read the relevant source files first
2. Make the minimal changes needed
3. Verify changes work (run build/lint/tests if available)
4. Commit with message: "feat: add stripe webhook signature verification"
```

The commit message includes a reference to the research source for traceability.

### Draft PRs, Not Merges

Every automated implementation opens a **draft** PR. The PR body includes the original triage metadata — source research file, category, effort estimate, actionability score, creep risk, and which DEV_OUTLINE section it advances:

```markdown
## Summary
Autonomous implementation of triaged research item.

- **Source:** grok-research-stripe-one-time-lifetime-access-...
- **Category:** technique | **Effort:** low
- **Actionability:** 8/10 | **Creep Risk:** 2/10

## DEV_OUTLINE Alignment
Phase 4: Payment Integration > Stripe webhook verification
```

This is a review gate, not an auto-merge. You read the diff, run the tests, and either merge or close. The system generates candidates; you make decisions.

### Implementation History

Every invocation — success or failure — is recorded in `implementations.json`:

```json
[
  {
    "key": "my-blog:Implement scroll depth tracking",
    "project": "my-blog",
    "title": "Implement scroll depth tracking",
    "implemented_at": "2026-05-02T14:30:00.000Z",
    "result": "success",
    "elapsed": "45.2s",
    "model": "sonnet",
    "branch": "research/implement-scroll-depth-tracking",
    "pr": "https://github.com/your-username/my-blog/pull/42",
    "commits": 2
  }
]
```

The `key` field (`project:title`) is what prevents reimplementation. Once an item appears in the history, `gatherActionableItems()` filters it out.

---

## The Triage Queue Data Model

The triage JSON files are the source of truth for item content and scores. But a dashboard needs more: manual reordering, dismissal state, and the ability to override automated scores. That lives in a SQLite table.

### Schema

```sql
CREATE TABLE IF NOT EXISTS triage_order (
  item_key     TEXT PRIMARY KEY,
  manual_rank  INTEGER,
  dismissed    INTEGER DEFAULT 0,
  updated_at   TEXT DEFAULT (datetime('now'))
);
```

Three columns beyond the key:

- **`manual_rank`** — an integer set by drag-and-drop reordering in the dashboard. When present, it overrides the computed score for display ordering.
- **`dismissed`** — a soft-delete flag. Dismissed items disappear from the active queue but remain in the database for audit.
- **`updated_at`** — tracks when the rank or dismissal state last changed.

The `item_key` is the same `project:title` composite used in `implementations.json`. This creates a join point between triage, implementation history, and the dashboard.

### Why Not Store Everything in SQLite?

The triage items themselves stay in JSON files. The database only stores presentation metadata — rank and dismissal. This keeps the triage output portable (you can grep it, diff it, read it in any editor) while giving the dashboard fast indexed queries for ordering.

### PR Cache

A companion table caches GitHub PR metadata for the dashboard:

```sql
CREATE TABLE IF NOT EXISTS pr_cache (
  pr_number    INTEGER NOT NULL,
  repo         TEXT NOT NULL,
  title        TEXT,
  state        TEXT,
  draft        INTEGER DEFAULT 1,
  branch       TEXT,
  diff_stats   TEXT,
  item_key     TEXT,
  research_file TEXT,
  created_at   TEXT,
  synced_at    TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (repo, pr_number)
);
```

The `item_key` and `research_file` columns complete the lineage chain: research file to triage item to PR to merged code.

---

## Lineage Tracing

Every piece of data in this pipeline can be traced back to its origin and forward to its output. Here is the full chain:

```
research-engine.mjs auto --queue --run
  → archive/grok-research-scaling-preact-spa-...-2026-05-02T16-23-08.md
    → queue.json entry (id: 12, status: completed, triaged: true)

research-triage.mjs --pending
  → triage/grok-research-scaling-preact-spa-..._triage.json
    → items[0].key = "admin-dashboard:Implement virtual scrolling for large lists"

research-implement.mjs --next
  → branch: research/implement-virtual-scrolling-for-large-lists
    → PR #47 (draft)
      → implementations.json entry (key, pr, branch, commits)
        → pr_cache row (item_key, research_file)
```

At any point you can ask: "Where did this PR come from?" Follow `item_key` back to the triage JSON, then `research_file` back to the archive. Or go forward: "What happened to this research?" Check if `triaged: true` in the queue, look up items in the triage directory, check `implementations.json` for execution records.

This traceability is not decorative. When a draft PR introduces a subtle bug, you need to understand why the system thought this change was a good idea. Was the research inaccurate? Was the triage score miscalibrated? Did Claude misinterpret the prompt? The lineage chain tells you where the failure originated.

---

## Running It Yourself

Here is the minimum viable setup. You do not need all three stages on day one -- start with triage, prove the value, and layer in automation as your confidence grows.

### 1. Project Roadmaps

Create a `DEV_OUTLINE.md` in each project with phases, milestones, and non-goals. The triage system uses this as its anchor. Without it, every research finding looks equally relevant.

### 2. The Sweep Script

A bash script that chains your stages. Start with just Stage 1 (research) and Stage 2 (triage). Add Stage 3 only after you have reviewed enough triage output to trust the scoring.

### 3. Cron Scheduling

Pick a frequency that matches your research volume. Three times daily works for a multi-project setup generating several research reports per day. A single-project setup might only need once daily.

```bash
# Once daily at 6 AM
0 6 * * * ~/research/research-sweep.sh
```

### 4. The Trust Ladder

- **Week 1**: Run triage manually (`--pending`), review every output.
- **Week 2**: Enable cron for triage, review the `triage/` directory daily.
- **Week 3**: Run `research-implement.mjs --preview` to see what the system would do.
- **Week 4**: Enable Stage 3 with `RESEARCH_AUTO_IMPLEMENT=1` and a low budget (`$1.50`).
- **Ongoing**: Review draft PRs. Merge the good ones, close the bad ones, and adjust scoring.

---

## What I Would Change Next

**Model routing by effort.** Right now, Stage 3 uses the same model for every task. Low-effort items (adding a config flag, updating a dependency) could use a cheaper, faster model. The `--model` flag exists but the sweep does not route by effort level yet.

**Triage feedback loop.** When you dismiss a triage item or close a PR without merging, that signal should feed back into the scoring weights. Currently dismissals are recorded in SQLite but do not influence future scores. This is the difference between a static pipeline and one that learns.

**Parallel implementation.** The sweep processes one item per run. With git worktrees, you could implement multiple items in parallel across different projects without branch conflicts. The infrastructure supports it (separate repos, separate branches), but the orchestration is not built yet.

---

## What You Learned

- **Triage converts research into scored action items** by comparing findings against your project's DEV_OUTLINE, filtering for actionability and creep risk.
- **A three-stage cron sweep** chains research, triage, and implementation into a single automated pipeline with explicit opt-in gates.
- **Draft PRs are review gates, not auto-merges.** The system generates candidates; you make decisions.
- **Lineage tracing** connects every PR back to its source research and forward through implementation history.
- **Trust is earned incrementally.** Start manual, enable automation stage by stage, and keep yourself in the loop for merge decisions.

The most important thing this system does is not write code. It is the filtering. A solo developer's scarcest resource is attention, and a pipeline that separates signal from noise -- that tells you "this finding matters for your current milestone, and here is exactly why" -- gives you leverage that scales with every research report you add.

---

> Next in this series: **Part 3** will cover the browser dashboard that ties everything together — a visual command center for reviewing research, reordering the triage queue with drag-and-drop, and managing draft PRs with inline diffs.
