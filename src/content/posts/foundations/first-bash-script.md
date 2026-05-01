---
title: "Your First Bash Script That Actually Does Something"
description: "Most bash tutorials start with 'Hello World.' This one starts with a real script that solves a real problem — and teaches you shell scripting along the way."
publishDate: 2026-05-01
author: j-martin
tier: foundations
postType: tutorial
difficulty: beginner
estimatedMinutes: 10
prerequisites: []
category: linux
tags: ["bash", "scripting", "cli", "automation"]
heroImage: "/images/posts/first-bash-script.webp"
featured: false
draft: false
---

## Why Should You Care?

You already know how to type commands into a terminal. `ls`, `cd`, maybe `mkdir`. You type them one at a time, hit Enter, wait, type the next one.

Now imagine you had to do this every morning:

1. Check if a config file exists
2. Read a value from it
3. Run a command using that value
4. Filter out some noisy output you don't care about

Four steps. Every single day. That's exactly the kind of thing you'll forget step 3 of on a Tuesday when you're tired. And that's exactly what a bash script is for.

A bash script is just a text file full of commands that run in order. That's it. You already know the commands — a script just remembers the sequence so you don't have to.

Let me show you what I mean with a real one.

## A Real Script From My Toolbox

I have a workstation I use for development. On it, I keep a bunch of small utility scripts in a `~/tools/` folder. Here's one of the simplest — a wrapper that reads a config value from a file and uses it to run another command, while cleaning up messy output:

```bash
#!/bin/bash
# run-task — reads config from a file and runs a command with it
# Keeps the value out of command history and cleans up noisy output

set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "Usage: run-task <command> [args...]" >&2
  exit 1
fi

source ~/.my-config

if [[ -z "${API_ENDPOINT:-}" ]]; then
  echo "run-task: API_ENDPOINT not set in ~/.my-config" >&2
  exit 1
fi

curl -s "$API_ENDPOINT" "$@" 2>&1 | grep -v '^DEBUG:'
```

Twenty lines. That's the whole thing. But there's a surprising amount of real engineering packed into those twenty lines. Let's take it apart.

## Line 1: The Shebang

```bash
#!/bin/bash
```

This is called a **shebang** (or hashbang). It tells your operating system which program should interpret this file. Without it, the system doesn't know if your script is bash, Python, Ruby, or something else.

Every bash script starts with this line. It's not a comment — it's an instruction to the OS itself.

Try this on your own machine. Open a terminal and create a file:

```bash
nano my-script.sh
```

Type this in:

```bash
#!/bin/bash
echo "It works."
```

Save it (Ctrl+O, Enter, Ctrl+X in nano). Then make it executable and run it:

```bash
chmod +x my-script.sh
./my-script.sh
```

You should see `It works.` printed. Congratulations — you just ran your first bash script. Everything from here builds on that.

## Line 2-3: Comments That Explain Why

```bash
# run-task — reads config from a file and runs a command with it
# Keeps the value out of command history and cleans up noisy output
```

Lines starting with `#` are comments. The computer ignores them. Humans don't.

Good comments explain **why** the script exists, not what each line does. "Reads config from a file" tells you the purpose. Compare that to a bad comment like `# this line sources a file` — that just restates the code without adding meaning.

Write comments for the person reading your script six months from now. That person is usually you.

## Line 5: The Safety Net

```bash
set -euo pipefail
```

This single line activates three safety behaviors:

| Flag | What It Does | Without It |
|------|-------------|------------|
| `-e` | Stop immediately if any command fails | Script keeps running after errors, causing chaos |
| `-u` | Treat unset variables as errors | Typos silently become empty strings |
| `-o pipefail` | A pipeline fails if *any* command in it fails | Only the last command's exit code matters |

This is the difference between a script that works and a script that works *safely*. Without `set -euo pipefail`, a typo in a variable name doesn't crash — it silently expands to nothing. Your script keeps running with an empty value where real data should be. That's how accidents happen.

