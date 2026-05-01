---
title: "What Is Git and Why Does Every Developer Use It?"
description: "Git is the time machine every developer uses. Here's what it actually does, why it matters, and how to start using it in 10 minutes."
publishDate: 2026-05-01
author: j-martin
tier: foundations
postType: explainer
difficulty: beginner
estimatedMinutes: 10
prerequisites: []
category: devops
tags: ["git", "version-control", "github", "beginner"]
heroImage: "/images/posts/what-is-git.webp"
featured: false
draft: false
---

## Why Should You Care?

Imagine you're writing an essay and you accidentally delete a paragraph. You hit save. That paragraph is gone forever, and there's no undo button that goes back far enough. You start over, trying to remember what you wrote, and the rewrite never sounds as good as the original.

Now imagine you could rewind time. Not the whole document — just the paragraph. You'd scroll through a timeline of every change you ever made, find the version from twenty minutes ago, and pull that paragraph right back. No rewriting. No guessing.

That's Git. It's a time machine for your files.

Every professional developer on the planet uses Git. Every open-source project you've ever heard of — Linux, React, Python, VS Code — lives in a Git repository. When I say every developer, I mean it: surveys consistently show Git adoption above 95% among working programmers.

You don't need to be a programmer to benefit from Git, but if you want to be one, this is the first tool you'll reach for on day one.

## What Problem Does Git Solve?

Before Git, developers did something you've probably done with school papers:

```
essay_final.docx
essay_final_v2.docx
essay_FINAL_REAL.docx
essay_FINAL_REAL_v2_FIXED.docx
```

This is called "version control by filename," and it's terrible. You forget which version has the paragraph you liked. You forget which one your teacher reviewed. Two weeks later, you have eighteen files and no confidence that any of them is the right one.

Git solves this by keeping every version inside a single folder. Instead of copying files over and over, Git takes snapshots — quiet, invisible snapshots — of your entire project every time you tell it to. Those snapshots are stored in a hidden `.git` folder, and you can travel back to any of them at any time.

Your folder always looks clean. One copy of every file. But underneath, the entire history is preserved.

## The Building Blocks

Git has a small vocabulary. Once you learn five or six words, you can follow any Git conversation. Let me walk you through them one at a time, building up from the simplest to the most useful.

### Repository (Repo)

A **repository** is just a folder that Git is watching. That's it. When you tell Git to start tracking a folder, that folder becomes a repository.

This blog — the site you're reading right now — is a Git repository. It lives in a folder on my computer called `southernsky-blog/`, and Git is watching every file inside it: every blog post, every configuration file, every stylesheet.

You create a repository like this:

```bash
mkdir my-project
cd my-project
git init
```

That `git init` command creates a hidden `.git/` directory inside `my-project/`. From this moment on, Git is ready to start tracking changes. It hasn't tracked anything yet — it's just watching, waiting for you to tell it what to save.

### Commit

A **commit** is a snapshot. It's Git's version of "Save As," except you never have to name the file something stupid. Instead, you write a short message describing what changed.

Here are real commits from this blog's history:

```
5c8f6ad Initial commit — strategy docs and content plan
748a244 Scaffold Astro blog with content system and first seed post
b3f4b6b Add listing pages, about page, and post scaffolding CLI
4ff9483 feat: 23 seed posts, 6 cert tracks, deploy pipeline, VPS deployment
bda0259 fix: nginx redirect loop behind Caddy + rewrite FRA demo post
```

Read those messages. Each one tells a tiny story. The first commit created the project. The second added the blog framework. The third built navigation pages. The fourth added all the initial content. The fifth fixed a bug.

Those strange codes on the left (`5c8f6ad`, `748a244`) are unique IDs — think of them as serial numbers for each snapshot. Every commit gets one, and no two are ever the same.

Making a commit is a two-step process:

```bash
# Step 1: Tell Git which files to include in the snapshot
git add index.html

# Step 2: Take the snapshot with a message
git commit -m "Add homepage with navigation links"
```

The `git add` step is called **staging**. It lets you be selective — maybe you changed five files but only want to save three of them in this particular snapshot. You stage the ones you want, then commit.

Think of it like packing a box before shipping it. `git add` puts items in the box. `git commit` seals and labels the box.

### The Timeline: git log

Once you've made a few commits, you can see the entire history:

```bash
git log --oneline
```

That produces output like what I showed you above — a clean list of every snapshot, from newest to oldest. Each line is a moment in time you can return to.

When I run `git log --oneline` on this blog, I see the whole story of how it was built: from an empty idea (`Initial commit`) to the site you're reading now. Five commits, five chapters.

If I want more detail — who made each commit, when, and what the full message said — I can run `git log` without the `--oneline` flag and get the expanded view.

### Diff: Seeing What Changed

Before you commit, you'll often want to see exactly what you've changed. That's what `git diff` does.

```bash
git diff
```

This shows every line you've added, removed, or modified since your last commit. Lines you added show up with a `+` in front. Lines you removed show up with a `-`. It looks something like this:

```diff
- <h1>Welcome to my website</h1>
+ <h1>Welcome to SouthernSky Engineering Blog</h1>
```

That tells me I changed the heading text. One line removed (the old heading), one line added (the new heading). Simple.

`git diff` is one of those commands you run constantly. Before every commit, I look at the diff to make sure I'm only saving what I intend to save. It's your last chance to catch mistakes before they become part of the permanent record.

### Branch

Here's where Git gets really powerful.

