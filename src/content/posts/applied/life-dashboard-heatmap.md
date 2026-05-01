---
title: "Building a Life Dashboard with Calendar Heatmaps"
description: "GitHub tracks your code contributions. I built a dashboard that tracks everything — commits, tasks, wellness — in one heatmap."
publishDate: 2026-05-01
author: j-martin
tier: applied
postType: project-walkthrough
difficulty: intermediate
estimatedMinutes: 14
prerequisites: ["javascript-basics", "sqlite"]
category: web-development
tags: ["dashboard", "heatmap", "sqlite", "preact", "productivity"]
heroImage: "/images/posts/life-dashboard-heatmap.webp"
featured: false
draft: false
---

## Why Should You Care?

GitHub has contribution heatmaps. What if your entire life had one?

Not just code commits — everything. The morning yoga you did or skipped. The three critical tasks you shipped before lunch. The fourteen-day streak you maintained across projects. All of it reduced to a single color on a grid cell, and all of those cells assembled into a month where you can see, instantly, which weeks you were firing and which ones you coasted.

I built this. It lives inside a Preact dashboard backed by SQLite, and it changed how I understand my own patterns. This post walks through the concept, the scoring model, the data pipeline, and the Preact component that renders it. By the end, you will have everything you need to build your own composite day score heatmap.

---

## The Composite Day Score

GitHub's contribution graph answers one question: "Did I push code today?" That is useful but narrow. My daily productivity depends on a lot more than commits. I have wellness habits I am trying to build. I have project milestones that span weeks. I have events and meetings that take real time even though they do not produce a commit hash.

The composite day score collapses all of those signals into a single number between 0 and 1. The number maps to a color. The color fills a grid cell. Thirty-one cells make a month. Scroll back three months and you are looking at the shape of your quarter.

The scoring model has four components:

| Component | Weight | What It Measures |
|-----------|--------|-----------------|
| Git activity | Up to 30% | Commit volume across all repos |
| Task completion | 40% | Ratio of completed tasks and events to total |
| Critical milestones | 15% | Bonus for completing items flagged as critical |
| Streak | 5-15% | Consecutive days with a score above 0.30 |

Each component contributes to a raw score that gets clamped to the [0, 1] range. There is also a penalty system: if a day is in the past and you had critical tasks you never completed, the score drops by 0.30 per missed critical. That can push you into negative territory before clamping, which triggers amber or red coloring on the grid.

---

## The Scoring Function

The scoring logic is a pure function — no side effects, no database access, no date comparisons against `Date.now()`. It takes a typed input and returns a typed result. This matters because the same function runs in two places: the Express API (server-side, for month aggregation) and the Preact frontend (client-side, for instant UI feedback).

```ts
interface DayInput {
  commits: number;
  tasksTotal: number;
  tasksCompleted: number;
  eventsTotal: number;
  eventsCompleted: number;
  criticalsTotal: number;
  criticalsCompleted: number;
  isPast: boolean;
  streakDays: number;
}

interface ScoreResult {
  score: number;
  breakdown: {
    git: number;
    tasks: number;
    criticals: number;
    streak: number;
  };
  penalty: boolean;
}
```

The implementation:

```ts
export function scoreDay(input: DayInput): ScoreResult {
  const {
    commits, tasksTotal, tasksCompleted,
    eventsTotal, eventsCompleted,
    criticalsTotal, criticalsCompleted,
    isPast, streakDays,
  } = input;

  // Git: scales with volume (0.05 at 1 commit, 0.30 at 15+)
  let git = 0;
  if (commits > 0) {
    git = Math.min(0.30, 0.05 + (Math.min(commits, 15) / 15) * 0.25);
  }

  // Tasks + events: completion ratio drives the core of the score
  const totalWork = tasksTotal + eventsTotal;
  const completedWork = tasksCompleted + eventsCompleted;
  let tasks = totalWork > 0 ? (completedWork / totalWork) * 0.40 : 0;

  // Criticals: bonus for completing high-priority milestones
  let criticals = criticalsTotal > 0
    ? (criticalsCompleted / criticalsTotal) * 0.15
    : 0;

  // Streak: rewards consistency at three tiers
  let streak = 0;
  if (streakDays >= 14) streak = 0.15;
  else if (streakDays >= 7) streak = 0.10;
  else if (streakDays >= 3) streak = 0.05;

  let penalty = false;
  let raw = git + tasks + criticals + streak;

  // Penalty: missed criticals on past days hurt
  if (isPast && criticalsTotal > 0) {
    const missed = criticalsTotal - criticalsCompleted;
    if (missed > 0) {
      raw -= missed * 0.30;
      penalty = true;
    }
  }

  const score = Math.max(0, Math.min(1, raw));

  return {
    score: Math.round(score * 100) / 100,
    breakdown: {
      git: Math.round(git * 100) / 100,
      tasks: Math.round(tasks * 100) / 100,
      criticals: Math.round(criticals * 100) / 100,
      streak: Math.round(streak * 100) / 100,
    },
    penalty,
  };
}
```

