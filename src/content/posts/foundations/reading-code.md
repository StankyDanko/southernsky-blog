---
title: "How to Read Code You Didn't Write"
description: "Reading unfamiliar code is a skill, not a talent. Here's a systematic approach that works — from README to running the tests."
publishDate: 2026-05-01
author: j-martin
tier: foundations
postType: explainer
difficulty: beginner
estimatedMinutes: 9
prerequisites: []
category: career
tags: ["code-reading", "open-source", "beginner", "skills"]
heroImage: "/images/posts/reading-code.webp"
featured: false
draft: false
---

The first time you open someone else's code, it looks like gibberish. That's normal.

You see files you didn't name, functions you didn't write, abbreviations you don't recognize, and patterns that feel like someone was deliberately trying to confuse you. Your first instinct is to close the tab and pretend it never happened.

I want to tell you something that might surprise you: professional developers spend significantly more time *reading* code than writing it. Some estimates put it at a 10:1 ratio. For every hour a working programmer spends typing new code, they spend ten hours reading existing code — understanding it, tracing through it, figuring out where to make a change without breaking something.

Reading unfamiliar code is not a talent you're born with. It's a skill you build. And like any skill, it has a method.

## Why This Matters More Than You Think

If you're learning to program, you might assume the job is mostly writing code from scratch. It's not. Most professional software work looks like this:

- You join a team that has a codebase with thousands of files
- Someone asks you to fix a bug in code you've never seen
- You need to add a feature to a system designed by someone who left the company two years ago
- You want to use an open-source library and need to understand how it actually works

In all of these situations, the first thing you have to do — before you write a single line — is read. If you can read code well, you can do all of these things. If you can't, you'll be stuck, no matter how clever your own code is.

The good news: there's a systematic approach that works every time. I use it whenever I open a project I've never seen before, whether it's a small utility or a monorepo with dozens of packages.

## Think of It Like Exploring a New City

Before I walk you through the method, I want to give you a mental model.

Reading a codebase is like arriving in a city you've never visited. You wouldn't walk into a random alley and try to memorize every building. You'd start with the big picture: Where's downtown? Where are the main roads? What neighborhoods exist? Once you have that mental map, you can navigate anywhere — even the alleys — because you know where they connect to.

Code works the same way. Every project has main roads (the entry points, the core logic), neighborhoods (feature modules, utility folders), and alleys (edge cases, helper functions). Your job isn't to memorize the alleys. It's to find the main roads first.

Here's the method.

## Step 1: Read the README

This sounds so obvious that people skip it. Don't.

The README is the front door of any project. A good README tells you what the project does, how to set it up, and how to run it. In sixty seconds of reading, you can learn more about a project's purpose and structure than thirty minutes of staring at source code.

Here's a real example. I recently looked at an open-source project called Noita Explorer — a tool that lets players of the game Noita inspect their save files, view unlocked items, and even see a map of where they died. When I opened the project, the first thing I saw was the README:

> *Noita Explorer is a free, ad-free, open-source and fully client side tool to unlock perks, spells and enemy progress.*

One sentence, and I already know three critical things: it's free and open-source, it runs entirely in the browser (client-side), and it modifies game save files. That context completely changes how I'll read the code. I'm now looking for file parsing logic, a browser-based UI, and some kind of preview/undo system for safe file modifications.

If there's no README, or if it's outdated and unhelpful, that's still information. It tells you the project might be poorly documented, and you'll need to rely more heavily on the other steps.

## Step 2: Read the Manifest

Every project has a file that describes its ingredients. In JavaScript, that's `package.json`. In Rust, it's `Cargo.toml`. In Python, it's `requirements.txt` or `pyproject.toml`. These files are like the ingredient list on a cereal box — they don't tell you what the cereal tastes like, but they tell you what went into it.

Here's a simplified version of what I found in Noita Explorer's `package.json`:

```json
{
  "name": "noita-explorer",
  "private": true,
  "scripts": {
    "build": "turbo build",
    "dev": "turbo dev",
    "dev:web": "turbo dev --filter=@noita-explorer/web",
    "dev:desktop": "turbo dev --filter=@noita-explorer/desktop",
    "lint": "turbo lint"
  },
  "workspaces": [
    "apps/*",
    "packages/*"
  ]
}
```

Even if you've never seen a `package.json` before, you can extract a lot from this:

- **It's a monorepo.** The `workspaces` field tells me this project contains multiple sub-projects inside `apps/` and `packages/`.
- **It uses Turbo.** The `turbo build` and `turbo dev` commands mean this project uses Turborepo to manage builds across those sub-projects.
- **There's a web version and a desktop version.** The `dev:web` and `dev:desktop` scripts tell me this tool runs in two different environments.
- **There's a linter.** The project cares about code quality enough to have a `lint` command.

I learned all of that without reading a single line of application code. The manifest is a cheat sheet.

### What to look for in a manifest

| Language | File | What it tells you |
|----------|------|-------------------|
| JavaScript/TypeScript | `package.json` | Dependencies, scripts, entry points, workspaces |
| Rust | `Cargo.toml` | Dependencies, build targets, features, edition |
| Python | `pyproject.toml` / `requirements.txt` | Dependencies, Python version, project metadata |
| Go | `go.mod` | Module path, Go version, dependencies |

Scan the dependencies list. If you see `react` and `next`, it's a React web app built with Next.js. If you see `express`, it's an API server. If you see `pytest`, there are tests. The dependencies tell you the vocabulary this project speaks.

## Step 3: Find the Entry Point

Every program has a front door — the file where execution begins. Finding it is like finding the "You Are Here" dot on a mall map. Everything else makes more sense once you know where it starts.

The entry point depends on the language and framework:

| Framework | Entry point | What it does |
|-----------|------------|--------------|
| React (Vite) | `src/main.tsx` or `src/index.tsx` | Renders the root component |
| Next.js | `app/layout.tsx` and `app/page.tsx` | Defines the page structure |
| Express.js | `server.js` or `src/index.ts` | Starts the HTTP server |
| Python script | `main.py` or `__main__.py` | Runs the program |
| Rust | `src/main.rs` | The `fn main()` function |
| CLI tool | Check `"bin"` in `package.json` | Points to the CLI entry file |

When I opened a large Next.js project I work on — a business platform with dashboards, a CRM, API routes, and agent integrations — the folder structure looked overwhelming at first:

```
app/
  agent/
  api/
  compare/
  dashboard/
  login/
  pricing/
  layout.tsx
  page.tsx
components/
config/
hooks/
lib/
```

That's a lot of directories. But I know Next.js, so I know the entry point is `app/layout.tsx` (the shell that wraps every page) and `app/page.tsx` (the homepage). I start there. `layout.tsx` shows me the navigation structure, the fonts, the providers that wrap the whole app. `page.tsx` shows me what a user sees when they first land on the site.

From those two files, I already have the shape of the application in my head. Now I can branch out to `dashboard/` or `api/` or `agent/` when I need to understand a specific feature.

If you don't know the framework, look for files named `main`, `index`, `app`, `server`, or `entry`. Those names are almost universal.

## Step 4: Follow the Data

Once you've found the entry point, the next move is to trace how data flows through the system. This is where reading code becomes detective work, and honestly, it's the fun part.

Pick something concrete. If it's a web app, ask: "When a user clicks the login button, what happens?" Then trace it:

1. Find the login button in the UI code
2. See what function it calls
3. Follow that function to wherever it sends data (usually an API endpoint)
4. Find the API endpoint on the server side
5. See what the server does with the data (validate it, check a database, return a response)

You don't have to understand every line along the way. You're tracing a thread through the fabric, not studying every thread at once.

In the Noita Explorer project, I might ask: "How does it read a save file?" I'd look for file-reading code in the `packages/` directory, find something like a `file-systems` package, and trace from there to wherever the parsed data gets displayed in the UI.

This process works for any codebase in any language. Data goes in, gets transformed, and comes out. Follow the transformation.

## Step 5: Use Search Like a Weapon

Here's a secret that experienced developers rely on constantly: you don't have to read code linearly. Code isn't a novel. You don't start at page one and read to the end. You search.

Every code editor has a project-wide search function (`Ctrl+Shift+F` in VS Code). The command line has `grep`. Use them relentlessly.

```bash
# Find every file that mentions "authentication"
grep -r "auth" --include="*.ts" -l

# Find where a specific function is defined
grep -rn "function parseGameData" --include="*.ts"

# Find all TODO comments
grep -rn "TODO" --include="*.ts"
```

When I'm trying to understand a codebase, I search for:

- **Error messages.** If the app shows "Invalid credentials" to the user, I search for that exact string. It leads me straight to the error-handling code, which leads me to the authentication logic.
- **Function names.** If I see a function called `calculateRiskScore()`, I search for it to find everywhere it's called from. That tells me how it fits into the bigger picture.
- **File patterns.** Searching for `import.*from` in a file shows me all its dependencies — what other files it talks to.
- **Configuration keys.** Searching for environment variable names like `DATABASE_URL` shows me where the database connection is set up.