**Try it yourself.** Create two scripts:

```bash
#!/bin/bash
# unsafe.sh — no safety net
echo "Starting..."
cat /nonexistent/file
echo "This still prints even though the previous command failed!"
```

```bash
#!/bin/bash
# safe.sh — with safety net
set -euo pipefail
echo "Starting..."
cat /nonexistent/file
echo "This will never print."
```

Run both. See the difference? The unsafe version keeps going. The safe version stops at the error. In production, "keeps going after an error" is almost never what you want.

## Lines 7-10: Input Validation

```bash
if [[ $# -eq 0 ]]; then
  echo "Usage: run-task <command> [args...]" >&2
  exit 1
fi
```

`$#` is a special variable — it contains the number of arguments passed to the script. If someone runs the script with no arguments, this block prints a usage message and exits.

There are a few things worth noticing here:

- **`[[ ]]`** is the modern test syntax in bash. It's safer than the older `[ ]` because it handles empty strings and special characters better.
- **`>&2`** sends the output to **stderr** (standard error) instead of stdout. Error messages belong on stderr. This matters when someone pipes your script's output somewhere — they want the real output, not your error messages mixed in.
- **`exit 1`** tells the operating system the script failed. An exit code of `0` means success. Anything else means failure. This lets other scripts check if yours worked.

This pattern — check inputs, print usage, exit with an error code — shows up in almost every well-written script.

## Line 12: Sourcing a Config File

```bash
source ~/.my-config
```

`source` reads another file and executes it in the current shell. If `~/.my-config` contains `API_ENDPOINT="https://example.com/api"`, then after this line, the variable `$API_ENDPOINT` is available in your script.

This is how you keep configuration **out of your script**. The script stays the same no matter what environment you're in — only the config file changes. That's a fundamental principle in software engineering: separate what changes from what stays the same.

The config file itself is simple. Create one:

```bash
# ~/.my-config
API_ENDPOINT="https://api.example.com"
PROJECT_NAME="my-project"
```

