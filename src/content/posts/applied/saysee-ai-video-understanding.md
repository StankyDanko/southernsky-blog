---
title: "SaySee: The AI That Watches Your Video So You Don't Have To"
description: "Most video AI just reads the transcript. SaySee actually watches — frame by frame, at the resolution you choose. Then it lets you search 15 years of footage by meaning."
publishDate: 2026-05-14
author: j-martin
tier: applied
postType: project-walkthrough
difficulty: intermediate
estimatedMinutes: 7
prerequisites: []
category: ai-ml
tags: ["saysee", "video", "embeddings", "qdrant", "pipeline", "multimodal", "southernsky"]
heroImage: "/images/posts/saysee-ai-video-understanding.webp"
featured: false
draft: false
---

## Most Video AI Just Reads the Transcript. That's Like Judging a Movie by Its Subtitles.

Here's what most "AI video understanding" tools actually do: they run Whisper on your audio, embed the transcript, and call it a day. The video itself — the images, the faces, the body language, the visual context that makes video *video* — never gets analyzed at all.

That's not video understanding. That's audio understanding wearing a label.

I had 15 years of personal footage: concerts, travel clips, documentary interviews, random moments. Hundreds of files, no way to find anything. I wanted to search my archive the way you search the web — describe what you're looking for in plain language and get back the exact clip, the exact timestamp.

So I built SaySee — "SaySee says what it sees." The tagline isn't marketing; it's architecture.

---

## What SaySee Actually Does

SaySee processes video through a six-stage pipeline. The key distinction from every other tool is Stage 2: **See**.

Instead of stopping at the audio transcript, SaySee samples frames from the video at your chosen resolution, sends each frame to a vision model, and gets back a text description of what's visually happening at that moment. Those descriptions are then merged with the audio transcript onto a shared timeline — every moment in the video has both a visual and an audio representation.

The merged timeline gets embedded into Qdrant, a vector database. That's what makes the search work.

```bash
$ saysee search "find the clip where I'm slacklining for the first time"

1. first-day-slacklining.mp4 [00:00:00-00:00:30] (0.87)
   [SCENE] A young man stands on a hillside, hands gripping a slackline strap...
   [AUDIO] So this is my first day trying slacklining.
```

That search matched because the vision model described the scene and the transcript captured the words. Neither alone would have been enough — the query contains "slacklining" (audio could match) but also "first time" crossed with the visual context of a person tentatively gripping a strap. The combined representation is what gets you there.

---

## The L0–L4 System: Variable-Resolution Analysis

Not every video needs the same level of scrutiny. A 10-minute walk-and-talk vlog doesn't need a frame description every second. A piece of documentary interview footage might.

SaySee defines five sampling levels:

| Level | Frame Rate | Frames / Minute | When to Use |
|-------|-----------|-----------------|-------------|
| **L0** | 1 per 60s | 1 | Quick catalog — "what is this video roughly about?" |
| **L1** | 1 per 15s | 4 | Default — catches every major scene change |
| **L2** | 1 per 5s | 12 | Detailed review — fast action, frequent transitions |
| **L3** | 1 per second | 60 | Fine-grained — text on screen, brief visual moments |
| **L4** | Every frame | ~1800 at 30fps | Forensic — nothing is missed |

L1 is the right call for most footage. A 10-minute video at L1 is 40 frames — manageable for any vision model, cheap to process, and enough to capture the visual narrative. L0 lets you run a rough index over an entire archive without spending much time or money. L4 exists for when it matters that nothing slips by.

The level also maps to model selection: L0 uses a larger, more capable model (fewer frames, quality matters more). L4 uses the fastest available model (thousands of frames, throughput matters more).

---

## The Six Stages

```
Video file
    │
    ▼
[1. EXTRACT]  ffmpeg pulls frames as WebP + audio as WAV
    │     └──────────────────────┐
    ▼                            ▼
[2. SEE]                    [3. HEAR]
Vision model describes        Whisper transcribes
each frame → JSON             audio → SRT
    │                            │
    └────────────┬───────────────┘
                 ▼
           [4. MERGE]
           Visual + audio aligned on
           shared 30-second windows
                 │
                 ▼
           [5. INDEX]
           Embed each window →
           upsert into Qdrant
                 │
                 ▼
           [6. RENDER]
           .saysee.json + .saysee.md
           (human-readable timeline)
```