Search turns a 10,000-file codebase into a navigable space. You don't have to hold the whole thing in your head. You just have to know how to ask it questions.

## Step 6: Read the Tests

If the project has tests — and good projects do — the test files are some of the most valuable reading material in the entire codebase.

Why? Because tests are *specifications written as code*. They say exactly what each piece of the system is supposed to do, with concrete examples.

Look at a test like this:

```javascript
test("rejects passwords shorter than 8 characters", () => {
  const result = validatePassword("abc");
  expect(result.valid).toBe(false);
  expect(result.error).toBe("Password must be at least 8 characters");
});

test("accepts passwords with mixed case and numbers", () => {
  const result = validatePassword("MyPass123");
  expect(result.valid).toBe(true);
});
```

Without reading the `validatePassword` function at all, I now know:

- Passwords must be at least 8 characters
- Mixed case and numbers are valid
- The function returns an object with `valid` and `error` properties

Tests are the developer telling you, "Here's what I intended this code to do." When the code itself is confusing, the tests often make the intent crystal clear.

Look for files ending in `.test.ts`, `.spec.js`, `_test.go`, or `test_*.py`. They're usually right next to the files they're testing, or in a dedicated `__tests__/` or `tests/` directory.

## Step 7: Don't Try to Understand Everything

This might be the most important step, and it's the hardest one for beginners to accept.

You do not need to understand every line of code in a project. You never will. No one does — not even the people who wrote it. Large codebases are too big for any single person to hold in their head completely. That's fine. That's normal. That's how software works.

Your goal is to build a mental map that's good enough to navigate. You want to know where the main roads are. You want to know which neighborhoods handle which features. When you need to work on something specific, you zoom into that area and learn it deeply. Everything else stays fuzzy, and that's okay.

I work on a project with dozens of directories, hundreds of files, and configuration for everything from API routes to deployment pipelines. I don't understand all of it. I understand the parts I need to work on, and I have a vague sense of the rest. When I need to touch a new area, I use the method I just described to orient myself quickly.

This is how every professional developer operates. Not by memorizing a codebase, but by knowing how to find things fast when they need them.

## Bonus: Git as a Time Machine for Understanding

There's one more tool in your arsenal that most beginners overlook: the project's Git history.

`git log` shows you the history of every change ever made. But even more powerful is `git blame`, which shows you who changed each line of a file, and when:

```bash
git blame src/auth/login.ts
```

This produces output like:

```
a3f8c91 (Sarah Chen  2026-01-15) function validateCredentials(email, password) {
a3f8c91 (Sarah Chen  2026-01-15)   if (!email || !password) {
b7d2e04 (James Park  2026-03-22)     throw new AuthError("Email and password required");
a3f8c91 (Sarah Chen  2026-01-15)   }
```

Now I can see that Sarah wrote the original function in January, and James updated the error handling in March. If I have questions about the design, I know who to ask. If I want to understand *why* the error handling changed, I can look up James's commit message:

```bash
git show b7d2e04
```

The commit message might say something like "fix: use custom AuthError class for consistent error handling across auth module." Now I understand not just *what* changed, but *why*.

The Git history is a conversation between every developer who ever touched the code. Learn to eavesdrop on it.

## Putting It All Together

Here's the method as a checklist you can keep next to your keyboard:

1. **Read the README** — What is this project? What does it do?
2. **Read the manifest** — What are the ingredients? (`package.json`, `Cargo.toml`, `requirements.txt`)
3. **Find the entry point** — Where does execution start? (`main`, `index`, `app`)
4. **Follow the data** — Pick one feature and trace its path through the code
5. **Search, don't scroll** — Use `grep` or `Ctrl+Shift+F` to find what you need
6. **Read the tests** — They're specifications disguised as code
7. **Accept the fog** — You don't need to understand everything. Navigate, don't memorize.

The first unfamiliar codebase you open will feel overwhelming. The tenth will feel manageable. The fiftieth will feel routine. You're not getting smarter — you're building a skill. The method stays the same; you just get faster at each step.

Start with a project that interests you. Maybe an open-source tool you use every day. Clone the repo, open it in your editor, and follow the steps. You'll be surprised how much you can figure out in thirty minutes.

The code isn't gibberish. You just haven't learned how to read it yet. And now you have a method.