A few design decisions worth calling out:

**Git scales logarithmically, not linearly.** One commit gets you 5%. Fifteen or more maxes out at 30%. This prevents a day with 40 tiny formatting commits from outscoring a day where you shipped one large feature. The curve flattens at 15 because, in my experience, that is roughly the point where more commits stop correlating with more meaningful work.

**Tasks and events share one pool.** Calendar events (meetings, recurring appointments) count alongside tasks. The denominator is everything scheduled; the numerator is everything completed. This creates a natural incentive to mark meetings as done when they finish and to not schedule things you will skip.

**Streaks are tiered, not linear.** Three consecutive days earns 5%. Seven earns 10%. Fourteen earns the full 15%. The tiers reflect real behavioral psychology: the hardest part of a streak is days 1-3. Once you clear a week, momentum carries you. The bonus grows to match.

**Missed criticals are punitive.** Each missed critical task on a past day subtracts 0.30 from the raw score. If you had two criticals and completed neither, that is -0.60, which will almost certainly zero out the day and flag it red on the grid. This is intentional — the heatmap should make you uncomfortable when important things slip.

---

## Color Mapping

The score-to-color function is simple:

```ts
export function scoreToCellColor(
  score: number,
  penalty: boolean
): string {
  if (penalty && score <= 0) return "rgba(239, 68, 68, 0.25)";
  if (penalty) return "rgba(245, 158, 11, 0.3)";
  if (score <= 0) return "#1e293b";

  const intensity = 0.1 + score * 0.7;
  return `rgba(94, 234, 212, ${intensity.toFixed(2)})`;
}
```

Three states:

- **Red** — penalty day, score at zero. You missed criticals and had nothing else to compensate.
- **Amber** — penalty day, but other work partially recovered the score. The warning color says "something important slipped even though you were active."
- **Teal gradient** — no penalties. The alpha channel scales from 0.1 (barely visible, low score) to 0.8 (strong teal, high score). Gray/slate cells mean no data — rest days, weekends, days before the project existed.

The gradient uses teal (rgb 94, 234, 212) because it sits in the same family as GitHub's green contribution graph but reads differently enough to avoid confusion. When you scroll through a month, your eye immediately separates intense teal (productive days) from pale teal (low activity) from slate (nothing tracked).

---

## SQLite as the Backend

The heatmap needs data from multiple sources. Trying to assemble it at render time from disparate APIs would be fragile and slow. Instead, everything feeds into SQLite tables, and the monthly scoring query reads from one place.

### Core Tables

```sql
-- Tasks: daily obligations with optional project links
CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  date        TEXT NOT NULL,          -- YYYY-MM-DD
  critical    INTEGER DEFAULT 0,
  completed   INTEGER DEFAULT 0,
  project_id  INTEGER,
  from_template INTEGER DEFAULT 0,   -- auto-populated wellness tasks
  created_at  TEXT,
  completed_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- GitHub cache: daily contribution counts
CREATE TABLE IF NOT EXISTS github_cache (
  date        TEXT PRIMARY KEY,       -- YYYY-MM-DD
  commits     INTEGER DEFAULT 0,
  repos       TEXT,                   -- JSON array of {slug, count}
  fetched_at  TEXT
);

-- Commit details: per-repo commit messages for day drill-down
CREATE TABLE IF NOT EXISTS github_commits_cache (
  date        TEXT NOT NULL,
  repo_slug   TEXT NOT NULL,
  commits_json TEXT,                  -- JSON array of {message, time, files}
  fetched_at  TEXT,
  PRIMARY KEY (date, repo_slug)
);

-- Story notes: optional daily reflections
CREATE TABLE IF NOT EXISTS story_notes (
  date        TEXT PRIMARY KEY,
  note        TEXT NOT NULL,
  updated_at  TEXT
);
```

The key insight is `github_cache`. GitHub's contribution data is fetched via their GraphQL API and cached locally with a MAX-based upsert:

