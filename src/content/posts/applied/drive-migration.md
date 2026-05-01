---
title: "Migrating Drives Without Losing Your Mind"
description: "Moving 2TB of files to a new drive doesn't have to be chaos. Here's the metadata-first approach I built to triage, plan, and execute without losing anything."
publishDate: 2026-05-01
author: j-martin
tier: applied
postType: project-walkthrough
difficulty: intermediate
estimatedMinutes: 13
prerequisites: ["bash-basics"]
category: linux
tags: ["migration", "storage", "bash", "browser-tools"]
heroImage: "/images/posts/drive-migration.webp"
featured: false
draft: false
---

## The Problem Everyone Ignores Until It's Too Late

Your old drive has 2TB of... stuff. Some of it's critical. Some of it's three copies of the same movie. There's a folder called `backup-old-2` that might contain your only copy of a project from four years ago, or it might contain nothing but temp files. How do you sort through it without losing something important?

Most people do one of two things. They copy everything to the new drive and waste half its capacity on junk they'll never open. Or they start deleting "obvious" duplicates, accidentally nuke something irreplaceable, and discover the loss six months later when they actually need it.

Both approaches fail because they skip the same step: **understanding what you have before you touch anything.**

I've migrated enough drives to know that the moment you start moving files is the moment you start making mistakes. So I built a tool that separates the two hardest parts — deciding what matters and executing the migration — into distinct phases. You plan first. You execute later. Nothing moves until you've reviewed every directory and made a deliberate choice.

This post walks through the approach, the tooling, and the workflow.

---

## The Metadata-First Principle

Here's the core insight: **you don't need to open files to understand a drive. You need metadata.**

Directory names, sizes, and depth in the tree tell you almost everything. A folder called `node_modules` at 8GB? Delete. A folder called `photos-2019` at 45GB? Keep. A folder called `misc` at 120GB? That needs a closer look — mark it for review.

The metadata-first approach works in three phases:

1. **Scan** — Collect directory sizes and paths without touching any files
2. **Triage** — Review the scan results and mark each directory: KEEP, DELETE, or REVIEW
3. **Execute** — Generate a migration plan from your decisions, then run it

Each phase is independent. You can scan today, triage over the weekend, and execute next week. The scan file is just text. The triage state saves to your browser. The migration plan is a document you can review before running a single command.

This separation is the whole point. Every catastrophic data loss story I've heard follows the same pattern: someone combined "deciding" and "doing" into a single panicked afternoon.

---

## Phase 1: Scanning the Drive

The scanner is a shell script. It does exactly one thing — runs `du` and `find` against a target path and outputs directory sizes in a tab-separated format:

```bash
#!/bin/bash
# scan-drive.sh — generates size/path pairs for triage
TARGET="${1:-.}"
DEPTH="${2:-3}"

if [ ! -d "$TARGET" ]; then
  echo "Error: $TARGET is not a directory" >&2
  exit 1
fi

echo "# Drive Triage Scan" >&2
echo "# Target: $TARGET" >&2
echo "# Depth: $DEPTH" >&2
echo "# Date: $(date -Iseconds)" >&2

find "$TARGET" -maxdepth "$DEPTH" -type d \
  -exec du -sh {} \; 2>/dev/null | sort -rh
```

Let's break down the choices:

**`find` with `-maxdepth`** — You don't need to see every nested subdirectory. Depth 3 gives you the top-level folders, their immediate children, and one more level of detail. That's almost always enough to make a KEEP/DELETE decision. Going deeper just adds noise.

**`du -sh`** — The `-s` flag summarizes each directory's total size (including all its contents), and `-h` makes it human-readable. So when you see `45G  photos-2019`, that's the total size of everything inside, not just the files at that level.

**`sort -rh`** — Sorts largest-first, human-readable. The biggest directories float to the top because those are where the most impactful decisions live. A 200GB folder you can delete saves more space than twenty 50MB folders combined.