Every stage is idempotent — if something fails at frame 147 of 200, you fix it and resume from frame 147. Every intermediate artifact lands on disk. Nothing is hidden inside the pipeline; every stage's output is a file you can inspect.

When using a cloud vision provider (Grok or Gemini), See and Hear run in parallel — the cloud API doesn't compete for GPU with Whisper. When using a local Ollama model, they run sequentially: both need the GPU, and 12GB of VRAM can't hold a 9.5GB vision model and a 6GB Whisper model at the same time. The pipeline detects the provider and handles this automatically.

---

## The Bigger Vision: SaySee + CARN + FCPXML

SaySee answers "what do you see and hear?" That's the foundation. But the system is built for something larger.

**CARN** (the ambient sound classifier) runs alongside SaySee and tags the acoustic environment of every scene — outdoor, indoor, crowd noise, silence, music. When CARN's tags merge with SaySee's visual descriptions and transcript, every moment has three layers: what you see, what's said, and what the space sounds like.

**FCPXML** is the bridge to an actual editing timeline. I've already built tooling that generates Final Cut Pro XML from structured clip data. The goal from day one: you describe the video you want to make — "give me a 90-second cut of outdoor moments where someone's talking about connection" — and the system finds the clips, sequences them, and generates a rough cut you can open in your editor.

That's not a roadmap item. Every component is running in production today. What remains is the integration work connecting them into a single command.

---

## Providers: Local, Free, or Fast

Providers are fully pluggable — same pipeline, different backends:

```bash
# Local (free, private, sequential)
saysee process video.mp4 --provider ollama --model gemma4:e4b

# Cloud (fast, parallel, costs per frame)
saysee process video.mp4 --provider grok --model grok-4-fast-non-reasoning
saysee process video.mp4 --provider gemini --model gemini-2.5-flash
```

For privacy-sensitive material — documentary footage, anything you don't want leaving your machine — Ollama runs the entire pipeline locally. For batch processing a large archive quickly, Grok's ~60 RPM limit lets you run vision and Whisper in parallel with no quota issues. Gemini's free tier burns through quota fast on anything over ~25 frames; the paid tier is solid.

The quality difference between local Gemma 4 and cloud providers is smaller than you'd expect for frame descriptions. For standard footage, local is fine.

---

## Try It

SaySee is open source under MIT license.

**GitHub:** [github.com/StankyDanko/saysee](https://github.com/StankyDanko/saysee)

You need ffmpeg, Whisper, Ollama, and Qdrant. After that:

```bash
# Process a video at default settings
saysee process my-video.mp4

# Search everything you've indexed
saysee search "the moment everything changed"

# Drop files here and they process automatically
saysee watch
```

Once you've indexed your first archive, the search results will make the architecture click in a way that reading about it doesn't. That's by design — SaySee is the kind of tool you have to use to fully understand why it's built the way it is.

For the full technical walkthrough — every stage in detail, real code, real output, the architecture decisions that didn't make it into this post — see the companion tutorial: [Teaching AI to Watch Video: A Multi-Stage Pipeline](/blog/applied/teaching-ai-to-watch-video) (coming soon).

---

## What Makes This Different

The core insight is simple: **most video AI skips the video.**

Audio transcripts are easy. Extracting meaning from what's visually happening requires a vision model, a sampling strategy, a merge step, and a representation that captures both signals together. That's more work — but it's the only approach that actually answers the question "what's in this video?"

If you have a video archive and no way to navigate it, SaySee is the answer I built for myself. It works.

---

## Go Deeper

- **[GitHub repo](https://github.com/StankyDanko/saysee)** — full source, MIT license, install instructions
- **Companion tutorial** (coming soon) — every stage dissected with real code and real output
- **L0-L4 in practice** — start at L1, step up when you need more precision
- **Combine with CARN** — ambient sound tags add a third search dimension beyond visual and audio
- **FCPXML integration** — if you edit in Final Cut Pro, the bridge to an AI-assisted rough cut already exists
