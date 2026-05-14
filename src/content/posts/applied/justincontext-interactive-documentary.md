---
title: "JustIn Context: An Interactive AI Documentary"
description: "A documentary where the viewer talks back. An AI that watched 14 years of footage and learned to tell the story. A movement that gives the tool to anyone who needs it."
publishDate: 2026-05-14
author: j-martin
tier: applied
postType: project-walkthrough
difficulty: intermediate
estimatedMinutes: 7
prerequisites: []
category: ai-ml
tags: ["justincontext", "documentary", "ai", "interactive", "qdrant", "semantic-search", "southernsky"]
heroImage: "/images/posts/justincontext-interactive-documentary.webp"
featured: false
draft: false
---

## What If a Documentary Could Listen Back?

You already know how documentaries work. A filmmaker decided what mattered, in what order, and you watch. The story is fixed. The editorial voice is singular. You can pause, rewind, skip — but you can't ask.

What if you could?

What if, instead of watching a film tell you what to understand, you could sit with the AI that built the film's understanding — and interrogate it directly? Pull the thread you care about. Ask why. Request evidence. Follow a different path than the one the director chose.

That's the architectural premise behind **justInContext** — an interactive AI documentary I've been building since early 2026, currently in pre-production with a teaser site live at [justincontext.io](https://justincontext.io). The "In" is always capitalized — it's both the name and the concept. You're getting the subject of the documentary *in context*, possibly for the first time.

This post is about the system design: how a personal archive becomes a queryable story engine, and what it means to build a documentary where the audience's curiosity determines the path through the material. By the end, you'll be able to sketch this architecture yourself.

---

## The Archive Problem

The documentary — a 90-minute film called *Kenneth Martin* currently in pre-production — is built on top of a 14-year personal archive: video, audio, voice memos, email threads, text messages, written correspondence. Thousands of files spanning thousands of hours. Raw, unedited, accumulated over years without any organizational intent.

The challenge isn't storage. It's retrieval. Specifically: retrieval by meaning.

A traditional editor works by memory and feel — scrubbing timelines, remembering "there's a clip from 2018 where..." Human editors are expensive, can hold maybe a few hundred clips in working memory, and can't hold the whole archive simultaneously. For a project built on the thesis that the pattern across years matters more than any individual moment, that's a fundamental limitation.

The answer was ScorsAI — a semantic analysis pipeline I built specifically for this project. The pipeline does four things in sequence:

```
Raw Media → Chunk → Summarize → Synthesize → Arcs → Qdrant
```

**Chunk:** Long recordings get sliced into semantically coherent segments — not fixed-length windows, but cuts at natural breaks in content.

**Summarize:** Each chunk gets an LLM-written summary that captures what's happening, who's speaking, and what the emotional register is.

**Synthesize:** Summaries collapse upward into scene-level and sequence-level meaning. A five-minute recorded segment becomes a single structured node with timestamps, themes, and character tags.

**Arcs:** The final pass identifies narrative patterns — recurring dynamics, thematic callbacks, character arcs — across the entire archive. This is where the AI earns its place in the story. No human editor can hold 14 years of footage in working memory simultaneously and surface the pattern that shows up consistently across 2012, 2016, 2019, and 2024. The pipeline can.

Everything lands in a Qdrant vector database. The archive becomes semantically searchable. "The moment he first describes why he started recording" returns a ranked list of segments, timestamped, with surrounding context.

---

## The Stack

```
Archive (audio/video/text)
         │
         ▼
  ScorsAI Pipeline
  ┌─────────────────────────────────────────┐
  │  Whisper transcription (RTX 3080 Ti, local GPU) │
  │  Grok reasoning (arc identification)       │
  │  Gemini reasoning (synthesis, cross-ref)   │
  │  Qdrant (vector store, semantic index)     │
  └─────────────────────────────────────────┘
         │
         ▼
  justincontext.io
  ┌─────────────────────────────────────────┐
  │  Conversational AI interface            │
  │  Real evidence surfaced in-chat         │
  │  (footage clips, texts, audio, docs)    │
  │  Viewer path = viewer's questions       │
  └─────────────────────────────────────────┘
         │
         ▼
  Post-film product
  ┌─────────────────────────────────────────┐
  │  Viewer uploads their own archive       │
  │  ScorsAI runs the same pipeline on it   │
  │  They get their own first-pattern report │
  └─────────────────────────────────────────┘
```

The teaser site at justincontext.io is the first public-facing layer: a static page with a Canvas neural-network animation — nodes forming and dissolving, connections building in real time — that represents the documentary's architecture visually before the product exists. Near-black background (`#050208`). JetBrains Mono throughout. The network feels like something is already being assembled beneath the surface. That's intentional.

The full interactive product — planned as a Next.js app backed by Supabase and Stripe — launches with the film, not before. The documentary is the funnel. The product is the continuity.

---

## The Interactive Mechanic

Most documentaries are monologues. You watch, you absorb, you leave with whatever the filmmaker decided to give you.

The interactive layer inverts that. After watching *Kenneth Martin*, a viewer goes to justincontext.io and opens a conversation with the same AI pipeline that was used to build the film. The AI has the indexed archive. The viewer has their questions.

Think of it less like watching a film and more like getting to interview the archive itself. They might ask: "What pattern shows up across all nine arcs?" The AI surfaces the synthesis. They might ask: "Show me the moment where that claim is documented." The AI pulls the timestamp, the clip, the surrounding context — real footage, real texts, real evidence retrieved in real time from the Qdrant index.

The viewer's path through the archive is determined by their curiosity, not the filmmaker's editorial choice. Two viewers can watch the same 90-minute film and have completely different experiences at justincontext.io because they ask different questions.

This is the architectural innovation: the audience isn't passive. The story is traversable. The documentary sorts itself based on what you want to know.

---

## The Three Doors

The film is designed with three simultaneous distribution strategies — not alternate cuts, but the same film positioned differently for different audiences:

| Door | Pitch | Buyer |
|------|-------|-------|
| Commercial | A first-person verified account — primary-source depth | Netflix, HBO, Hulu |
| Artistic | A first-person essay film in the essay-doc tradition | A24, Participant, Sundance |
| Movement | The method anyone can apply to their own archive | Toolkit, courses, community |

The interactive AI product is load-bearing for the third door. The film demonstrates the method. The product is the method, available to anyone. The tagline isn't marketing — it's architecture: *"The AI he built to understand his own story — now yours."*

Viewers who connected with the film can upload their own corpus: email archives, voice memos, texts. ScorsAI runs the same pipeline on their data and returns a first-pattern report. The AI never diagnoses, never prescribes. It reflects and surfaces. The hard rails are baked into the system prompt and enforced at the infrastructure layer, not just the UX layer.

---

## What the Teaser Site Demonstrates

The justincontext.io teaser is a single `index.html` — no framework, no build step, pure Canvas API and inline CSS. It deploys behind nginx:alpine on the VPS, proxied through Caddy.

```html
<!-- Neural network node — the architecture made visual -->
<!-- ~120 nodes, organic drift, proximity-based connection -->
<!-- Colors: muted green #4ADE80, cyan #06B6D4, purple #9333EA -->
<!-- Against near-black #050208 -->
```

The design decision was deliberate: the site says almost nothing. No navigation, no email capture, no social links. Just a living network animation and a tagline:

*"You've never seen a movie like this before."*

The hidden door doesn't have a sign on it. The visitor should feel like they've stumbled onto something they weren't supposed to find yet.

The full interactive experience launches with the film. The teaser's job is to signal that something is being built — and that it's different from what you've seen.

---

## Status

| Component | Status |
|-----------|--------|
| justincontext.io teaser | Live (deployed 2026-03-31) |
| ScorsAI pipeline | Active development — text pass complete, FCPXML bridge in progress |
| *Kenneth Martin* documentary | Pre-production — chapter outline complete, cold open designed |
| Instagram @justInContext | Active — audience-building funnel |
| Interactive AI product | Planned for co-launch with film |
| Post-film product (viewer upload) | Designed, not yet built |

The documentary is in pre-production. The pipeline that powers the interactive product is running. The teaser is live. The architecture is clear.

---

## What You Learned

- A personal archive becomes a story engine when chunked, summarized, and embedded into a vector database — Qdrant is the right tool for semantic retrieval at this scale
- ScorsAI's four-pass pipeline (chunk → summarize → synthesize → arcs) is the architecture that makes AI-assisted documentary editing tractable across thousands of hours of material
- The interactive mechanic inverts the documentary's relationship to its audience — the viewer's questions determine the path, not the filmmaker's edit
- A three-door distribution strategy (commercial / artistic / movement) lets the same film pitch differently to different buyers without needing alternate cuts
- The post-film product is a continuity of experience, not merchandise — viewers engage with the same method that made the film, applied to their own lives

---

The teaser is at [justincontext.io](https://justincontext.io). The documentary is in production. The system already works.

Follow the build at [@justInContext](https://instagram.com/justInContext).