```sql
INSERT INTO github_cache (date, commits, fetched_at)
VALUES (?, ?, datetime('now'))
ON CONFLICT(date) DO UPDATE SET
  commits = MAX(commits, excluded.commits),
  fetched_at = datetime('now');
```

The `MAX(commits, excluded.commits)` clause is important. If you manually backfill historical data (I backfilled three months across 32 repos), you do not want a subsequent API sync to clobber your manually entered numbers with a lower count. `MAX` ensures data only moves upward.

### Wellness Templates

One of the most impactful features is auto-populated wellness tasks. I defined eight daily habits in a `task_templates` table:

| Time | Habit |
|------|-------|
| 07:00 | Morning water + breathing exercises |
| 07:30 | Yoga / stretch (20+ min) |
| 08:00 | Morning dog walk |
| 12:00 | Hydration check — 4 glasses by noon |
| 15:00 | Afternoon walk + fresh air |
| 17:00 | Exercise |
| 19:00 | Evening dog walk |
| 20:00 | Hydration total — 8 glasses |

When you open today or any future date in the day view, the server checks whether template tasks exist for that date. If not, it inserts them:

```js
function ensureTemplatesForDate(db, date) {
  const today = new Date().toISOString().slice(0, 10);
  if (date < today) return; // don't backfill past days

  const existing = db.prepare(
    "SELECT 1 FROM tasks WHERE date = ? AND from_template = 1 LIMIT 1"
  ).get(date);
  if (existing) return;

  const templates = db.prepare(
    "SELECT * FROM task_templates WHERE active = 1 ORDER BY sort_order"
  ).all();

  const insert = db.prepare(
    "INSERT INTO tasks (title, date, critical, completed, from_template, created_at) " +
    "VALUES (?, ?, ?, 0, 1, datetime('now'))"
  );

  const tx = db.transaction(() => {
    for (const t of templates) {
      insert.run(t.title, date, t.critical);
    }
  });
  tx();
}
```

These template tasks count toward the day's completion ratio. If you check off six of eight wellness habits, those six completions feed directly into the 40% task weight. The heatmap becomes a wellness tracker without any additional infrastructure. Just check boxes, and the color gets greener.

---

## Git Data Pipeline

GitHub's contribution data enters the system through a sync endpoint. On every calendar tab load, the frontend fires a POST to `/api/activity/sync`, which calls the GitHub GraphQL API:

```js
const query = `
  query($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          weeks {
            contributionDays {
              date
              contributionCount
            }
          }
        }
      }
    }
  }
`;
```

The query fetches two months of contribution data. The sync handler iterates every day in the response and upserts into `github_cache`:

```js
const upsert = db.prepare(
  "INSERT INTO github_cache (date, commits, fetched_at) " +
  "VALUES (?, ?, datetime('now')) " +
  "ON CONFLICT(date) DO UPDATE SET " +
  "commits = MAX(commits, ?), fetched_at = datetime('now')"
);

const tx = db.transaction(() => {
  for (const week of weeks) {
    for (const day of week.contributionDays) {
      upsert.run(day.date, day.contributionCount, day.contributionCount);
    }
  }
});
tx();
```

If the GitHub token is missing or the API is down, the sync fails gracefully and the calendar renders from stale cache. This is important — the heatmap should never show an error state because an external API had a bad day.

For the day drill-down view, a separate `github_commits_cache` table stores per-repo commit messages. When you click into a specific day, you see which repos had activity, how many commits each had, and the actual commit messages grouped by project with color-coded badges.

---

## Building the Heatmap Grid

The month view is a 7-column, 5-row grid. Each cell represents one day. The grid component receives an array of `DayScore` objects from the API and maps them to colored cells.

### Grid Construction

The grid always renders exactly 35 cells (5 rows of 7 days, Monday through Sunday). Days from the previous and next month fill the gaps:

```ts
function buildGrid(year: number, month: number): CellData[] {
  const cells: CellData[] = [];
  const firstDow = getFirstDayOfWeek(year, month);
  const numDays = getDaysInMonth(year, month);

  // Previous month's trailing days
  const prevMonthDays = getDaysInMonth(prevYear, prevMonth);
  for (let i = leadingDays - 1; i >= 0; i--) {
    cells.push({
      dateStr: toDateStr(prevYear, prevMonth, prevMonthDays - i),
      day: prevMonthDays - i,
      isCurrentMonth: false,
    });
  }

  // Current month
  for (let d = 1; d <= numDays; d++) {
    cells.push({
      dateStr: toDateStr(year, month, d),
      day: d,
      isCurrentMonth: true,
    });
  }

  // Next month fill
  const remaining = 35 - cells.length;
  for (let d = 1; d <= remaining; d++) {
    cells.push({
      dateStr: toDateStr(nextYear, nextMonth, d),
      day: d,
      isCurrentMonth: false,
    });
  }

  return cells;
}
```

