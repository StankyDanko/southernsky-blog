---
title: "Building an R&D Dashboard for Your AI Research Pipeline"
description: "How I built a browser-based command center for reviewing, curating, and acting on AI-generated research with Preact, Express 5, and SQLite."
publishDate: 2026-05-02
author: j-martin
tier: applied
postType: project-walkthrough
difficulty: intermediate
estimatedMinutes: 18
prerequisites: ["javascript-basics", "sqlite"]
category: web-development
tags: ["preact", "express", "sqlite", "dashboard", "sortablejs", "drag-and-drop", "fts5", "research"]
certTracks: []
featured: false
heroImage: "/images/posts/ai-research-dashboard.webp"
draft: false
---

## Why Should You Care?

You have five hundred research files. You have a triage engine scoring each one. You have an auto-implementation system that opens draft PRs. You built the entire pipeline across [Part 1](/blog/applied/ai-research-pipeline) and [Part 2](/blog/applied/ai-research-triage-implementation) of this series.

Now comes the question you did not plan for: how do you actually *use* all of it?

Grep works. SQLite CLI works. But when you are trying to decide whether an AI-scored 8.4 really deserves priority over a manually pinned 7.1, or whether three related research files should be archived together, you want something visual. You want a command center -- a single screen where you can see the pipeline's health, search through everything, reorder priorities by hand, and act on pull requests without switching tools.

This post walks through the R&D dashboard I built to close that gap: four sub-tabs covering pipeline health, full-text search with export and curation, drag-and-drop triage with SortableJS, and an inline PR diff viewer that lets you merge or close without leaving the browser. The stack is intentionally minimal: Preact for the frontend, Express 5 for the API, better-sqlite3 for persistence, and zero new npm dependencies for the export pipeline.

---

## The Four Sub-Tabs

The R&D tab uses a simple sub-tab navigation pattern. Each sub-tab is a self-contained component that mounts lazily when selected:

```tsx
type RDSubTab = 'overview' | 'research' | 'triage' | 'prs'

export function RD() {
  const [subTab, setSubTab] = useState<RDSubTab>('overview')

  return (
    <div>
      <div style="display:flex;gap:0;border-bottom:1px solid var(--border)">
        {[
          { id: 'overview', label: 'Overview' },
          { id: 'research', label: 'Research Feed' },
          { id: 'triage', label: 'Triage Queue' },
          { id: 'prs', label: 'PR Review' },
        ].map(t => (
          <div
            key={t.id}
            style={`padding:8px 16px;cursor:pointer;font-size:12px;
              border-bottom:2px solid ${subTab === t.id ? 'var(--accent)' : 'transparent'};
              color:${subTab === t.id ? 'var(--accent)' : 'var(--text-dim)'}`}
            onClick={() => setSubTab(t.id)}
          >
            {t.label}
          </div>
        ))}
      </div>

      {subTab === 'overview' && <Overview />}
      {subTab === 'research' && <ResearchFeed />}
      {subTab === 'triage' && <TriageQueue />}
      {subTab === 'prs' && <PRReview />}
    </div>
  )
}
```

No router, no lazy imports. The conditional render *is* the routing. When you switch tabs, the previous component unmounts and the new one mounts with its own `useEffect` for data fetching. Simple, predictable, and easy to reason about when debugging.

---

## Overview: Pipeline Health at a Glance

The Overview tab answers one question: "Is the pipeline healthy?" It shows four stat cards and an API cost widget -- the kind of at-a-glance view that saves you from digging through logs every morning.

### Health Metrics

The health endpoint aggregates data from four sources: the research archive directory (file count), triage JSON files (actionable items), the research queue (pending/completed/failed), and the implementations log (success/failure rates). All of it is assembled server-side in a single GET:

```js
router.get('/rd/health', (_req, res) => {
  const queue = readJson(QUEUE_FILE)
  const implementations = readJson(IMPLEMENT_LOG) || []

  let archiveCount = 0
  try {
    archiveCount = readdirSync(ARCHIVE_DIR)
      .filter(f => f.endsWith('.md')).length
  } catch {}

  let actionableCount = 0
  const triageFiles = readdirSync(TRIAGE_DIR)
    .filter(f => f.endsWith('_triage.json'))

  for (const f of triageFiles) {
    const data = readJson(resolve(TRIAGE_DIR, f))
    if (data?.items) {
      actionableCount += data.items.filter(
        i => i.actionability >= 7 && i.creep_risk <= 4 && !i.nice_to_know
      ).length
    }
  }

  res.json({
    archive: { count: archiveCount },
    triage: { files: triageFiles.length, actionable: actionableCount },
    queue: {
      completed: queue?.queue?.filter(i => i.status === 'completed').length || 0,
      failed: queue?.queue?.filter(i => i.status === 'failed').length || 0,
      pending: queue?.queue?.filter(i => i.status === 'pending').length || 0,
    },
    implementations: {
      success: implementations.filter(i => i.result === 'success').length,
      failed: implementations.filter(i => i.result === 'failed').length,
      today: implementations.filter(i =>
        i.implemented_at?.startsWith(new Date().toISOString().slice(0, 10))
      ).length,
    },
  })
})
```

The frontend maps this to a grid of stat cards. Each card renders a label, a large colored number, and a subtitle:

```tsx
function HealthMetrics() {
  const h = rdHealth.value
  if (!h) return <div style="color:var(--text-dim)">Loading pipeline data...</div>

  return (
    <div class="stat-grid">
      <div class="stat-card">
        <div class="label">Research Archive</div>
        <div class="value blue">{h.archive.count}</div>
        <div style="font-size:11px;margin-top:4px">files indexed</div>
      </div>
      <div class="stat-card">
        <div class="label">Actionable Items</div>
        <div class="value green">{h.triage.actionable}</div>
        <div style="font-size:11px;margin-top:4px">from {h.triage.files} triages</div>
      </div>
      {/* Queue and Implementations cards follow the same pattern */}
    </div>
  )
}
```

The `stat-grid` CSS class uses `grid-template-columns: repeat(auto-fit, minmax(180px, 1fr))` so the cards reflow naturally between two-column and four-column layouts.

### API Cost Tracking

Below the health metrics, a cost widget shows spend over the past 30 days, broken down by provider and by day. The data comes from an `api_usage_logs` table:

```sql
CREATE TABLE api_usage_logs (
  id             INTEGER PRIMARY KEY,
  provider       TEXT NOT NULL,
  model          TEXT,
  input_tokens   INTEGER DEFAULT 0,
  output_tokens  INTEGER DEFAULT 0,
  estimated_cost REAL DEFAULT 0,
  attribution    TEXT,
  timestamp      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_usage_timestamp ON api_usage_logs(timestamp);
CREATE INDEX idx_usage_provider  ON api_usage_logs(provider);
```

The summary endpoint runs three queries against the same table: group by provider, group by day, and a totals aggregate:

```js
router.get('/rd/usage/summary', (req, res) => {
  const days = Math.min(parseInt(req.query?.days) || 30, 365)
  const cutoff = new Date(Date.now() - days * 86400000).toISOString()

  const byProvider = rdDb.prepare(`
    SELECT provider,
           COUNT(*) as calls,
           SUM(input_tokens) as total_input,
           SUM(output_tokens) as total_output,
           SUM(estimated_cost) as total_cost
    FROM api_usage_logs WHERE timestamp >= ?
    GROUP BY provider ORDER BY total_cost DESC
  `).all(cutoff)

  const byDay = rdDb.prepare(`
    SELECT date(timestamp) as day,
           SUM(estimated_cost) as cost,
           COUNT(*) as calls
    FROM api_usage_logs WHERE timestamp >= ?
    GROUP BY date(timestamp) ORDER BY day DESC LIMIT 30
  `).all(cutoff)

  // totals query omitted — same pattern

  res.json({ byProvider, byDay, totals, days })
})
```