**`2>/dev/null`** — Suppresses permission errors. Some system directories will throw `Permission denied` and that's fine — you're not migrating those anyway.

**Status output to stderr** — Notice the `>&2` redirects on the echo lines. The progress messages go to stderr so they appear in your terminal, but the actual data goes to stdout so you can redirect it cleanly to a file.

### Running the Scan

For a local drive:

```bash
bash scan-drive.sh /mnt/old-drive > scan.txt
```

For a remote machine via SSH (the script streams through stdin):

```bash
ssh user@host "bash -s /mnt/storage" < scan-drive.sh > scan.txt
```

That SSH pattern is worth noting. You're piping the script itself through stdin to the remote shell, passing the target path as an argument to `bash -s`. The output flows back through the SSH tunnel into your local `scan.txt`. No need to copy the script to the remote machine first.

The scan file looks like this:

```
1.8T    /mnt/old-drive
680G    /mnt/old-drive/media
420G    /mnt/old-drive/backups
312G    /mnt/old-drive/projects
89G     /mnt/old-drive/media/movies
75G     /mnt/old-drive/media/music
52G     /mnt/old-drive/backups/laptop-2023
45G     /mnt/old-drive/media/photos-2019
38G     /mnt/old-drive/projects/client-work
...
```

Plain text. No special format. You could read this in `less` and make decisions with a notepad. But there's a better way.

---

## Phase 2: The Triage UI

The scan data is useful but unwieldy at scale. A 2TB drive scanned to depth 3 might produce 300+ directory entries. Scrolling through a text file and mentally tracking which ones you've decided on doesn't scale.

So I built a browser-based triage tool. One HTML file. No dependencies. No build step. No server. You open it in a browser, drag your scan file onto it, and start making decisions.

### Why a Browser Tool?

This might seem like an unusual choice for what's fundamentally a filesystem operation. Why not a TUI? Why not a CLI with flags?

Three reasons:

1. **Visual density.** A table with color-coded status indicators, size highlighting, and inline notes packs more information per screen than any terminal layout. When you're reviewing 300 directories, density matters.

2. **State persistence.** The tool auto-saves your decisions to `localStorage`. You can close the browser, come back tomorrow, and pick up exactly where you left off. No config files to manage.

3. **Zero-install distribution.** It's a single `.html` file. Anyone on any OS can open it. No Python, no Node, no package manager. Double-click and go.

### The Interface

When you drop a scan file, the tool parses the `du` output and renders a table:

```
┌──────────────────────────────────┬────────┬──────────────┬─────────┐
│ Path                             │ Size   │ Notes        │ Action  │
├──────────────────────────────────┼────────┼──────────────┼─────────┤
│ media                            │ 680 GB │              │ K D R   │
│   movies                         │  89 GB │ 3 duplicates │ K D R   │
│   music                          │  75 GB │ all on Spotif│ K D R   │
│   photos-2019                    │  45 GB │ ORIGINALS    │ K D R   │
│ backups                          │ 420 GB │              │ K D R   │
│   laptop-2023                    │  52 GB │ superseded   │ K D R   │
│ projects                         │ 312 GB │              │ K D R   │
│   client-work                    │  38 GB │ still active │ K D R   │
└──────────────────────────────────┴────────┴──────────────┴─────────┘
```

Each row has three action buttons:

- **KEEP** (green) — This directory migrates to the new drive
- **DELETE** (red) — This directory gets removed before migration
- **REVIEW** (amber) — You're not sure yet — flag it for a closer look later

Clicking a status toggles it. Click KEEP again and it goes back to undecided. The decisions are non-destructive — nothing happens to the actual files. You're just building a plan.

### The Summary Bar

At the top, a live summary updates as you make decisions:

```
Total Scanned: 1.8 TB  |  DELETE: 420 GB  |  KEEP: 890 GB  |  REVIEW: 120 GB  |  After Cleanup: 1.4 TB
```

