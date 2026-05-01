---
title: "Building a Home Lab Dashboard with Preact, Express 5, and SQLite"
description: "dankMire is my personal command center — a lightweight dashboard for tracking projects, managing media assets, and monitoring my home lab."
publishDate: 2026-03-20
author: j-martin
tier: applied
postType: project-walkthrough
difficulty: intermediate
estimatedMinutes: 16
prerequisites: []
category: web-development
tags: ["preact", "express", "sqlite", "dashboard", "home-lab", "cli"]
certTracks: []
featured: false
draft: false
---

## Why Should You Care?

Every home lab grows past the point where you can keep it in your head. You have containers running, media assets scattered across drives, project tasks split between a physical notebook and three browser tabs. You could reach for Grafana + Notion + Nextcloud — or you could build one thing that fits exactly how you work.

dankMire is my answer. Preact frontend, Express 5 backend, better-sqlite3 database. No microservices. No Kubernetes. No 47 npm packages doing the same job. The constraint is the feature: when you build it yourself, it does exactly what you need and nothing you don't.

This post covers the architecture decisions, the media ingest pipeline, and the calendar CLI that I actually use every day.

---

## Stack Decisions

### Preact Instead of React

React's runtime is 45KB gzipped. Preact's is 3KB. For a dashboard running locally on hardware I control, that gap doesn't affect load time. It matters for a different reason: a smaller dependency tree means fewer things to audit and fewer surprise breaking changes.

Preact is API-compatible with React. Every hook works identically. The component model is the same. The only configuration difference is aliasing React imports in Vite:

```js
// vite.config.ts
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  plugins: [preact()],
  resolve: {
    alias: {
      react: "preact/compat",
      "react-dom": "preact/compat",
    },
  },
});
```

With that alias in place, any third-party React component runs transparently on the Preact runtime.

### Express 5 Instead of 4

Express 5 shipped in October 2024 after spending years in RC. The headline change: async errors propagate to error middleware automatically. In Express 4, an unhandled rejection inside an async route handler would either hang silently or crash the process depending on Node version. You had to remember to wrap everything in try/catch and call `next(err)`.

```js
// Express 4 — must manually catch and forward
app.get("/assets", async (req, res, next) => {
  try {
    const rows = await db.all("SELECT * FROM assets LIMIT 50");
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Express 5 — rejection propagates automatically
app.get("/assets", async (req, res) => {
  const rows = await db.all("SELECT * FROM assets LIMIT 50");
  res.json(rows);
});
```

That's reason enough to upgrade on a greenfield project.

### better-sqlite3 Instead of sqlite3 (Async)

`better-sqlite3` uses synchronous I/O via native bindings. For a local dashboard that handles one user and runs queries on demand, synchronous fits perfectly — the code is simpler, the stack traces are readable, and the overhead of async SQLite (callbacks, Promises, potential connection pool management) disappears.

The package name is slightly misleading: "better" refers to API ergonomics, not performance. It is faster than `sqlite3` in benchmarks, but the real win is that `db.prepare().get()` reads like reading.

---

## Project Structure

```
dankmire/
├── client/                    # Preact frontend (Vite)
│   ├── src/
│   │   ├── components/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── AssetGrid.tsx
│   │   │   ├── TaskBoard.tsx
│   │   │   └── SystemStatus.tsx
│   │   ├── hooks/
│   │   │   └── useApi.ts
│   │   └── main.tsx
│   └── vite.config.ts
├── server/                    # Express 5 backend
│   ├── routes/
│   │   ├── assets.ts
│   │   ├── tasks.ts
│   │   └── system.ts
│   ├── db/
│   │   ├── schema.sql
│   │   └── migrate.ts
│   └── index.ts
├── bin/
│   └── cal.mjs                # Calendar / task CLI
├── ingest/
│   └── scan.mjs               # Media ingest pipeline
└── package.json
```

Development setup: Vite dev server on port 5173 proxies `/api/*` requests to Express on port 3001. Production: Express serves the built Vite bundle from `client/dist/`.

---

## The SQLite Schema