The daily breakdown renders inside a `<details>` element so it stays collapsed by default. Each day is a small card showing the date, cost, and call count. Most days you glance at the top-level totals, confirm nothing is unusual, and move on. The drill-down is there for the day something *is* unusual -- and when that day comes, you will be glad you built it.

---

## Research Feed: FTS5 Search + Export + DMZ Curation

The Research Feed sub-tab is the most feature-dense panel. It combines full-text search, checkbox selection, individual and bulk export, and DMZ curation -- archiving files off-machine to long-term storage -- in one interface. If the Overview tab is where you check the pulse, this is where you do the actual work.

### FTS5 Search Architecture

The research archive uses SQLite's FTS5 extension with a content-sync table. The FTS virtual table mirrors the main `research` table via triggers:

```sql
CREATE VIRTUAL TABLE research_fts USING fts5(
  title, prompt, content, source_project,
  content='research',
  content_rowid='id',
  tokenize='porter unicode61'
);

-- Auto-sync on INSERT
CREATE TRIGGER research_ai AFTER INSERT ON research BEGIN
  INSERT INTO research_fts(rowid, title, prompt, content, source_project)
  VALUES (new.id, new.title, new.prompt, new.content, new.source_project);
END;

-- Auto-sync on DELETE (content-synced FTS5 delete syntax)
CREATE TRIGGER research_ad AFTER DELETE ON research BEGIN
  INSERT INTO research_fts(research_fts, rowid, title, prompt, content, source_project)
  VALUES ('delete', old.id, old.title, old.prompt, old.content, old.source_project);
END;
```

The `content='research'` directive tells FTS5 to read the actual text from the `research` table rather than storing a copy. This saves disk space (research files can be large) but requires that the triggers stay in sync. The `tokenize='porter unicode61'` uses the Porter stemmer, so a search for "deploying" also matches "deploy" and "deployment."

The search endpoint handles two modes: no query (return latest) and FTS query (return ranked by BM25):

```js
router.get('/rd/research/search', (req, res) => {
  const q = req.query.q?.toString() || ''
  const limit = Math.min(parseInt(req.query.limit) || 20, 100)
  const offset = parseInt(req.query.offset) || 0
  const project = req.query.project?.toString() || ''

  const db = getResearchDb()

  if (!q) {
    // No query — latest research, paginated
    let sql = 'SELECT filename, title, date_created, source_project, file_size FROM research'
    if (project) sql += ' WHERE source_project = ?'
    sql += ' ORDER BY date_created DESC LIMIT ? OFFSET ?'
    // ...
  } else {
    // FTS query — split terms, quote for phrase safety, rank by BM25
    const ftsQuery = q.split(/\s+/)
      .map(w => `"${w.replace(/"/g, '')}"`)
      .join(' AND ')

    const rows = db.prepare(`
      SELECT r.filename, r.title, r.date_created, r.source_project, r.file_size,
             snippet(research_fts, 2, '<mark>', '</mark>', '...', 20) as snippet
      FROM research_fts
      JOIN research r ON r.id = research_fts.rowid
      WHERE research_fts MATCH ?
      ORDER BY bm25(research_fts)
      LIMIT ? OFFSET ?
    `).all(ftsQuery, limit, offset)

    res.json({ results: rows, total: countRow.c })
  }
})
```

The `snippet()` function is key to a good search UX. It returns the matched text fragment with `<mark>` tags around the hit terms, which the frontend renders with `dangerouslySetInnerHTML`. The result is highlighted search terms in context, not just a title match.

On the frontend, search is debounced at 300ms using a ref:

```tsx
const debounceRef = useRef<any>(null)

