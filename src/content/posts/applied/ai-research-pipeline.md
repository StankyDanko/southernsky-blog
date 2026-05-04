---
title: "Building a Personal AI Research Pipeline"
description: "How I built a system that queries multiple AI APIs, auto-saves results as timestamped markdown, and indexes hundreds of files with SQLite FTS5."
publishDate: 2026-05-02
author: j-martin
tier: applied
postType: project-walkthrough
difficulty: intermediate
estimatedMinutes: 18
prerequisites: []
category: ai-ml
tags: ["ai", "research", "sqlite", "fts5", "grok", "gemini", "pipeline", "automation"]
certTracks: []
featured: false
heroImage: "/images/posts/ai-research-pipeline.webp"
draft: false
---

## Why Should You Care?

You're deep in a project and you need to answer a question. Not a StackOverflow question --- a real question. "What's the current competitive landscape for consumer intelligence platforms in 2026?" "What are the gotchas with Caddy reverse proxy for SPA + API on a shared prefix?" You fire up an AI chat, get a solid 2,000-word answer, nod thoughtfully, and close the tab.

Three weeks later you need that answer again. You can't find it. You run the same query, burn the same API credits, wait the same 90 seconds. This cycle repeats a dozen times before the pattern becomes obvious: every question you've ever asked an AI is gone. The knowledge evaporates.

I built a system to fix this. It sends questions to multiple AI research APIs, auto-saves every response as timestamped markdown with structured frontmatter, indexes everything in a SQLite FTS5 database for instant full-text search, and --- the part that changed my workflow most --- enforces a search-first principle that checks the archive before spending credits on duplicate queries.

The archive currently holds nearly 500 research files totaling 7MB, built up over several months. I search it multiple times a day. Once you build something like this, you'll wonder how you ever worked without it.

---

## The Architecture

```
  Question
     │
     ▼
  ┌─────────────────────────────┐
  │  search-research.mjs        │  ← Search-first: check archive
  │  SQLite FTS5 (porter stem)  │
  └─────────────┬───────────────┘
                │
        found? ─┤── yes → read existing file
                │
                no
                │
     ┌──────────┴──────────┐
     │                     │
     ▼                     ▼
  Tier 1: Grok          Tier 2: Gemini
  (~90 seconds)         Deep Research
  Quick, focused        (~4 minutes)
  x.ai Responses API    Async polling
     │                     │
     └──────────┬──────────┘
                │
                ▼
  ┌─────────────────────────────┐
  │  ./research/archive/        │
  │  Timestamped .md files      │
  │  Structured frontmatter     │
  └─────────────┬───────────────┘
                │
                ▼
  ┌─────────────────────────────┐
  │  build-research-db.mjs      │
  │  Parse → SQLite → FTS5      │
  │  Triggers keep index synced │
  └─────────────────────────────┘
```

The system has four components: two API scripts for generating research (Grok and Gemini), a file format convention, a database builder, and a search interface. Each one is straightforward on its own --- the power comes from how they compose. Let's walk through each.

---

## Component 1: The Research Scripts

### Grok (Tier 1) --- Quick, Focused Research

The Grok script sends questions to x.ai's Responses API with web search enabled. A typical response takes about 90 seconds and returns 1,500--3,000 words with citations.

```js
// grok-research.mjs — core API call
async function queryGrok(prompt, systemPrompt = null) {
  const input = [];
  if (systemPrompt) input.push({ role: 'system', content: systemPrompt });
  input.push({ role: 'user', content: prompt });

  const res = await fetch('https://api.x.ai/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: 'grok-4.20-0309-reasoning',
      input,
      tools: [{ type: 'web_search' }],
    }),
  });

  const data = await res.json();

  // Responses API: extract text from nested output array
  const textParts = [];
  for (const item of data.output) {
    if (item.content) {
      for (const block of item.content) {
        if (block.type === 'output_text' && block.text) {
          textParts.push(block.text);
        }
      }
    }
  }
  return textParts.join('\n\n') || '(empty response)';
}
```