```sql
-- schema.sql

CREATE TABLE IF NOT EXISTS assets (
  id           TEXT PRIMARY KEY,        -- BLAKE3 hash of file content
  path         TEXT NOT NULL,           -- absolute path on disk
  filename     TEXT NOT NULL,
  ext          TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  created_at   TEXT,                    -- DateTimeOriginal from ExifTool
  ingested_at  TEXT DEFAULT (datetime('now')),
  location     TEXT,                    -- "lat,lon" from EXIF GPS
  duration_s   REAL,                    -- audio/video only
  width        INTEGER,
  height       INTEGER,
  tags         TEXT DEFAULT '[]',       -- JSON array
  nas_path     TEXT,                    -- path on NAS after archive
  archived     INTEGER DEFAULT 0        -- 0=local, 1=on NAS
);

CREATE TABLE IF NOT EXISTS tasks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  project      TEXT,
  due_date     TEXT,                    -- ISO 8601 date
  priority     INTEGER DEFAULT 2,       -- 1=high, 2=medium, 3=low
  done         INTEGER DEFAULT 0,
  created_at   TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS projects (
  id           TEXT PRIMARY KEY,        -- slug, e.g. "cairn"
  name         TEXT NOT NULL,
  status       TEXT DEFAULT 'active',   -- active | paused | archived
  color        TEXT DEFAULT '#6b7280',
  created_at   TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_assets_ext      ON assets(ext);
CREATE INDEX IF NOT EXISTS idx_assets_archived ON assets(archived);
CREATE INDEX IF NOT EXISTS idx_tasks_due       ON tasks(due_date, done);
```

The `id` column uses the BLAKE3 hash of file content rather than a UUID. Deduplication is automatic: if you ingest the same file from two different paths, the second INSERT fails on the primary key constraint. No dedup logic required — the schema enforces it.

---

## Media Ingest Pipeline

Run as `node ingest/scan.mjs <directory>`. Five steps:

**Step 1: Scan.** Walk the directory tree recursively. Filter to known media extensions: `.wav`, `.mp4`, `.mov`, `.jpg`, `.png`, `.m4a`, `.mp3`, `.dng`, `.arw`.

**Step 2: Hash.** Compute BLAKE3 hash of each file's content using streaming reads. BLAKE3 is faster than MD5 on AVX2 hardware (most modern x86 CPUs) and cryptographically sound.

```js
import { createHash } from "blake3";
import { createReadStream } from "fs";

async function hashFile(path) {
  const hash = createHash();
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}
```

**Step 3: Dedup.** Check if the hash exists in `assets.id`. Skip if present.

**Step 4: ExifTool.** Extract metadata for new files. `exiftool-vendored` is a Node.js wrapper around the Perl ExifTool binary — it handles every camera manufacturer's proprietary RAW format, GPS embedding, and audio/video container metadata.

```js
import { exiftool } from "exiftool-vendored";

const tags = await exiftool.read(filePath);

const meta = {
  created_at:  tags.DateTimeOriginal?.toString() ?? null,
  location:    tags.GPSLatitude
                 ? `${tags.GPSLatitude},${tags.GPSLongitude}`
                 : null,
  width:       tags.ImageWidth   ?? tags.VideoFrameWidth  ?? null,
  height:      tags.ImageHeight  ?? tags.VideoFrameHeight ?? null,
  duration_s:  tags.Duration     ?? null,
};
```

**Step 5: Insert.** Write the asset record to SQLite. Files originating from the NAS get `archived = 1` and a populated `nas_path`.

Sample run over a 500GB footage directory:

```
$ node ingest/scan.mjs /mnt/onyx/footage/

Scanning /mnt/onyx/footage/...
Found 2,847 media files

Hashing:    2847/2847  [43.2s]
New: 1,203  Duplicate: 1,644

ExifTool:   1203/1203  [28.1s]
Inserted:   1,203 assets

Done in 73.4s
```

---

## The Calendar CLI

The most-used part of dankMire is `bin/cal.mjs` — a terminal task manager that reads from and writes to the same SQLite database as the web dashboard. No syncing, no API calls, no file formats to serialize. The database is the source of truth for both.

```bash
# Show today's tasks
node bin/cal.mjs

# Add a task
node bin/cal.mjs add "Review NAS backup output" \
  --project dankmire --due 2026-03-20 --priority 1

# Mark done
node bin/cal.mjs done 7

# Show full week
node bin/cal.mjs week

# Filter by project
node bin/cal.mjs project cairn
```

