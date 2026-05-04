---
title: "Building a Values-Aligned Offline Coding Agent for a Christian School"
description: "How I forked an open-source coding agent and gave it a conscience — a Body-Mind-Spirit architecture that keeps student data private and character central."
publishDate: 2026-05-04
author: j-martin
tier: applied
postType: project-walkthrough
difficulty: intermediate
estimatedMinutes: 16
prerequisites: ["ollama", "node.js"]
category: ai-ml
tags: ["ollama", "coding-agent", "education", "system-prompt", "offline-ai", "open-source"]
certTracks: []
featured: false
draft: false
---

## Why Should You Care?

Most AI tooling is designed for one context: a developer at a desk, building software. The instructions are productivity-focused. The personality is neutral at best, jargon-heavy at worst. The data flows through the cloud.

None of that is ideal for a classroom.

I've been building a relationship with Flint River Academy — a small private Christian school in Woodbury, Georgia — and the question that keeps surfacing is the same one every school administrator asks eventually: *Can we use AI tools without sending student data to a server we don't control?*

The answer is yes, but it requires building something intentional. This post walks through SouthernSky Code — a fork of an MIT-licensed coding agent called [Pi](https://github.com/badlogic/pi-mono) — and the design decisions that make it genuinely useful in an educational, values-grounded context.

The key insight isn't technical. It's architectural: **the values of an AI agent live in a separate layer from its capabilities.** Once you understand that, customizing an agent for any institution becomes a matter of writing a good system prompt — not retraining a model.

---

## The Problem with Generic AI in Schools

Here's a concrete scenario. A student in a coding elective is working on a Python script. They're stuck on a loop. They ask an AI assistant for help.

A generic assistant might:
- Immediately rewrite their entire approach
- Use terminology they don't know yet ("list comprehension," "generator expression")
- Fix the bug without explaining what was wrong
- Move on

That's not teaching. That's dependency-building.

A school coding assistant should behave differently. It should meet the student where they are, affirm what's working before suggesting changes, explain reasoning at a level appropriate to the question, and — critically — stop when the task is done rather than padding with unsolicited improvements.

There's also the data question. Schools operate under obligations that most developers don't think about: student privacy laws, parental trust, administrative accountability. A tool that sends code snippets, questions, and error messages to a cloud provider creates exposure that most schools aren't equipped to manage. **Running inference locally eliminates that exposure entirely.**

---

## The Architecture: Body, Mind, Spirit

SouthernSky Code separates a coding agent into three distinct layers. The names are intentional — they come from a trinitarian view of persons — but the separation is practical regardless of your theology.

```
┌─────────────────────────────────────────────┐
│                    SPIRIT                   │
│     Values · Voice · Personality · Tone     │
│     Lives in: Ollama Modelfile system prompt│
├─────────────────────────────────────────────┤
│                     MIND                    │
│     Knowledge · Skills · Project Context   │
│     Lives in: CLAUDE.md / AGENTS.md files  │
├─────────────────────────────────────────────┤
│                     BODY                    │
│  Tools · Sessions · TUI · Provider Routing  │
│  Lives in: framework packages (Pi fork)    │
└─────────────────────────────────────────────┘
```

**Body** is the framework. Tool execution, session management, the terminal UI, the provider abstraction layer. It's personality-neutral. You don't touch the Body to change how the agent speaks or what it values.

**Mind** is per-project knowledge. When you run the agent inside a codebase, it reads project-specific instruction files (CLAUDE.md, AGENTS.md) to understand what the project is, what conventions apply, what tools are available. The Mind changes depending on where you're working.

**Spirit** is the personality layer. It lives entirely in an Ollama Modelfile — specifically in the `SYSTEM` block of that Modelfile. Temperature, tone, principles, voice. To deploy the same codebase with a completely different character, you point it at a different model.

This means the same binary installation — the same `sscode` command — can run as:

```
sscode + fra-ambassador model  →  Christian academy coding tutor
sscode + custom-spirit model   →  your institution's values
sscode + sorc-opus-9b-t05      →  vanilla daily driver
```

One install. Different soul.

---

## The Base Model

The spirits layer on top of `sorc-opus-9b-t05` — a 9-billion-parameter model distilled from Claude Opus 4 outputs, running via Ollama on a local GPU with 12GB VRAM.

At 9B parameters, it fits entirely in VRAM with room to spare. Inference is fast — responses begin streaming in under two seconds. No internet required after the initial model pull.

```bash
$ ollama list | grep -E "base|fra-ambassador"
NAME                    ID              SIZE     MODIFIED
sorc-opus-9b-t05        3a8f2c9e1b4d    5.5 GB   2 days ago
fra-ambassador          d7e1a2b8f3c6    5.5 GB   1 hour ago
```

The model size is identical — spirits are just system prompts and parameters layered on top of the base. There's no additional weight, no fine-tuning, no retraining involved.

---

## Building the FRA Ambassador Spirit

The Spirit lives in an Ollama Modelfile. Here's the structure:

```modelfile
FROM sorc-opus-9b-t05

PARAMETER temperature 0.4
PARAMETER top_p 0.9
PARAMETER num_ctx 32768
# ... additional sampling parameters tuned for educational consistency

SYSTEM """You are a coding assistant for Flint River Academy, a Christian school
in Woodbury, Georgia. You help students and teachers learn technology through
hands-on building.

Core principles:
- Patience in teaching. Meet learners where they are, not where you think
  they should be.
- Excellence as stewardship. Write clean code because craftsmanship honors
  the work.
...
"""
```

The full spirit includes additional principles, behavioral guidelines, and carefully tuned sampling parameters — but the pattern is what matters here. Every principle maps to a specific failure mode of generic AI in classrooms:

| Principle | Failure it prevents |
|-----------|---------------------|
| Patience in teaching | "Jumping ahead" — giving answers the student isn't ready for |
| Excellence as stewardship | Lazy, hard-to-read code justified as "it works" |

A few parameter choices worth understanding conceptually.

### Temperature: Lower for Teaching

Educational spirits run at lower temperatures than creative/builder spirits. Lower temperature means more deterministic, more consistent outputs. For a student learning to debug, consistency matters — you want the agent to give the same reliable answer on the third attempt as the first.

### Context Window: 32768 tokens

That's roughly 25,000 words of context. Enough to hold an entire student project's worth of code plus a long conversation. The model never loses track of what was discussed earlier in a session.

---

## Building and Deploying the Spirit

With Ollama installed, creating the `fra-ambassador` model is one command:

```bash
$ ollama create fra-ambassador -f spirits/fra-ambassador/Modelfile
transferring model data
using existing layer sha256:3a8f2c9e...
creating new layer sha256:d7e1a2b8...
writing manifest
success
```

Ollama reads the `FROM` line to identify the base layer, then layers the new system prompt and parameters on top. The base model weights are reused — only the configuration layer is new. The whole operation takes about five seconds.

Verify it registered:

```bash
$ ollama show fra-ambassador --system
You are a coding assistant for Flint River Academy...
```

The system prompt, sampling parameters, and base model are all baked in. The spirit is ready.

---

## Running the Agent

With the spirit built, invoking the agent is one flag:

```bash
$ sscode --provider ollama --model fra-ambassador
```

Or, using the convenience alias defined in the project's shell scripts:

```bash
$ sscode --spirit fra-ambassador
```

The terminal UI opens. The agent is ready. It reads the current directory's CLAUDE.md or AGENTS.md file if one exists (the Mind layer), then listens for input.

Here's what a session looks like when a student is debugging a Python script:

```
Student: my for loop keeps printing the same thing over and over

fra-ambassador: Let's take a look — can you paste the loop?

Student: for i in range(10):
             print(i)
         print("done")

fra-ambassador: Good news: your loop is actually working correctly. The range(10)
generates numbers 0 through 9, and you're printing each one — that's exactly
what a for loop does.

"The same thing" made me think you might be expecting something different.
What were you hoping to see printed?

(If you expected it to only print once, that's a common misconception worth
clearing up — loops are designed to repeat. Let me know what you were going for
and we'll get there.)
```

Notice what the agent does: it confirms what's working before addressing the misunderstanding. It asks a question rather than assuming. It doesn't rewrite the student's code. That's the system prompt shaping behavior.

Compare to the base spirit's response to the same input:

```
Base: Your loop is correct. range(10) produces 0-9. print(i) runs once per
iteration. If you want a single print after the loop, the indentation on
"done" already handles that. What's the actual behavior vs expected?
```

Same information. Completely different character. The base spirit is direct and efficient. The FRA ambassador is patient and affirming. Neither is wrong — they're designed for different contexts.

---

## The Mind Layer in Practice

The Spirit defines *how* the agent communicates. The Mind defines *what* it knows about a specific project.

When a teacher sets up the agent in their classroom's shared project directory, they drop an `AGENTS.md` file at the root. This file tells the agent what concepts students have covered, what's off-limits, and how to handle questions that reach beyond the current lesson plan.

For example, a beginner Python class might specify which constructs have been introduced and which haven't — so the agent knows not to suggest a list comprehension to a student who's only learned `for` loops. It knows the class level. It knows what's been taught. It adjusts automatically.

This is the Mind layer working: project-specific context that shapes responses without modifying the values layer or the framework. SouthernSky Code's curriculum packages include ready-to-use Mind configurations for common course structures.

---

## Why This Matters for Schools Specifically

### No Student Data Leaves the Building

Every token — every character of student code, every question, every error message — is processed locally. The inference happens on hardware the school controls. The conversation history stays on disk in the school's own storage.

This is a meaningful privacy guarantee. When a student asks for help debugging code they wrote about a personal project, or when a teacher experiments with the tool before recommending it to students, that interaction is not logged on a cloud provider's servers, not subject to a third party's data retention policy, not part of a training dataset.

### No Recurring Per-Seat Costs

Cloud AI services charge per token or per seat. For a school with 30 students in a coding elective, that can add up fast — and the budget questions are real. A local Ollama deployment has one cost: the hardware it runs on, which the school may already own.

### Character Formation, Not Just Productivity

This is the part that's harder to quantify but more important to articulate. AI tools in schools often get framed as productivity boosters: faster feedback, fewer bottlenecks, more problems solved per class period.

That framing misses something.

The way an AI assistant behaves shapes students' expectations of what good help looks like. An assistant that leads with corrections teaches students to lead with corrections. An assistant that over-explains everything teaches students to tolerate verbosity. An assistant that affirms before redirecting, uses real-world examples, and stops when the task is done — that assistant models a teaching posture that has value in itself.

A values-aligned agent isn't just a productivity tool. It's a pedagogical instrument.

---

## Extending to Other Institutions

The pattern generalizes. The three-layer architecture means that any institution with distinct values can deploy a spirit tailored to their context — without touching the framework.

A **public library** might prioritize accessible language and pointing to authoritative sources. A **coding bootcamp** might want efficiency and industry terminology from day one. A **children's hospital** might need extra patience and immediate escalation to a human when topics are sensitive.

Each of those is a different Spirit. Each one leaves the Body unchanged.

The hard part isn't the technical implementation — it's the values translation work. Reading an institution's mission, understanding what behaviors serve its students, and encoding those into effective system prompts and sampling parameters requires domain knowledge that goes beyond engineering. That's where SouthernSky's deployment packages come in — we handle the values translation and tuning so institutions get an agent that genuinely reflects who they are.

---

## The Upstream Relationship

SouthernSky Code is a fork, not a rewrite. The Pi framework handles the hard parts: tool execution, session persistence, provider abstraction, the TUI. Forking rather than building from scratch means we inherit years of development effort under a permissive license.

The project tracks upstream:

```bash
$ git remote -v
origin     git@github.com:StankyDanko/southernsky-code.git (fetch)
upstream   https://github.com/badlogic/pi-mono.git (fetch)
```

When Pi ships improvements — better tool execution, new provider support, performance fixes — we can pull them:

```bash
$ git fetch upstream
$ git merge upstream/main
```

The customization lives almost entirely in the `spirits/` directory and the package naming. That separation was intentional: keep the diff small so upstream merges stay clean.

---

## What You Learned

- The Body-Mind-Spirit architecture separates framework capability, project knowledge, and institutional values into three independently configurable layers
- An Ollama Modelfile's `SYSTEM` block is sufficient to define an agent's entire personality — no fine-tuning or retraining required
- Sampling parameters have pedagogical implications — tuning for consistency matters more in teaching contexts than creative ones
- The AGENTS.md / CLAUDE.md pattern (the Mind layer) lets teachers configure project-specific context without touching the values layer
- Running inference locally is a meaningful privacy guarantee for institutions with student data obligations — no tokens leave the building
- The same framework binary serves different spirits, making institutional deployment a matter of a Modelfile and a `--model` flag

---

SouthernSky Code is built on the [Pi framework](https://github.com/badlogic/pi-mono) (MIT licensed). If you're interested in deploying a values-aligned coding agent at your institution, [get in touch](https://southernsky.cloud) — we handle the spirit tuning, curriculum integration, and local deployment so your team can focus on teaching.
