---
title: "Backups Are Boring Until You Lose Everything — Here's My 5-Tier System"
description: "I built a 5-tier backup system for my workstation: project files, AI config, API tools, system config, and evidentiary archives. Here's the architecture."
publishDate: 2026-04-16
author: j-martin
tier: foundations
postType: project-walkthrough
difficulty: beginner
estimatedMinutes: 10
prerequisites: []
category: linux
tags: ["backups", "bash", "rsync", "disaster-recovery", "sysadmin"]
certTracks: ["comptia-a-plus", "comptia-linux-plus"]
featured: false
heroImage: "/images/posts/backups-5-tier-system.webp"
draft: false
---

## Why Should You Care?

I run a solo engineering operation: custom AI infrastructure, deployed web services, a documentary project with years of personal archives, and dozens of API integrations with OAuth tokens that took hours to configure. If my workstation drive failed today, what would I actually lose?

Before I built this system: everything. After: maybe an hour of recent work.

Backup philosophy is deceptively simple — copy important files somewhere else. The complexity is in the *triage*: figuring out what matters, how often it changes, and how catastrophic losing it would be. That triage shapes your entire strategy.

## The Three Backup Destinations

I use two physical destinations and one cloud:

**SanDisk 2TB external drive** (`/mnt/backup-drive`, exFAT) — primary backup target. Cross-platform filesystem means I can read it from any OS. Plugs in when I run backups, unplugs when I don't — an offline copy is immune to ransomware and accidental `rm -rf`.

**GitHub private repo** (`StankyDanko/claude-config-backup`) — sanitized cloud mirror of AI config and code. No credentials, no conversation history, just code and settings. Survives the house burning down.

**The workstation itself** — working copy. Not a backup, but the source of truth for everything actively in progress.

## The 5-Tier Architecture

The tiers are ordered by criticality and recovery cost.

### Tier 1a — Critical Project Data

The data that's hardest to recreate. My documentary project (ScorsAI) includes processed AI analysis, Qdrant vector database snapshots, and years of source material. Losing this means losing actual work, not just configuration.

```bash
rsync -av --delete \
  ~/projects/scorsai/ \
  /mnt/backup-drive/backups/scorsai/
```

The `--delete` flag is important: it removes files from the backup that you've deleted from the source. Without it, old deleted files pile up and the backup diverges from reality over time.

### Tier 1b — Evidentiary Archive

This one is unique to my setup but illustrates a general principle: some data is irreplaceable because it's a historical record, not just a file. My `~/projects/digital-life-mgmt/archive/` is about 35GB of timestamped correspondence, recordings, and documents — the raw material for the documentary.

```bash
rsync -av \
  ~/projects/digital-life-mgmt/archive/ \
  /mnt/backup-drive/backups/archive/
```

No `--delete` here — I want the backup to accumulate even if I reorganize source files. This is a preservation copy, not a sync.

### Tier 2 — AI and Claude Configuration

This one surprised me when I first inventoried it. My `~/.claude/` directory contains months of accumulated context: memory files, skills, agent configurations, and conversation history. The conversation history is too large to push to GitHub (sensitive + huge), but the memory and skills are just markdown and JSON — lightweight, valuable, easy to lose.

```bash
rsync -av --exclude='*.jsonl' \
  ~/.claude/ \
  /mnt/backup-drive/backups/claude/
```

The `--exclude='*.jsonl'` skips conversation history files. They're enormous and contain sensitive content. Memory files and skills are what actually matter for continuity.

The sanitized subset (memory, skills, agents, settings, AI scripts code) also goes to GitHub:

```bash
cd ~/projects/claude-config-backup
rsync -av --exclude='*.jsonl' --exclude='.env*' \
  ~/.claude/projects/ ./projects/
git add -A && git commit -m "weekly sync $(date +%Y-%m-%d)"
git push
```

### Tier 3 — API Tools and OAuth Tokens

OAuth tokens for Gmail and YouTube APIs are a specific kind of headache. You can't just store them in a password manager — they're files on disk (`credentials.json`, `token.pickle`) that your scripts reference by path. If you lose them and your app is in production, you need to go through the OAuth consent screen again.

```bash
rsync -av \
  --exclude='node_modules/' \
  --exclude='venv/' \
  --exclude='__pycache__/' \
  ~/tools/ai-scripts/ \
  /mnt/backup-drive/backups/api-tools/ai-scripts/
```