### Rich Cell Rendering

Each cell is more than a colored square. It contains:

1. **Day number** and **score badge** (percentage in the top-right corner)
2. **Task titles** with completion checkmarks (up to three visible, "+N more" overflow)
3. **Project pills** — color-coded badges showing which repos had commits that day
4. **Commit bar** — a proportional bar showing commit volume relative to the month's peak

```tsx
<div
  class={`heatmap-cell${isFocused ? " heatmap-cell--focused" : ""}`}
  style={{ background: scoreToCellColor(score, penalty) }}
  tabIndex={0}
>
  <div class="heatmap-cell-top">
    <span class="heatmap-day-num">{day}</span>
    {score > 0 && (
      <span class="heatmap-score-badge">
        {(score * 100).toFixed(0)}%
      </span>
    )}
  </div>

  {taskItems.length > 0 && (
    <div class="heatmap-task-list">
      {taskItems.slice(0, 3).map((t) => (
        <div class={`heatmap-task-item${t.completed ? " --done" : ""}`}>
          <span>{t.completed ? "✓" : "○"}</span>
          <span>{t.critical ? "! " : ""}{t.title}</span>
        </div>
      ))}
      {taskItems.length > 3 && (
        <span class="heatmap-task-more">
          +{taskItems.length - 3}
        </span>
      )}
    </div>
  )}

  <div class="heatmap-cell-bottom">
    {cellProjects.length > 0 && (
      <div class="heatmap-pills">
        {cellProjects.slice(0, 4).map((r) => (
          <span
            class="heatmap-pill"
            style={{ background: projectColor }}
          >
            {projectName}
          </span>
        ))}
      </div>
    )}
    {commits > 0 && (
      <div
        class="heatmap-commit-bar"
        style={{
          width: `${Math.round((commits / maxCommits) * 100)}%`,
        }}
      />
    )}
  </div>
</div>
```

The result is that 80% of daily management happens from the month view without drilling in. You can scan the grid and know which days had commits (pill colors), which tasks are done (checkmarks), and how the overall score looks (cell color intensity) — all at a glance.

---

## The Day Drill-Down

Double-clicking a cell (or pressing Space on the focused cell) transitions to the day view. This is a split-panel layout:

- **Left panel:** Tasks with toggle checkboxes, commit groups with messages, calendar events, and a story note input
- **Right panel:** 24-hour timeline with events positioned by hour, and a live now-line on today's date that shows the current time

The day view fetches fresh data from `/api/activity/day?date=YYYY-MM-DD`. The server ensures wellness templates are instantiated for that date, joins tasks against projects for color-coded badges, and pulls commit details from the cache.

```ts
// Simplified day data structure
interface DayDetailData {
  date: string;
  score: number;
  penalty: boolean;
  breakdown: ScoreBreakdown;
  tasks: Task[];
  commits: {
    slug: string;
    name: string;
    color: string;
    items: { message: string; time: string; files: number }[];
  }[];
  events: CalendarEvent[];
  story_note: string | null;
}
```

Toggling a task checkbox fires a PUT to `/api/tasks/:id`, then re-fetches the day data. The score updates instantly — you can watch the percentage badge change as you check off wellness tasks.

The now-line on the timeline updates every 60 seconds:

```ts
function Timeline({ events, isToday }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    if (!isToday) return;
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, [isToday]);

  const currentMinFrac = now.getMinutes() / 60;

  // Position line within the current hour block
  return (
    <div
      class="timeline-now-line"
      style={{ top: `${currentMinFrac * 100}%` }}
    />
  );
}
```

---

## Keyboard Navigation

The entire heatmap is keyboard-driven. No mouse required:

| Key | Grid View | Day View |
|-----|-----------|----------|
| Arrow keys | Move focus between cells | — |
| Space | Enter focused day | — |
| Escape | — | Back to grid |
| `[` / `]` | — | Previous / next day |
| `<` / `>` | Previous / next month | — |
| `N` | Open quick-add task | Open quick-add task |