Sample output for `node bin/cal.mjs`:

```
Thursday, March 20, 2026
─────────────────────────────────────────────────────

  TODAY
  ● [1] Review NAS backup script output           high    dankmire
  ● [2] Push dankMire v0.2.0 tag                  medium  dankmire
  ○ [3] Email Jesse re: license tier decision     medium  southernsky

  OVERDUE
  ● [4] Update OMNI deploy.mjs for Express 5      high    omni
  ○ [5] Archive old location shoot footage        low     documentary

5 tasks | 2 high priority | 1 overdue
```

The rendering is raw ANSI escape codes — no terminal UI library. Filled circle (●) is priority 1, open circle (○) is priority 2-3. Overdue items are any rows with `due_date < date('now') AND done = 0`.

The underlying query for the today view:

```js
const today = new Date().toISOString().slice(0, 10); // "2026-03-20"

const tasks = db.prepare(`
  SELECT t.*, p.name AS project_name, p.color
  FROM tasks t
  LEFT JOIN projects p ON t.project = p.id
  WHERE (t.due_date = ? OR t.due_date < ?)
    AND t.done = 0
  ORDER BY t.priority ASC, t.due_date ASC
`).all(today, today);
```

---

## System Status Panel

The dashboard's system panel makes three server calls every 30 seconds.

**GPU status** — shell out to `nvidia-smi`:

```js
import { execSync } from "child_process";

function getGpuStatus() {
  const output = execSync(
    "nvidia-smi --query-gpu=temperature.gpu,utilization.gpu,memory.used,memory.total,power.draw" +
    " --format=csv,noheader,nounits",
    { encoding: "utf8" }
  ).trim();

  const [temp, util, memUsed, memTotal, power] = output.split(", ").map(Number);
  return { temp, util, memUsed, memTotal, power };
}
```

**Disk usage** — `df` parsed for monitored mount points: `/`, `/mnt/onyx`, `/mnt/sandisk2tb`.

**Service health** — `systemctl is-active <service>` for `ollama.service`, `gpu-power-limit.service`, `openwebui-https.service`. Returns `active`, `inactive`, or `failed`.

The Preact hook:

```ts
function useSystemStatus() {
  const [status, setStatus] = useState<SystemStatus | null>(null);

  useEffect(() => {
    const poll = async () => {
      const res = await fetch("/api/system");
      if (res.ok) setStatus(await res.json());
    };
    poll();
    const id = setInterval(poll, 30_000);
    return () => clearInterval(id);
  }, []);

  return status;
}
```

Thirty-second polling is deliberate. This is a status check, not a monitoring system. WebSockets would be over-engineering.

---

## NAS Archive Flow

When local disk gets tight, assets move to the Synology NAS (Atlas). The archive command:

```bash
# Copy to NAS over SMB mount
rsync -av /mnt/onyx/footage/clip.mp4 /mnt/nas/archive/footage/

# Update the database record
node bin/archive.mjs --file clip.mp4 --nas-path /archive/footage/clip.mp4
```

`bin/archive.mjs` sets `archived = 1` and populates `nas_path`. The dashboard's asset grid shows a NAS badge on archived items — a visual indicator that the file isn't on local disk before I try to open it in an editor.

Files marked `archived = 1` are excluded from local disk usage calculations on the system panel, which keeps the "available space" reading accurate.

---

## What You Learned

- **Preact over React** for personal tools: 3KB runtime, identical API, smaller dependency surface — aliasing in Vite config is the only migration step
- **Express 5** automatically propagates async errors to middleware — no more `try/catch` + `next(err)` boilerplate in every route handler
- **BLAKE3 content hashing** as the asset primary key gives you deduplication for free at the schema level — the database constraint does the work
- **better-sqlite3's synchronous API** is the right choice for single-user local tools; the code is simpler, the stack traces are cleaner, and there's no async overhead without concurrent load to justify it
- **One shared SQLite database** across a web dashboard and a terminal CLI is the simplest possible architecture — no syncing, no serialization, the database is always the source of truth