The `tools: [{ type: 'web_search' }]` parameter is what makes this research-grade rather than chat-grade. The model can pull current data, verify claims, and cite sources. The tradeoff is latency --- web search adds 30--60 seconds --- but for research you're going to keep forever, that's an easy trade to accept.

Usage is straightforward:

```bash
$ node grok-research.mjs --custom "What are the best practices for rate limiting in Express.js APIs?"
```

### Gemini Deep Research (Tier 2) --- Comprehensive Surveys

For questions that benefit from depth --- technology surveys, competitive landscapes, architecture comparisons --- the system uses Gemini's Deep Research Pro model. This is a fundamentally different interaction pattern: you submit a topic, receive an interaction ID, and poll until the research completes.

```js
// research-engine.mjs — Gemini Deep Research execution
async function executeGemini(topic) {
  const baseUrl = 'https://generativelanguage.googleapis.com';
  const modelId = 'deep-research-pro-preview-12-2025';

  // Step 1: Start the research task
  const startRes = await fetch(`${baseUrl}/v1beta/interactions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      input: topic,
      agent: modelId,
      background: true,
    }),
  });

  const startData = await startRes.json();
  const interactionId = startData.id;

  // Step 2: Poll for completion (max 15 minutes)
  while (elapsed < 900000) {
    await new Promise(r => setTimeout(r, 5000));

    const pollRes = await fetch(
      `${baseUrl}/v1beta/interactions/${interactionId}`,
      { headers: { 'x-goog-api-key': apiKey } }
    );
    const pollData = await pollRes.json();

    if (pollData.status === 'completed') {
      // Extract text from outputs array
      return pollData.outputs
        .map(o => o.text)
        .filter(Boolean)
        .join('\n\n');
    }
  }
}
```

Deep Research typically takes 3--5 minutes and produces 5,000--10,000 words with structured sections, citations, and comparative analysis. It's overkill for "what time zone does the Twitter API use?" but exactly right for "compare NASA Horizons, Skyfield, AstroPy, and Swiss Ephemeris for real-time celestial data pipelines including latency benchmarks and gotchas."

The engine includes an automatic fallback: if Gemini returns an empty or minimal response, it falls back to Grok rather than failing silently:

```js
try {
  result = await executeGemini(item.topic);
  if (!result.text || result.text.trim().length < 50) {
    console.log('Gemini returned empty. Falling back to Grok...');
    result = await executeGrok(item.topic);
    usedFallback = true;
  }
} catch (geminiErr) {
  console.log(`Gemini failed: ${geminiErr.message}`);
  result = await executeGrok(item.topic);
  usedFallback = true;
}
```

---

## Component 2: The File Format

Every research result lands in `./research/archive/` as a timestamped markdown file. The naming convention encodes the source API, topic slug, and ISO timestamp:

```
grok-research-custom-2026-05-02T12-39-01.md
deep-research-rate-limiting-express-2026-05-02T16-26-18.md
```

Each file has structured frontmatter that the indexer can parse:

```markdown
# Grok Research: Best distribution strategy for a tech education blog in 2026
**Date:** 2026-05-02T12:39:01.802Z
**Model:** grok-4.20-0309-reasoning
**Prompt slug:** custom

---

## Prompt

Best distribution strategy for a tech education blog in 2026...

---

## Response