The quick-add input supports prefix syntax: `!` marks a task as critical, `@slug` links it to a project. So typing `!@omni Deploy auth hotfix` creates a critical task linked to the OMNI project. The input parses these prefixes, creates the task via API, and the grid refreshes with the new item visible.

The keyboard handler is a single `useEffect` that attaches to `window.keydown` and delegates to the current view:

```ts
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    if (view === "grid") handleGridKeys(e);
    else if (view === "day") handleDayKeys(e);
  };
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}, [view, focusedDay, month]);
```

Focus is tracked via Preact Signals — a single `calendarFocusedDay` signal holds the currently selected date string, and the grid component applies a violet focus ring to the matching cell.

---

## The Month Aggregation Query

The most complex piece is the server-side month endpoint. It needs to compute scores for every day in the month, including streak calculations that look back up to 60 days. Here is the flow:

1. Fetch all GitHub cache rows for the month
2. Fetch all tasks for the month, grouped by date (exclude future template tasks from the grid)
3. Fetch all calendar events for the month, grouped by date
4. Fetch task detail rows (titles, completion status) for the rich cell rendering
5. Look back 60 days to calculate the current streak length
6. For each day in the month, assemble the inputs and call `scoreDay()`
7. Compute the month's average score across days that had any activity

```js
// Streak calculation: walk backward from today
let streak = 0;
for (const dateStr of allDates) {
  if (dateStr > today) continue;
  const s = scoreDateSimple(dateStr);
  if (s >= 0.30) streak++;
  else break;
}
```

The streak threshold is 0.30 — roughly "you did something meaningful." A day with a single commit and no tasks scores about 0.05 from git alone, which would not count. A day with three tasks completed and a few commits easily clears 0.30. The bar is low enough that consistent effort qualifies but high enough that passive days do not inflate the count.

The response shape:

```ts
interface MonthActivity {
  month: string;
  days: DayScore[];       // one per day in the month
  streak: number;         // current consecutive days >= 0.30
  avg_score: number;      // mean of scored days
  projects: Project[];    // for color-coding pills
}
```

The header displays the streak count and average score alongside the month name. Over time, watching the average trend tells you whether you are improving, coasting, or declining.

---

## The Aha Moment

I backfilled three months of data across 32 active repositories. The moment the heatmap rendered for the first time with real data, I saw something I had never seen before: the shape of my own productivity.

There were clusters of intense teal — weeks where I shipped features daily and maintained wellness habits. There were gray stretches that corresponded to weeks I remembered as "busy" but that produced almost nothing measurable. There was one amber cell from a day I had flagged three tasks as critical and finished none of them, even though I had made 12 commits on other things.

That amber cell taught me something. I had been conflating activity with productivity. The scoring model does not care how many commits you made if the things that mattered — the critical tasks — did not get done. The heatmap makes that distinction visible in a way that a to-do list never can, because a to-do list does not show you six weeks of context at once.

The wellness templates changed my behavior within two days. Checking off "morning water + breathing exercises" does not feel significant in isolation. Seeing seven consecutive days of teal, knowing that those checkbox completions contributed 20-25 points to each day's score, creates a feedback loop. The heatmap gamifies the habits without any gamification framework. The color is the reward.

---

## What You Learned

- **Composite scoring** collapses multiple life signals (code, tasks, wellness, streaks) into a single 0-1 number. The scoring function is pure — no side effects, easy to test, runs on both server and client.
- **SQLite as the unifying backend** means every data source (GitHub API, manual tasks, wellness templates, calendar events) feeds into one place. The month query reads from four tables, not four APIs.
- **MAX-based upserts** protect manually backfilled data from being overwritten by automated syncs. `ON CONFLICT DO UPDATE SET commits = MAX(commits, excluded.commits)` ensures numbers only go up.
- **Wellness template auto-population** turns a task tracker into a habit tracker. Check boxes, watch the color change, build consistency.
- **Rich grid cells** (task titles, project pills, commit bars, score badges) let you manage 80% of your day from the month overview without drilling into individual dates.
- **Keyboard-first UX** with arrow navigation, Space to enter, Escape to exit, and prefix syntax for quick-add makes the dashboard feel like a terminal — fast, intentional, no reaching for the mouse.

The full implementation runs on Preact, Express 5, and better-sqlite3. The entire scoring model is under 60 lines. The heatmap grid is one component. The data pipeline is one GraphQL query and a few SQL tables. The complexity is in the concept, not the code — and that is the best kind of project to build.