This is the number that matters most: **"After Cleanup."** It tells you whether your remaining data will fit on the target drive before you start the migration. If your new drive is 1TB and you're still at 1.4TB after deletions, you know immediately that you need to cut deeper or get a bigger drive.

### Filtering and Search

The control bar lets you filter the view:

- **All** — Every directory
- **Undecided** — Only directories you haven't triaged yet (this is where you spend most of your time)
- **Keep / Delete / Review** — Show only one category

There's also a search box that filters by path or notes. If you remember putting something in a folder called `archive` but can't remember where, type "archive" and see every match instantly.

### Notes

Every row has an inline notes field. This is more useful than it sounds. When you're triaging 300 directories, you're making quick gut decisions. The notes let you capture context:

- `"3 copies, keep the one in /media/movies/hd"`
- `"client project — check contract for retention requirements"`
- `"old node_modules, safe to nuke"`
- `"ONLY COPY of wedding photos"`

Those notes persist through saves and show up in the exported migration plan. Future-you, executing the plan at 2 AM, will thank present-you for writing `"ONLY COPY"` next to that directory.

### Persistence

The tool auto-saves your decisions to browser `localStorage` keyed by the scan filename. If you close the tab and reopen the HTML file, loading the same scan file picks up where you left off.

For more durable persistence, there's a **Save Progress** button that exports everything — the scan data, your decisions, your notes — as a JSON file. **Load Progress** reimports it. This lets you:

- Back up your triage session
- Move it to another machine
- Share it with someone else for review

---

## Phase 3: The Migration Plan

Once you've triaged every directory (the "Undecided" filter shows zero), click **Export Plan**. The tool generates a structured text document:

```
# Drive Triage Plan: old-drive-scan
# Generated: 2026-05-01T14:30:00Z
# Total: 1.8 TB

## DELETE
    89 GB  media/movies          # 3 duplicates — keep HD versions only
    75 GB  media/music           # all on streaming, backed up to cloud
    52 GB  backups/laptop-2023   # superseded by 2024 backup
    12 GB  projects/abandoned    # incomplete experiments

## KEEP
    45 GB  media/photos-2019     # ONLY COPY of wedding photos
    38 GB  projects/client-work  # still active
    28 GB  projects/tools        # custom scripts and configs
   312 GB  backups/laptop-2024   # current backup

## REVIEW
     8 GB  projects/misc         # need to check for credentials
   112 GB  media/raw-footage     # might be useful for editing
```

This document is your migration contract. It has three properties that make it valuable:

1. **Every directory is accounted for.** Nothing is in an implicit "I guess it copies over" state. Every directory was explicitly decided on.

2. **Size breakdown is included.** You can add up the KEEP column and verify it fits your target drive.

3. **Notes are inline.** The reasoning behind each decision is preserved. If you question a decision during execution, the note tells you why you made it.

### From Plan to Execution

The migration plan is deliberately text, not executable commands. This is a design choice. Generating `rm -rf` commands automatically would be convenient and terrifying. One bad path and you're losing data.

Instead, the plan is a reference document. You execute it manually, one section at a time:

**Step 1: Delete first, copy second.** Start with the DELETE section. Remove those directories from the source drive. This reduces the total data you need to transfer and saves time on the copy.

```bash
# Review each path before deleting
rm -rf /mnt/old-drive/media/movies
rm -rf /mnt/old-drive/media/music
# ...
```

**Step 2: Copy the KEEP directories.** Use `rsync` with checksums for the actual transfer:

```bash
rsync -avh --progress /mnt/old-drive/media/photos-2019 /mnt/new-drive/media/
rsync -avh --progress /mnt/old-drive/projects/client-work /mnt/new-drive/projects/
```

Why `rsync` instead of `cp`? Three reasons: it shows progress, it can resume interrupted transfers, and the `-a` flag preserves permissions, timestamps, and symlinks. If your SSH connection drops or the machine sleeps during a multi-hour transfer, `rsync` picks up where it left off instead of starting over.

**Step 3: Address the REVIEW items.** Open each REVIEW directory manually, make a final decision, and either delete or copy it.