A **branch** is a parallel timeline. You can create a new branch, make changes on it, and your original code stays completely untouched. If you like what you built on the branch, you merge it back. If you don't, you delete the branch and nothing happened.

This is like writing an alternate ending for your essay in a separate notebook. Your original essay is safe. If the alternate ending is better, you tear out the pages and paste them in. If it's worse, you toss the notebook.

Every Git repository starts with one branch, usually called `main`. When developers want to add a new feature, they create a branch:

```bash
# Create a new branch and switch to it
git checkout -b add-search-feature

# ... make changes, add files, commit ...

# Switch back to main when you're done
git checkout main
```

On a team, branches prevent chaos. Five developers can each work on their own branch without stepping on each other's code. When they're done, they merge their branches back into `main` one at a time.

I won't go deep into merging here — that's a topic for a future post. For now, just know that branches let you experiment safely. You can try wild ideas without any risk to the working version of your project.

### Push and Pull

So far, everything has been on your computer. Your repository, your commits, your branches — all local. But what if your hard drive dies? What if you want to share your code with someone else? What if you want to work from a different computer?

That's where remote repositories come in.

**Push** sends your commits from your computer to a remote server.
**Pull** downloads new commits from the remote server to your computer.

```bash
# Send your latest commits to the remote
git push

# Download the latest commits from the remote
git pull
```

Think of it like syncing a shared Google Doc, except you control exactly when the sync happens. Nothing is automatic — you push when you're ready to share, and you pull when you want to see what's new.

The most popular remote server for Git repositories is a website called **GitHub**. It's where developers share code, collaborate on projects, and contribute to open-source software. If Git is the tool, GitHub is the workshop where millions of builders hang out and share blueprints.

Every project in my `~/projects/` folder — this blog, the OMNI platform, SkyMaxx USA, the market data service — has a remote copy on GitHub. If my workstation caught fire tomorrow, I'd lose nothing. I'd set up a new machine, run `git pull` on each project, and be back to work within the hour.

## Putting It All Together

Let me walk you through a real workflow. Say I'm writing a new blog post (like this one). Here's what actually happens on my machine:

```bash
# 1. Check the current status — what's changed?
git status

# Git says: "modified: src/content/posts/foundations/what-is-git.md"
# That's this file. I've been writing it.

# 2. Look at what I changed
git diff

# Git shows me every line I've added to this post since my last commit.

# 3. Stage the file
git add src/content/posts/foundations/what-is-git.md

# 4. Commit with a descriptive message
git commit -m "Add Git foundations blog post for beginners"

# 5. Push to GitHub so it's backed up
git push
```

Five commands. That's the core Git workflow. `status`, `diff`, `add`, `commit`, `push`. You'll run these dozens of times a day once they become habit, and they will become habit faster than you think.

## Setting Up Git (Your First 5 Minutes)

If you want to try this yourself, here's how to get started.

**Install Git:**
- **Windows:** Download from [git-scm.com](https://git-scm.com/) and run the installer
- **Mac:** Open Terminal and run `git --version` — macOS will prompt you to install it
- **Linux:** Run `sudo apt install git` (Ubuntu/Debian) or `sudo dnf install git` (Fedora)

**Configure your identity:**

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

Git attaches your name and email to every commit you make. This is how teams know who changed what.

**Create your first repo:**

```bash
mkdir my-first-repo
cd my-first-repo
git init
```

**Make your first commit:**

```bash
echo "Hello, Git!" > README.md
git add README.md
git commit -m "My first commit"
```

Run `git log` and you'll see it — your first snapshot, timestamped and permanent. You've got version control.

## Common Beginner Questions

**"What if I make a mistake in a commit?"**

You can always make a new commit that fixes the mistake. Git doesn't judge — it just records history. Most of software development is making mistakes and fixing them, one commit at a time.

**"Do I need GitHub to use Git?"**

No. Git works entirely on your computer without any internet connection. GitHub is just one option for storing a remote copy. You can use Git for years without ever pushing to GitHub — though you'd be missing out on the backup and collaboration benefits.

**"Can I use Git for things other than code?"**

Absolutely. Writers use Git to track drafts. Lawyers use it for contract versions. Scientists use it for research data. Anything that changes over time benefits from version control. This blog post was written in a Git repository — every draft, every edit, tracked.

**"How is this different from Google Docs version history?"**

Google Docs saves automatically and shows you a timeline. Git does something similar, but you choose when to save (commit) and you write a message explaining why. That intentionality matters. Six months from now, a commit message like "Fix login bug that locked out users after password reset" tells you exactly what happened and why. Google Docs would just show you the diff with no context.

## What You Learned

- **Git** is a version control system — it tracks every change to your files over time
- A **repository** is a folder that Git watches
- A **commit** is a snapshot with a message explaining what changed
- **git diff** shows you exactly what's different since your last commit
- A **branch** is a parallel timeline for safe experimentation
- **Push** sends your commits to a remote server; **pull** downloads others' commits
- **GitHub** is the most popular place to host remote repositories
- The core workflow is five commands: `status`, `diff`, `add`, `commit`, `push`

You don't need to memorize all of this today. The best way to learn Git is to use it. Create a repository, make some changes, commit them, break something, fix it, commit again. That loop — change, commit, change, commit — is the heartbeat of every software project on Earth.

Once you're comfortable with these basics, you'll be ready to explore branching strategies, merge conflicts, and collaboration workflows. But that's future you's problem. For now, you've got the foundation. Go make your first commit.