The excludes matter — `node_modules/` and `venv/` are reproducible from `package.json` and `requirements.txt`. Backing them up wastes space and time. Back the config, not the cache.

### Tier 4 — System Configuration

The smallest tier but often the most annoying to lose. This covers:

- `~/.bashrc` — shell configuration built up over years
- `~/.ssh/` — private keys and known hosts
- `~/.env-keys` — centralized API key file
- `~/CLAUDE.md` — the instruction file that defines how Claude behaves in this environment
- The backup scripts themselves

```bash
rsync -av \
  ~/.bashrc \
  ~/.ssh/ \
  ~/.env-keys \
  ~/CLAUDE.md \
  ~/tools/backup/ \
  /mnt/backup-drive/backups/system/
```

Losing SSH private keys means you're locked out of your VPS and any other remote server you've configured key-based auth for. The recovery process is painful (requires console access or having previously authorized a backup key). Back these up.

## The Orchestrator Script

Rather than remembering to run five separate commands, I have a single orchestrator script at `~/tools/backup/sandisk-backup-all.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "[DRY RUN] Showing what would be backed up"
fi

RSYNC_OPTS="-av --delete"
if $DRY_RUN; then
  RSYNC_OPTS="$RSYNC_OPTS --dry-run"
fi

# Verify destination is mounted
if ! mountpoint -q /mnt/backup-drive; then
  echo "ERROR: /mnt/backup-drive is not mounted. Aborting."
  exit 1
fi

echo "=== Tier 1a: ScorsAI ==="
rsync $RSYNC_OPTS ~/projects/scorsai/ /mnt/backup-drive/backups/scorsai/

echo "=== Tier 1b: Archive ==="
rsync -av ~/projects/digital-life-mgmt/archive/ /mnt/backup-drive/backups/archive/

echo "=== Tier 2: Claude config ==="
rsync $RSYNC_OPTS --exclude='*.jsonl' ~/.claude/ /mnt/backup-drive/backups/claude/

echo "=== Tier 3: API tools ==="
rsync $RSYNC_OPTS \
  --exclude='node_modules/' --exclude='venv/' --exclude='__pycache__/' \
  ~/tools/ai-scripts/ /mnt/backup-drive/backups/api-tools/

echo "=== Tier 4: System config ==="
rsync -av ~/.bashrc ~/.ssh/ ~/.env-keys ~/CLAUDE.md \
  ~/tools/backup/ /mnt/backup-drive/backups/system/

echo ""
echo "Backup complete. $(date)"
```

The `mountpoint -q` check at the top is critical. Without it, if the SanDisk isn't plugged in, rsync will happily "back up" to a local directory — which isn't a backup at all.

Run it with `--dry-run` first to see what would transfer without actually writing anything:

```bash
~/tools/backup/sandisk-backup-all.sh --dry-run
```

## When to Run It

I don't use a cron job for this. Cron-based backups to an external drive can fail silently (drive not mounted, drive full, network issue) and you won't find out until you need the backup. Instead I run this manually every Sunday.

The discipline looks like this:

1. Plug in SanDisk
2. Run `~/tools/backup/sandisk-backup-all.sh`
3. Push the GitHub mirror: `cd ~/projects/claude-config-backup && git push`
4. Unplug SanDisk

It takes about 10 minutes. The first run after adding new content takes longer — subsequent runs are fast because rsync only transfers changed files.

## Remounting After Unplug

The SanDisk is exFAT formatted (cross-platform). If you unplug and replug without a clean unmount:

```bash
sudo mount -t exfat -o uid=1000,gid=1000,umask=0022 /dev/sdX2 /mnt/backup-drive
```

Check the device name first if you're unsure: `lsblk -f` shows all block devices and their filesystems.

## What You Learned

- Triage your data before designing your backup — recovery cost and criticality determine tier placement
- `rsync --delete` keeps backups in sync; omit it for preservation copies that should accumulate
- Always check that your destination is mounted before running rsync — otherwise you're not backing up anything
- OAuth tokens and SSH private keys are high-recovery-cost; back them up specifically
- An offline physical copy (external drive, unplugged) is the only backup that's immune to ransomware and accidental deletion