function onInput(e: Event) {
  const val = (e.target as HTMLInputElement).value
  setQuery(val)
  setPage(0)
  clearTimeout(debounceRef.current)
  debounceRef.current = setTimeout(() => doSearch(val, project, 0), 300)
}
```

### Export Architecture: Zero New Dependencies

The export system supports two modes: single-file download and bulk zip. The design constraint was deliberate: no new npm packages. Every dependency you add is a dependency you maintain, and for something as straightforward as file export, the platform already gives you everything you need.

**Single file:** The browser's native download API handles this. The endpoint sets `Content-Disposition: attachment` and sends the raw markdown. The frontend creates a temporary anchor element and clicks it:

```tsx
function saveFile(filename: string) {
  const a = document.createElement('a')
  a.href = `/api/rd/research/export/${encodeURIComponent(filename)}`
  a.download = filename
  a.click()
}
```

**Bulk export:** When multiple files are selected, the server creates a zip using the system `zip` CLI — no `archiver` or `jszip` package needed:

```js
router.post('/rd/research/export', (req, res) => {
  const { filenames } = req.body
  const valid = filenames.filter(f => {
    if (f.includes('..') || f.includes('/') || f.includes("'")) return false
    return existsSync(resolve(ARCHIVE_DIR, f))
  })

  const zipPath = `/tmp/_research_export_${Date.now()}.zip`
  try {
    const args = valid.map(f => `"${f}"`).join(' ')
    execSync(`cd "${ARCHIVE_DIR}" && zip -j "${zipPath}" ${args}`, { timeout: 30000 })

    const zipBuf = readFileSync(zipPath)
    unlinkSync(zipPath) // Clean up temp file immediately

    const datestamp = new Date().toISOString().slice(0, 10)
    res.setHeader('Content-Disposition',
      `attachment; filename="research-export-${datestamp}.zip"`)
    res.setHeader('Content-Type', 'application/zip')
    res.send(zipBuf)
  } catch (e) {
    try { unlinkSync(zipPath) } catch {}
    res.status(500).json({ error: 'zip failed: ' + e.message })
  }
})
```

The `-j` flag tells zip to store files without directory paths (junk paths). The temp file gets a timestamp suffix to avoid collisions. And the path traversal guard (`..` and `/` checks) prevents the obvious attack vector.

On the frontend, the bulk export fetches a blob, creates an object URL, and triggers the download:

```tsx
async function saveSelected() {
  const filenames = [...selected]
  if (filenames.length === 1) { saveFile(filenames[0]); return }

  const res = await fetch('/api/rd/research/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filenames }),
  })

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const cd = res.headers.get('Content-Disposition')
  a.download = cd?.match(/filename="([^"]+)"/)?.[1] || 'research-export.zip'
  a.click()
  URL.revokeObjectURL(url) // Prevent memory leak
}
```

The `URL.revokeObjectURL` call after the click is easy to forget but important. Without it, the browser retains the blob in memory for the lifetime of the page.

### DMZ Curation: Archiving to a Storage Server

Some research files are worth keeping but no longer need to live in the active archive. The DMZ feature moves them to a remote storage server and removes them from the local index.

The flow: transfer the file to a staging location on the storage server, move it into the archive directory, then delete the local copy and clean up the FTS index.

```js
router.post('/rd/research/dmz', (req, res) => {
  const { filenames } = req.body

  for (const filename of filenames) {
    const localPath = resolve(ARCHIVE_DIR, filename)
    try {
      // Transfer to remote staging path (use -O flag if target runs legacy SSH)
      execSync(`scp -O "${localPath}" storage-server:/tmp/_dmz_transfer_`, { timeout: 15000 })

      // Move from staging into the archive directory on the remote host
      execSync(
        `ssh storage-server "mv /tmp/_dmz_transfer_ ${DMZ_PATH}/${filename}"`,
        { encoding: 'utf-8', timeout: 15000 }
      )

      // Remove from local filesystem
      unlinkSync(localPath)

      // Remove from SQLite — FTS triggers auto-sync the delete
      const row = db.prepare('SELECT id FROM research WHERE filename = ?').get(filename)
      if (row) db.prepare('DELETE FROM research WHERE id = ?').run(row.id)

      results.moved.push(filename)
    } catch (e) {
      results.failed.push({ filename, error: e.message })
    }
  }

  res.json({ ok: true, ...results })
})
```

Two details here earned their complexity the hard way:

1. **`scp -O`**: Some NAS devices and embedded Linux systems run an older SSH implementation that does not support the newer SFTP-based SCP protocol. The `-O` flag forces the legacy protocol. Without it, transfers can fail silently. Check your target's SSH version if you hit unexplained failures.

2. **`printf` instead of `echo`**: If your remote workflow involves piping input through SSH, `echo` can behave inconsistently depending on the remote shell. `printf '%s\n'` is POSIX-reliable and works across every target I have tested, including BusyBox-based firmware. As a general rule, prefer `printf` over `echo` in any script that crosses a shell boundary.

The FTS cleanup is automatic: deleting a row from the `research` table fires the `research_ad` trigger, which removes the corresponding entry from `research_fts`. No manual FTS maintenance required.

---

## Triage Queue: SortableJS Drag-and-Drop

The Triage Queue is where algorithmic scoring meets human judgment. It shows all actionable items from the research pipeline, ranked by a composite score (actionability weighted at 60%, inverted creep risk at 40%). But you can drag items to reorder them by hand, and that manual ordering persists across sessions. The algorithm proposes; you decide.

### Gathering and Sorting Triage Items

The backend walks all `_triage.json` files, filters for items that meet the actionability threshold, checks for manual rank overrides in the database, and returns them in sorted order:

```js
function gatherTriageItems() {
  const implementations = readJson(IMPLEMENT_LOG) || []
  const implementedKeys = new Set(implementations.map(h => h.key))

  const files = readdirSync(TRIAGE_DIR).filter(f => f.endsWith('_triage.json'))
  const items = []

  for (const file of files) {
    const data = readJson(resolve(TRIAGE_DIR, file))
    if (!data?.items || !data.project) continue

    for (const item of data.items) {
      if (item.actionability < 7 || item.creep_risk > 4 || item.nice_to_know) continue

      const key = `${data.project}:${item.title}`
      const override = rdDb.prepare(
        'SELECT manual_rank, dismissed FROM triage_order WHERE item_key = ?'
      ).get(key)

      if (override?.dismissed) continue

      items.push({
        ...item,
        key,
        score: item.actionability * 0.6 + (10 - item.creep_risk) * 0.4,
        implemented: implementedKeys.has(key),
        manual_rank: override?.manual_rank ?? null,
      })
    }
  }

  // Manual-ranked items float to top, then sort by score
  items.sort((a, b) => {
    if (a.manual_rank !== null && b.manual_rank !== null)
      return a.manual_rank - b.manual_rank
    if (a.manual_rank !== null) return -1
    if (b.manual_rank !== null) return 1
    return b.score - a.score
  })

  return items
}
```

The sorting strategy is three-tiered: items with a `manual_rank` always appear first (sorted by rank), then unranked items appear in descending score order. This means you can pin a few high-priority items at the top without disturbing the algorithm-sorted tail.

### SortableJS Integration with Preact

SortableJS is a vanilla JS library -- it does not know about React, Preact, or any virtual DOM. That means the integration requires bridging two worlds: SortableJS wants direct DOM manipulation, and Preact wants to own the DOM tree. The pattern that works uses `useRef` for the container and `useEffect` for the lifecycle:

```tsx
function TriageQueue() {
  const listRef = useRef<HTMLDivElement>(null)
  const sortableRef = useRef<Sortable | null>(null)

  useEffect(() => {
    if (!listRef.current || filter !== 'all') {
      sortableRef.current?.destroy()
      sortableRef.current = null
      return
    }

    sortableRef.current = Sortable.create(listRef.current, {
      animation: 150,
      handle: '.drag-handle',
      ghostClass: 'sortable-ghost',
      onEnd: async (evt) => {
        if (evt.oldIndex === undefined || evt.newIndex === undefined) return

        // Optimistically update the signal
        const reordered = [...rdTriage.value]
        const [moved] = reordered.splice(evt.oldIndex, 1)
        reordered.splice(evt.newIndex, 0, moved)
        rdTriage.value = reordered

        // Persist to server
        try {
          await rdApi.triageReorder(reordered.map(i => i.key))
          showToast('Queue reordered')
        } catch (e) {
          showToast('Reorder failed: ' + e.message, true)
          loadTriage() // Rollback on failure
        }
      },
    })

    return () => {
      sortableRef.current?.destroy()
      sortableRef.current = null
    }
  }, [filter, rdTriage.value.length])

  return (
    <div ref={listRef}>
      {items.map((item, i) => (
        <div key={item.key} data-key={item.key} class="stat-card">
          <span class="drag-handle" style="cursor:grab">&#x283F;</span>
          {/* item content */}
        </div>
      ))}
    </div>
  )
}
```

Four things to get right (each one learned from a bug):

1. **`handle: '.drag-handle'`**: Without a handle, the entire card is draggable, which conflicts with text selection and button clicks. The braille dots character works well as a visual handle.

2. **Destroy on filter change**: When you switch from "All" to "Pending" or "Implemented," the SortableJS instance must be destroyed and recreated. Stale instances cause phantom drag artifacts.

3. **Optimistic update + rollback**: The signal updates immediately so the UI feels instant. If the server rejects the reorder, we reload the full list to restore the correct state.

4. **`ghostClass: 'sortable-ghost'`**: This CSS class controls the visual feedback during drag:

```css
.sortable-ghost {
  opacity: 0.3;
  border: 1px dashed var(--accent) !important;
}
.drag-handle:hover {
  color: var(--accent) !important;
}
```

### Persisting Rank

The reorder endpoint uses SQLite's `ON CONFLICT` for an upsert pattern. Every item in the new order gets a `manual_rank` equal to its array index:

```js
router.post('/rd/triage/reorder', (req, res) => {
  const { keys } = req.body

  const upsert = rdDb.prepare(`
    INSERT INTO triage_order (item_key, manual_rank, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(item_key) DO UPDATE SET
      manual_rank = ?, updated_at = datetime('now')
  `)

  const tx = rdDb.transaction(() => {
    for (let i = 0; i < keys.length; i++) {
      upsert.run(keys[i], i, i)
    }
  })
  tx()

  res.json({ ok: true })
})
```

Wrapping the upserts in a transaction is not optional. Without it, each `upsert.run()` is its own transaction, which means hundreds of disk syncs for a full reorder. The `rdDb.transaction()` wrapper batches them into a single write — the difference between 2ms and 200ms.

---

## PR Review: Inline Diffs with Merge and Close

The PR Review tab surfaces all auto-generated pull requests and lets you inspect the diff, merge (squash), or close without leaving the dashboard.

### Loading and Enriching PR Data

PRs are tracked in the implementations log. The endpoint parses GitHub URLs from each implementation entry, then enriches them with cached metadata from the `pr_cache` table:

```js
router.get('/rd/prs', (_req, res) => {
  const implementations = readJson(IMPLEMENT_LOG) || []
  const withPrs = implementations.filter(i => i.pr)

  const prs = withPrs.map(impl => {
    const match = impl.pr?.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/)
    return {
      ...impl,
      repo: match?.[1] || null,
      pr_number: match?.[2] ? parseInt(match[2]) : null,
    }
  }).filter(p => p.repo && p.pr_number)

  const enriched = prs.map(pr => {
    const cached = rdDb.prepare(
      'SELECT * FROM pr_cache WHERE repo = ? AND pr_number = ?'
    ).get(pr.repo, pr.pr_number)
    return { ...pr, github: cached || null }
  })

  res.json({ prs: enriched })
})
```

The `pr_cache` table is populated by a sync endpoint that fetches from the GitHub API. This keeps the dashboard usable even when GitHub is slow or rate-limited — you always have the last-synced state.

### Inline Diff Rendering

When you click "Diff" on a PR, the frontend fetches the raw diff from GitHub's API and renders it with per-line syntax coloring:

```tsx
{diffContent.split('\n').map((line, li) => {
  let color = 'var(--text-dim)'
  if (line.startsWith('+') && !line.startsWith('+++')) color = 'var(--accent)'
  else if (line.startsWith('-') && !line.startsWith('---')) color = 'var(--danger)'
  else if (line.startsWith('@@')) color = 'var(--blue)'
  else if (line.startsWith('diff ')) color = 'var(--yellow)'
  return <div key={li} style={`color:${color}`}>{line}</div>
})}
```

No diff parsing library needed. The unified diff format is self-describing: `+` lines are additions (green), `-` lines are deletions (red), `@@` lines are hunk headers (blue), and `diff` lines are file separators (yellow). The `+++` and `---` guards prevent file path headers from getting colored as add/delete lines.

### Merge and Close Actions

Both operations go through the GitHub API via the backend:

```js
router.post('/rd/prs/:repo/:number/merge', (req, res) => {
  const result = ghApi(`/repos/${repo}/pulls/${number}/merge`, {
    method: 'PUT',
    body: { merge_method: 'squash' },
  })

  // Update local cache to reflect the new state
  rdDb.prepare(
    "UPDATE pr_cache SET state = 'closed', synced_at = datetime('now') WHERE repo = ? AND pr_number = ?"
  ).run(repo, parseInt(number))

  res.json({ ok: true, merged: result.merged || false })
})
```

Squash merge is the default because auto-generated PRs often have noisy commit histories. The cache update happens immediately after a successful merge so the UI reflects the state change without waiting for the next sync cycle.

---

## Lineage Modal: Tracing an Item Through the Pipeline

Every item in the triage queue has a "lineage" button that opens a modal showing the full journey: research file to triage assessment to implementation to PR. This is the dashboard's audit trail -- the answer to "where did this idea come from, and what happened to it?"

The lineage endpoint assembles data from four sources:

```js
router.get('/rd/lineage/:key', (req, res) => {
  const key = req.params.key
  const implementations = readJson(IMPLEMENT_LOG) || []
  const impl = implementations.find(i => i.key === key)

  // Check for manual rank/dismiss overrides
  const triageOverride = rdDb.prepare(
    'SELECT manual_rank, dismissed FROM triage_order WHERE item_key = ?'
  ).get(key)

  // Look up cached PR data
  let prCache = null
  if (impl?.pr) {
    const match = impl.pr.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/)
    if (match) {
      prCache = rdDb.prepare(
        'SELECT * FROM pr_cache WHERE repo = ? AND pr_number = ?'
      ).get(match[1], parseInt(match[2]))
    }
  }

  // Find the original triage item
  const [project, ...titleParts] = key.split(':')
  const title = titleParts.join(':')
  // Walk triage files to find the matching item...

  // Load research file excerpt
  if (triageItem?.research_file) {
    const content = readFileSync(resolve(ARCHIVE_DIR, triageItem.research_file), 'utf-8')
    researchSummary = {
      filename: triageItem.research_file,
      title: content.split('\n').find(l => l.startsWith('# '))?.replace('# ', ''),
      excerpt: content.slice(0, 500),
    }
  }

  res.json({ key, triage: triageItem, triageOverride, implementation: impl, pr: prCache, research: researchSummary })
})
```

The modal renders a horizontal pipeline progress bar with four stages. Each stage is a circle that fills green when that stage has data:

```tsx
const stages = [
  { label: 'Research', done: !!data?.research, color: 'var(--blue)' },
  { label: 'Triage', done: !!data?.triage, color: 'var(--purple)' },
  { label: 'Implementation', done: !!data?.implementation, color: 'var(--yellow)' },
  { label: 'PR', done: !!data?.pr, color: 'var(--accent)' },
]
```

Below the progress bar, each stage that has data renders a card with its details: the research excerpt, the triage scores and description, the implementation result and branch, and the PR link. In one view, you can trace exactly how an idea traveled from "AI-generated research file" to "merged pull request" -- or see where it stalled and why.

---

## The Schema Underneath

Three tables in `rd.db` support the entire dashboard:

```sql
-- Manual ordering for the triage queue
CREATE TABLE triage_order (
  item_key     TEXT PRIMARY KEY,
  manual_rank  INTEGER,
  dismissed    INTEGER DEFAULT 0,
  updated_at   TEXT DEFAULT (datetime('now'))
);