**The best distribution strategy for a tech education blog in 2026
centers on content repurposing, SEO-owned channels, community building...**
```

This format isn't YAML frontmatter --- it's structured markdown with bold-key headers. That's a deliberate choice: the files are readable in any text editor, any markdown previewer, and any file browser without special parsing. You can `cat` any file and immediately understand what it contains. The indexer extracts the fields with regex:

```js
// build-research-db.mjs — parse structured headers
const titleMatch = raw.match(/^#\s+(.+)$/m);
const dateMatch = raw.match(/\*\*(?:Date|Generated):\*\*\s*(\S+)/);
const modelMatch = raw.match(/\*\*Model:\*\*\s*(.+)/);
const slugMatch = raw.match(/\*\*Prompt slug:\*\*\s*(\S+)/);

// Extract prompt section between ## Prompt and ## Response
const promptMatch = raw.match(
  /## Prompt\s*\n+([\s\S]*?)(?=\n## (?:Response|$))/
);
```

The indexer also infers which project each file relates to, using both filename patterns and content matching:

```js
function inferProject(filename, content) {
  if (filename.match(/^\d+-grok-/)) return 'documentary';
  if (filename.startsWith('GROK-RESEARCH')) return 'newsletters';
  if (content.includes('dashboard') && content.includes('admin')) return 'admin-panel';
  if (filename.match(/express|fastify|hono/)) return 'api-server';
  return null;
}
```

This means you can search by project later --- "show me all research I've done for the API server project" --- even though the research scripts themselves have no concept of projects.

---

## Component 3: The SQLite FTS5 Index

This is the backbone. `build-research-db.mjs` reads every markdown file in the archive, parses out the structured fields, and inserts them into a SQLite database with a full-text search virtual table.

```js
// build-research-db.mjs — schema
db.exec(`
  CREATE TABLE IF NOT EXISTS research (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT UNIQUE NOT NULL,
    file_path TEXT NOT NULL,
    title TEXT,
    date_created TEXT,
    model_used TEXT,
    prompt_slug TEXT,
    source_project TEXT,
    prompt TEXT,
    content TEXT NOT NULL,
    file_size INTEGER,
    indexed_at TEXT DEFAULT (datetime('now'))
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS research_fts USING fts5(
    title,
    prompt,
    content,
    source_project,
    content='research',
    content_rowid='id',
    tokenize='porter unicode61'
  );
`);
```

Two things to notice about the FTS5 configuration:

**`tokenize='porter unicode61'`** --- This applies Porter stemming, so searching for "deploying" also matches "deploy," "deployed," and "deployment." The `unicode61` tokenizer handles non-ASCII characters correctly. Without this, a search for "Kubernetes" wouldn't match "kubernetes" in some edge cases.

**`content='research', content_rowid='id'`** --- This creates a *content-synced* FTS table. The FTS index doesn't store its own copy of the text; it points back to the `research` table. This saves disk space (the archive is 7MB of text) and means updates propagate automatically via triggers:

```sql
CREATE TRIGGER research_ai AFTER INSERT ON research BEGIN
  INSERT INTO research_fts(rowid, title, prompt, content, source_project)
  VALUES (new.id, new.title, new.prompt, new.content, new.source_project);
END;
```

There are matching triggers for UPDATE and DELETE, so the FTS index stays in sync without manual intervention.

The entire database --- 488 files, full text indexed --- is a 23MB SQLite file. Search is instantaneous.

---

## Component 4: The Search Interface

The search script is 160 lines of JavaScript. It's a CLI tool with ANSI-colored output, date filtering, project filtering, and content excerpts:

```bash
# Basic full-text search
$ node search-research.mjs "sqlite fts5 performance"

# Filter by project
$ node search-research.mjs "content distribution" --project blog

# Date range
$ node search-research.mjs "competitive landscape" --after 2026-04-01

# Show content excerpts
$ node search-research.mjs "container orchestration" --full

# Just filenames (for piping)
$ node search-research.mjs "caddy reverse proxy" --files-only

# Database statistics
$ node search-research.mjs --stats
```

The FTS query uses SQLite's `snippet()` function to highlight matches in context:

```js
const sql = `
  SELECT r.filename, r.title, r.source_project, r.date_created,
         r.model_used, r.file_size,
         snippet(research_fts, 2, '\x1b[33m', '\x1b[0m', '...', 40) as excerpt,
         rank
  FROM research_fts
  JOIN research r ON r.id = research_fts.rowid
  WHERE research_fts MATCH @query
  ORDER BY rank
  LIMIT @limit
`;
```

The `snippet()` parameters tell SQLite to highlight the matched column (index 2 = content), wrap matches in yellow ANSI escape codes, use `...` as an ellipsis marker, and show 40 tokens of context around each match. The result looks like this in the terminal:

```
3 results for "reverse proxy spa"

grok-research-custom-2026-04-15T09-22-14.md
  Caddy SPA + API Routing Patterns
  2026-04-15 | general | grok-4.20-0309-reasoning | 4KB
  ...surgical per-route handle blocks, not broad wildcard — wildcards catch React Router paths...

deep-research-caddy-production-patterns-2026-04-27T19-48-49.md
  Deep Research: Caddy Production Deployment Patterns
  2026-04-27 | general | Deep Research Pro | 12KB
  ...reverse proxy configuration for single-page applications serving both static assets and API...
```

---

## The Search-First Principle

This is the workflow change that saves the most money and produces the best results. Before running any new research query, search the archive first. If someone already asked that question --- and "someone" is almost always past-you --- read the existing file instead of spending API credits on a duplicate.

It sounds obvious. It isn't. The default behavior with AI tools is to open a new chat and ask. Every time. The archive breaks that habit by making search faster than asking.

Searching the full archive takes ~15ms. A Grok query takes ~90 seconds. A Gemini Deep Research query takes ~4 minutes. The math is absurdly one-sided once the archive exists.

You can enforce this principle through documentation and team conventions, but the real enforcement is ergonomic: the search script is shorter to type and returns results before you could even finish formulating a new prompt. The fastest query is the one you don't have to make.

---

## The Retitle Script

Here's a problem I didn't anticipate --- and it's the kind of thing that only surfaces after you've been using a system in production for a while. The Grok research script originally saved every custom query with the same title: "Grok Research: Custom Research Query." After a few months, I had 459 files with identical titles. Full-text search still worked --- it searches content, not just titles --- but browsing the archive was useless.

The fix is `retitle-research.mjs`, and it's one of my favorite scripts because it uses zero AI. It's pure regex:

```js
function deriveTitle(prompt) {
  // Split on the first sentence boundary
  const first = prompt.split(
    /(?<=[^A-Z][^.])\.\s|\n|(?<=[^?])\?(?:\s|$)|!\s/
  )[0].trim();

  if (first.length <= 100) return first;
  return first.slice(0, 97).replace(/\s+\S*$/, '') + '...';
}
```

The regex handles sentence boundaries carefully: it doesn't split on periods inside abbreviations (the `[^A-Z][^.]` negative lookbehind avoids splitting on "U.S." or "Dr."), it captures question marks as valid end-of-sentence markers, and it truncates long titles at word boundaries rather than mid-word.

The script extracts the `## Prompt` section from each file, derives a title from the first sentence, and rewrites the heading:

```bash
# Preview what would change
$ node retitle-research.mjs --dry-run
  grok-research-custom-2026-04-10T14-22-01.md
    → Grok Research: Best distribution strategy for a tech education blog in 2026
  grok-research-custom-2026-04-10T15-03-44.md
    → Grok Research: What are the best practices for rate limiting in Express.js APIs

# Apply changes and rebuild the search index
$ node retitle-research.mjs
──────────────────────────────────────────────────
Total files:    488
Already named:  29
Generic title:  459
Renamed:        459
──────────────────────────────────────────────────

Rebuilding search index...
Index rebuilt.
```

After retitling, the index rebuild happens automatically. One command, 459 fixes, no LLM calls.

---

## The Research Engine

The scripts above work well for one-off questions. But what about batch processing? What if you have eight questions queued up and want to run them overnight?

That's the research engine --- `research-engine.mjs`. It's a queue-based runner that processes Tier 1 (Grok) and Tier 2 (Gemini) research back-to-back with rate limiting between items.

```bash
# Add research topics to the queue
$ node research-engine.mjs add "Current state of autonomous AI agent frameworks in 2026" --api gemini
Added #9 [gemini]: "Current state of autonomous AI agent frameworks in 2026"

$ node research-engine.mjs add "WebGL animation patterns for portfolio sites" --api grok
Added #10 [grok]: "WebGL animation patterns for portfolio sites"

# Check the queue
$ node research-engine.mjs list
Queue:
──────────────────────────────────────────────────────────────────────────
  ○ #9  gemini Current state of autonomous AI agent frameworks in 2026
  ○ #10 grok   WebGL animation patterns for portfolio sites
──────────────────────────────────────────────────────────────────────────
  2 pending, 0 running, 0 completed, 0 cancelled/failed

# Run all pending items back-to-back
$ node research-engine.mjs run --continuous
```

The queue persists as a JSON file, so you can add items from one terminal session and run them from another. Each item tracks its lifecycle: pending, running, completed, failed, or cancelled. Completed items can be marked as reviewed:

```bash
# See what's new
$ node research-engine.mjs unreviewed
2 unreviewed:
  #9 [gemini] Current state of autonomous AI agent frameworks...
    → ./archive/deep-research-current-state-of-autonomous-...md
  #10 [grok] WebGL animation patterns for portfolio sites
    → ./archive/grok-research-webgl-animation-...md

# Mark as reviewed after reading
$ node research-engine.mjs review 9
Marked #9 as reviewed.
```

The engine also supports pause/resume, reordering, and cancellation --- standard queue management for when priorities shift mid-batch.

---

## Auto-Scan: Finding Questions You Didn't Know to Ask

The most ambitious component is `auto-scan.mjs`. It scans your active project directories, reads each project's README or docs, extracts goals and tech stack mentions, and detects knowledge gaps by cross-referencing against the existing research archive.

The pipeline:

1. **Scan projects** --- Read README.md or project documentation from each project directory
2. **Extract goals** --- Pull unchecked TODO items, strategic phrases, identity descriptions, and section headings
3. **Detect gaps** --- For each extracted goal, search the FTS5 index. Score coverage from 0--5. Anything below 3 is a gap.
4. **Generate queries** --- Send the gap list to an LLM (Grok or local Ollama) to produce actionable research questions
5. **Filter redundant** --- Cross-check generated queries against the archive to avoid duplicates
6. **Rank** --- Score by relevance (40%), impact (35%), and novelty (25%)

```bash
# Dry run: see what gaps exist across your projects
$ node research-engine.mjs auto --scan --verbose
Scanning projects...
  Found 26 projects with documentation
  Manifest saved: project-manifest.json

Detecting knowledge gaps...
  Found 147 gaps across all projects

  Top 10 gaps:
    [api-server] "SSE streaming architecture" (coverage: 0/5)
    [audio-tagger] "on-device audio classification" (coverage: 1/5)
    [video-tools] "real-time video processing pipelines" (coverage: 0/5)
    ...

Generating research queries via grok...
  Generated in 87.3s

8 research candidates (ranked by score):
──────────────────────────────────────────────────────────────────────────
  1. [gemini] SSE streaming patterns for real-time data with Express...
     Project: api-server | Score: 8.4 (R:9 I:8 N:9)
  2. [gemini] Real-time video processing pipeline architectures...
     Project: video-tools | Score: 8.1 (R:8 I:9 N:8)
  ...

Dry run — use "auto --queue" to add these to the research queue.
```

The gap detection works by measuring FTS coverage. For each goal extracted from a project, it constructs a search query from the key words and runs it against the archive:

```js
function measureCoverage(db, query) {
  const stopWords = new Set([
    'the', 'and', 'for', 'with', 'from', 'that', 'this',
    'are', 'was', 'has', 'have', 'been', 'will', 'can'
  ]);

  const words = query.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w))
    .slice(0, 8);

  // Require ALL key words to match (AND logic)
  const ftsQuery = words.map(w => `"${w}"`).join(' AND ');

  const results = db.prepare(`
    SELECT r.title FROM research_fts
    JOIN research r ON r.id = research_fts.rowid
    WHERE research_fts MATCH ?
    ORDER BY rank LIMIT 5
  `).all(ftsQuery);

  if (results.length >= 2) return { score: 5 };
  if (results.length === 1) return { score: 4 };

  // Fall back to partial match — require half the words
  const partialQuery = words.slice(0, Math.ceil(words.length / 2))
    .map(w => `"${w}"`).join(' AND ');
  // ... score 2-3 based on partial matches
}
```

A coverage score of 0 means the archive has nothing on that topic. Score 5 means multiple strong matches exist. The auto-scanner only surfaces gaps scoring below 3.

The scan can use local Ollama instead of Grok for query generation, which means the entire gap-detection-to-queue pipeline can run at zero API cost:

```bash
$ node research-engine.mjs auto --scan --backend ollama
```

---

## The Full Workflow

You've seen each component in isolation. Here's how all the pieces fit together in a typical day:

```bash
# 1. Start with search — do I already know this?
$ node search-research.mjs "nginx rate limiting"

# 2. Archive has something relevant — read the file
$ cat ./archive/grok-research-nginx-rate-limiting-2026-04-22.md

# 3. Need something deeper? Queue a Tier 2 query
$ node research-engine.mjs add \
  "nginx rate limiting patterns for API proxies in 2026, \
  including burst handling, per-IP vs per-user limits, \
  and gotchas with CDN/reverse proxy chains" --api gemini

# 4. Run the queue
$ node research-engine.mjs run --continuous

# 5. Periodically: scan projects for new gaps
$ node research-engine.mjs auto --queue --run

# 6. Rebuild the index after new files land
$ node search-research.mjs --rebuild
```

---

## By the Numbers

| Metric | Value |
|--------|-------|
| Total research files | ~500 |
| Archive size (text) | 7 MB |
| SQLite database size | 23 MB |
| Grok (Tier 1) files | ~460 |
| Gemini Deep Research files | 14 |
| Projects with tagged research | 12 |
| Search latency | ~15ms |
| Grok query latency | ~90 seconds |
| Gemini query latency | ~4 minutes |
| Retitled files (one batch) | 459 |

---

## What You Learned

- **Persist AI research as files.** Chat interfaces lose context. Markdown files in a directory are searchable, greppable, versionable, and portable. The file is the unit of knowledge --- and unlike a chat history, it belongs to you.

- **FTS5 with Porter stemming is the right search tool for this scale.** Hundreds of files, megabytes of text, sub-20ms search. No vector database, no embeddings, no Elasticsearch cluster. SQLite ships with your operating system. Start simple; scale when simple stops working.

- **Search before you ask.** The search-first principle is the highest-ROI behavior change in this entire system. Past-you already answered this question. Check the archive.

- **Queue-based batch processing respects rate limits and your attention.** Queue eight questions, run them overnight, review in the morning. The research happens whether you're watching or not.

- **Auto-scanning surfaces questions you didn't know to ask.** The gap between "what your projects need" and "what your archive covers" is where the most valuable research lives. Let the system find those gaps for you.

The whole pipeline --- from question to indexed, searchable answer --- runs on a few hundred lines of JavaScript and a single SQLite database. No infrastructure to manage, no services to keep running, no vendor lock-in. Just files, a database, and a habit of searching before asking.

---

*This is Part 1 of a 3-part series on building an AI-powered development workflow. Part 2 covers automated triage and implementation --- turning raw research into prioritized action items that feed directly into your project backlog. Part 3 covers the browser dashboard that ties it all together with live status, search, and project health at a glance.*