**Step 4: Verify.** After migration, run the scanner against the new drive and compare totals. The KEEP total from your plan should roughly match the new drive's usage (accounting for filesystem overhead).

---

## Design Decisions Worth Explaining

### Why Not Just Use `ncdu`?

`ncdu` is a fantastic tool for exploring disk usage interactively. I use it all the time. But it's designed for exploration, not decision-making. It shows you what's big. It doesn't let you mark directories with decisions, attach notes, track progress across sessions, or export a plan.

The triage tool takes `ncdu`'s "show me what's big" insight and adds a decision layer on top of it.

### Why Separate the Scanner from the UI?

The scanner runs in a terminal. The triage UI runs in a browser. They communicate through a plain text file. This separation is deliberate:

- **The scanner can run anywhere** — local, remote via SSH, inside a container, on a headless server. It just needs `bash`, `find`, and `du` (which are everywhere).
- **The UI can run anywhere** — any machine with a browser. It doesn't need filesystem access to the drive being scanned.
- **The text file is the interface contract.** It's human-readable, greppable, diffable, and version-controllable. You could store scan files in git and track how a drive's contents change over time.

This also means you can scan a NAS from your workstation over SSH, triage on your laptop during a commute, and execute the migration from whichever machine has physical access to both drives. The scan file travels with you.

### Why Not Generate Executable Scripts?

I considered having the Export Plan button generate a shell script with actual `rm` and `rsync` commands. I decided against it for one reason: **the cost of a bug is too high.**

If the plan generator has a path-escaping issue, or if a directory name contains a space that breaks the command, you could lose data. By keeping the plan as a human-readable document instead of an executable script, you force a human to translate each line into a command. That translation step is where you catch mistakes.

The two-minute tax of typing `rm -rf` commands manually is cheap insurance against the multi-hour cost of recovering from an accidental deletion.

---

## The Full Workflow, Start to Finish

Let me walk through a real migration scenario. You have an old 2TB drive and a new 1TB drive. You need to fit.

**1. Scan the source drive.**

```bash
bash scan-drive.sh /mnt/old-drive > old-drive-scan.txt
```

Takes 30 seconds to 5 minutes depending on how many directories exist at depth 3.

**2. Open the triage tool and drop the scan file.**

The UI renders immediately. You see the summary: 1.8TB total across 287 directories.

**3. Start triaging.**

Work top-down by size. The biggest directories are the most impactful decisions. Click KEEP, DELETE, or REVIEW on each one. Add notes where the decision isn't obvious.

Filter to "Undecided" periodically to see how many are left. The goal is zero undecided directories.

**4. Check the math.**

The summary bar shows "After Cleanup: 940 GB." That fits on your 1TB drive. If it didn't, you'd go back and cut more from the REVIEW pile.

**5. Export the plan.**

Click Export Plan. Copy the text to a file. Read through it one more time.

**6. Execute.**

Delete first, copy second, review third. Use `rsync` with `--progress` so you can watch the transfer and catch errors in real time.

**7. Verify.**

Scan the new drive. Compare totals. Sleep well.

---

## What I Learned

Building this tool taught me something I keep relearning: **the best tools separate thinking from doing.**

Version control does this — you write code freely, then review the diff before committing. Database migrations do this — you write the schema change, review it, then apply it. Infrastructure-as-code does this — you declare the desired state, plan it, then execute.

Drive migration is the same pattern. The scan is your `terraform plan`. The triage is your code review. The migration plan is your pull request. The execution is your merge. Each phase has a checkpoint where you can stop, think, and catch mistakes.

The tool itself is about 400 lines of code — a shell script and an HTML file. It's not sophisticated. But it solved a problem that I used to handle by opening a file manager, squinting at folder sizes, and hoping I didn't delete anything important.

If you're staring down a drive migration, try the approach even without the tool. Scan first. Decide in a separate session. Write down your plan. Execute it methodically. The principle matters more than the implementation.

Your data will thank you.