-- Cached GitHub PR metadata
CREATE TABLE pr_cache (
  pr_number    INTEGER NOT NULL,
  repo         TEXT NOT NULL,
  title        TEXT,
  state        TEXT,
  draft        INTEGER DEFAULT 1,
  branch       TEXT,
  diff_stats   TEXT,    -- JSON: {additions, deletions, changed_files}
  item_key     TEXT,
  research_file TEXT,
  created_at   TEXT,
  synced_at    TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (repo, pr_number)
);

-- Per-call cost tracking
CREATE TABLE api_usage_logs (
  id             INTEGER PRIMARY KEY,
  provider       TEXT NOT NULL,
  model          TEXT,
  input_tokens   INTEGER DEFAULT 0,
  output_tokens  INTEGER DEFAULT 0,
  estimated_cost REAL DEFAULT 0,
  attribution    TEXT,
  timestamp      TEXT DEFAULT (datetime('now'))
);
```

The schema follows the same pattern as the rest of the application: `CREATE TABLE IF NOT EXISTS` with `PRAGMA user_version` for migrations. Every table uses `datetime('now')` for timestamps — SQLite stores them as ISO 8601 strings, which sort correctly and are human-readable in the CLI.

---

## Connecting the Full Pipeline

This is Part 3 of a three-part series. Here is how the whole system fits together:

1. **[Part 1: Building an AI Research Pipeline](/blog/applied/ai-research-pipeline)** covers the research engine that generates and indexes research files into the FTS5 archive.

2. **[Part 2: AI Research Triage and Auto-Implementation](/blog/applied/ai-research-triage-implementation)** covers the scoring model that extracts actionable items and the auto-implementation system that opens draft PRs.

3. **Part 3 (this post)** covers the dashboard that lets you review, curate, reorder, and act on everything the pipeline produces.

The pipeline is a funnel: hundreds of research files narrow to dozens of actionable items, which narrow to a handful of draft PRs. At each stage, the dashboard gives you the controls to intervene. You can promote an underscored item by dragging it to the top. You can archive a stale research file to long-term storage. You can merge a PR in two clicks or close it with a confirmation dialog.

The architectural principle that ties all three parts together: **AI generates, humans curate.** The research engine and triage system run autonomously -- they fetch, score, and draft without supervision. But every decision that matters (which items to prioritize, which PRs to merge, which files to archive) happens through the dashboard, with a human in the loop. The automation handles volume; the dashboard preserves judgment.

---

## What You Learned

- **FTS5 content-sync tables** keep full-text search in lockstep with your main data through triggers, with automatic cleanup when rows are deleted. Build the triggers once; never think about FTS maintenance again.
- **SortableJS integration with Preact** requires a `useRef` for the container and careful lifecycle management -- destroy the instance when the data changes or when filters switch. The pattern applies to any vanilla DOM library you need to bridge into a virtual-DOM framework.
- **SQLite transactions** turn N individual writes into a single disk sync. For reorder operations across dozens of items, this is the difference between instant and noticeable lag.
- **System utilities as build tools**: the `zip` CLI and `scp` binary handle export and archival without adding npm dependencies to your project. The best dependency is the one you do not have.
- **Lineage tracing** across a multi-stage pipeline can be assembled at query time from the data sources you already have -- no denormalized "lineage table" needed when the data volume is small enough for direct lookups.

If you have been following this series from Part 1, you now have a complete AI research pipeline: automated ingestion, intelligent triage, auto-implementation, and a human-in-the-loop dashboard to steer all of it. Every piece is built with tools you already know -- SQLite, Express, Preact, and standard Unix utilities. No frameworks you would not bet your production systems on.