One variable per line. No spaces around the `=` sign (that's a bash rule — spaces break assignments).

## Lines 14-17: Checking That Config Loaded

```bash
if [[ -z "${API_ENDPOINT:-}" ]]; then
  echo "run-task: API_ENDPOINT not set in ~/.my-config" >&2
  exit 1
fi
```

Even with `set -u` enabled, this check is worth writing explicitly. Here's why:

`${API_ENDPOINT:-}` is a **default value expression**. It means "use `API_ENDPOINT` if it's set, otherwise use an empty string." Without the `:-`, referencing an unset variable under `set -u` would crash the script with a generic error. With it, you can crash *your way* — with a clear message that tells the user exactly what's wrong.

This is the difference between a script that says `"line 14: API_ENDPOINT: unbound variable"` and one that says `"run-task: API_ENDPOINT not set in ~/.my-config"`. The first makes you hunt. The second tells you exactly what to fix.

## Line 19: The Actual Work

```bash
curl -s "$API_ENDPOINT" "$@" 2>&1 | grep -v '^DEBUG:'
```

This is the line the whole script exists for. Everything before it was setup and safety. Let's unpack it:

- **`"$@"`** expands to all the arguments passed to the script, preserving quoting. If you ran `run-task --header "Content-Type: application/json"`, then `$@` becomes `--header "Content-Type: application/json"`.
- **`2>&1`** merges stderr into stdout so you can filter both streams together.
- **`| grep -v '^DEBUG:'`** pipes the output through `grep -v`, which *removes* lines matching a pattern. Any line starting with `DEBUG:` gets filtered out.

The pipe (`|`) is one of the most powerful ideas in Unix. It connects the output of one program to the input of another. Instead of building one monolithic program that does everything, you chain small programs together. Each one does one thing well.

## Build Your Own: A System Health Check

Now that you've seen how a real script works, let's build one from scratch. This script checks a few things about your system and gives you a clean summary:

```bash
#!/bin/bash
# health-check.sh — quick system health summary
# Run it anytime to see disk, memory, and uptime at a glance

set -euo pipefail

echo "=== System Health Check ==="
echo ""

# Who and where
echo "Hostname:  $(hostname)"
echo "User:      $(whoami)"
echo "Date:      $(date '+%Y-%m-%d %H:%M')"
echo ""

# Disk usage for root partition
DISK_USAGE=$(df -h / | awk 'NR==2 {print $3 " used / " $2 " total (" $5 ")"}')
echo "Disk (/):  $DISK_USAGE"

# Memory
MEM_INFO=$(free -h | awk '/Mem:/ {print $3 " used / " $2 " total"}')
echo "Memory:    $MEM_INFO"

# Uptime
echo "Uptime:    $(uptime -p)"
echo ""

# Disk warning
DISK_PCT=$(df / | awk 'NR==2 {print $5}' | tr -d '%')
if [[ "$DISK_PCT" -ge 90 ]]; then
  echo "WARNING: Disk usage is at ${DISK_PCT}%!" >&2
elif [[ "$DISK_PCT" -ge 75 ]]; then
  echo "Note: Disk usage is getting high (${DISK_PCT}%)."
else
  echo "Disk usage looks healthy."
fi
```

Save it, `chmod +x` it, run it. You'll get something like:

```
=== System Health Check ===

Hostname:  my-machine
User:      student
Date:      2026-05-01 14:30

Disk (/):  45G used / 256G total (18%)
Memory:    8.2G used / 16G total
Uptime:    up 3 days, 7 hours

Disk usage looks healthy.
```

Notice the patterns from the earlier script showing up again:

- **Shebang** on line 1
- **`set -euo pipefail`** for safety
- **Comments** explaining purpose, not syntax
- **`$(command)`** for command substitution — runs a command and captures its output as text
- **`>&2`** for warning messages
- **Conditional logic** (`if/elif/else`) to react to what the script finds

Every technique builds on the ones before it. You're not memorizing syntax — you're building a vocabulary.

## Making It Yours

Here are some things you can add to `health-check.sh` right now. Each one teaches you a new concept by actually using it:

**Add a timestamp log.** Append output to a file so you can track trends:

```bash
# At the end of health-check.sh
echo "[$(date '+%Y-%m-%d %H:%M')] Disk: ${DISK_PCT}% | Mem: $MEM_INFO" >> ~/health.log
```

**Check if a service is running:**

```bash
if systemctl is-active --quiet sshd; then
  echo "SSH:       running"
else
  echo "SSH:       not running" >&2
fi
```

**Accept an argument** to show verbose output:

```bash
if [[ "${1:-}" == "--verbose" ]]; then
  echo ""
  echo "=== Detailed Disk Usage ==="
  df -h
fi
```

Each addition is two to five lines. Each one makes the script more useful. That's how real tools grow — small, practical additions driven by real needs.

## What You Learned

Here's what just happened. You read a real script, took it apart, and built your own. Along the way you picked up:

- **Shebangs** tell the OS which interpreter to use
- **`set -euo pipefail`** makes scripts fail safely instead of silently
- **`$#`**, **`$@`**, and **`${VAR:-default}`** are how scripts handle input
- **`source`** loads config from external files — keeping scripts portable
- **Exit codes** communicate success (`0`) or failure (anything else) to other programs
- **Pipes** (`|`) chain small tools into powerful workflows
- **`>&2`** sends error output where it belongs

You didn't just learn bash syntax. You learned patterns that show up in every script you'll ever read — input validation, config separation, error handling, output filtering. These patterns are the same whether the script is 20 lines or 2,000.

The next time you catch yourself typing the same three commands in a row, stop. Open a file, add a shebang, paste those commands in, and `chmod +x` it. You just automated something real. That's how every good script starts.
