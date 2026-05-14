---
title: "FCPXML Pipeline: AI That Edits Like a Human"
description: "Describe the video you want. The system finds the clips, sequences them with J-cuts and L-cuts, and generates a Final Cut Pro timeline you can open and refine."
publishDate: 2026-05-14
author: j-martin
tier: applied
postType: project-walkthrough
difficulty: advanced
estimatedMinutes: 8
prerequisites: []
category: ai-ml
tags: ["fcpxml", "video-editing", "final-cut-pro", "pipeline", "video-production", "fcp", "xml", "southernsky"]
heroImage: "/images/posts/fcpxml-pipeline-ai-video-editor.webp"
featured: false
draft: false
---

## Why Should You Care?

The hardest part of video editing isn't the software. It's decision fatigue: which clip goes here, when does this cut happen, how do you make 40 raw recordings into something a viewer actually watches through to the end? That cognitive load is the bottleneck — and it's exactly what a pipeline should absorb.

I built a system that takes a blog post and produces a Final Cut Pro timeline you can open and immediately start refining. Not a preview. Not a storyboard. A real `.fcpxml` file with narration, B-roll, ducked ambient audio, split edits, and transition decisions already made — ready to import into FCP on my Mac Mini and hand-polish in an hour instead of a day.

This is the project showcase. The companion post covers the [J-cut and L-cut implementation in technical depth](/blog/programmatic-fcpxml-split-edits) if you want the frame math. Here I want to show you the full vision: where the pipeline starts, what it integrates, and why 750ms of audio offset is the moment it stops feeling like automation and starts feeling like an edit.

---

## The Full Pipeline

```
Blog Post
  → AI Script (Grok)
  → Teleprompter Recording (OBS on Zeus)
  → WhisperX Word-Level Alignment
  → Narrative Assembly (Qdrant semantic search via SaySee)
  → 7 Edit Rules
  → FCPXML
  → Push-to-Hera Protocol
  → Final Cut Pro 12.2 (Mac Mini M1)
```

Every stage is deterministic except the semantic search. The Grok script derives from the blog post's structure. WhisperX produces millisecond-accurate word timestamps. The edit rules are enumerated and reproducible. The FCPXML that comes out imports clean into FCP every time — no errors, no missing media warnings, no "item is not on an edit frame boundary."

The semantic search is where it gets interesting. SaySee is my video understanding system: it runs CLIP-based scene detection on every clip in my media library, stores frame-level embeddings in Qdrant, and lets me query by description. "Person at a desk, monitors in background" returns the actual clips from my B-roll library that match that scene, ranked by cosine similarity. The narrative assembler sends each narration sentence through SaySee to find footage that fits the moment.

---

## The Narrative Assembler

The core of the pipeline is `narrative-assembler.mjs`, an Express 5 Node.js service running on Zeus. It takes WhisperX-aligned JSON — an array of segments, each with a transcript and word-level start/end timestamps — and produces a complete FCPXML file ready for import.

The assembler classifies each segment into one of five visual categories:

| Category | Footage Type | Transition | Ambient Audio |
|----------|-------------|------------|---------------|
| `nature` | Outdoors, walks, yard | Cross-dissolve | L-cut, ducked -12dB |
| `screen` | Terminal, browser, IDE | Hard cut | No ambient |
| `hardware` | Gear, workstation, cables | Hard cut | No ambient |
| `personal` | Face-cam, porch, direct address | Cross-dissolve | L-cut, ducked -15dB |
| `abstract` | Concept visuals, generated | Cross-dissolve | No ambient |

Classification in the current version is keyword-based — if the segment text contains "terminal" or "deploy," it maps to `screen`; "outside" or "walk" maps to `nature`. The next iteration runs local LLM classification through Ollama to understand context instead of matching substrings.

---

## Seven Edit Rules

Before any FCPXML is written, the assembler applies seven rules to the clip sequence. These are the decisions a human editor would make instinctively; here they are explicit, enumerable, and learnable.

**1. Source diversity.** No clip file repeats back-to-back. If the semantic search returns the same source for two consecutive segments, the assembler pulls the second-ranked result.

**2. Category diversity.** No category appears three times in a row. If `nature` would be third consecutive, the assembler swaps in a `personal` or `hardware` clip. Visual monotony is the enemy of engagement.

**3. Beat detection.** Segments shorter than 2 seconds are treated as beat moments — punctuation in the narration. They get contemplative single-shot footage, no J-cut, no transition. The brevity is the effect.

**4. Density-modulated ducking.** WhisperX gives word-level timestamps. The assembler computes words-per-second for each segment and modulates ambient audio accordingly — dense narration (fast, information-heavy) gets harder ducking; sparse narration (pausing, reflective) lets the environment come up. Same category, different emotional space.

**5. Transitions.** Nature and abstract categories get cross-dissolves (0.5s). Screen and hardware get hard cuts. Hard cuts in informational sections feel decisive; dissolves in atmospheric sections feel continuous.

**6. J-cuts (10 frames / ~333ms at 30fps).** The video clip for the next segment starts 10 frames before the narration changes topic. Your eye arrives at the new shot while the current sentence finishes. The cut happens in your peripheral awareness before your conscious attention shifts.

**7. L-cuts (8 frames / ~267ms at 30fps).** Ambient audio from nature and personal clips bleeds 8 frames past the video cut. Forest sounds linger briefly into the next shot. The world doesn't snap off; it fades behind.

Rules 6 and 7 together account for about 750ms of offset across a typical two-minute edit. That is the entire difference between "computer-assembled" and "somebody edited this." The technical details of how this maps to FCPXML attributes — `audioDuration`, rational time alignment, lane architecture — are covered in the [companion post](/blog/programmatic-fcpxml-split-edits).

---

## CAIRN and Ambient Sound Tags

The L-cut decision — whether an ambient bleed makes sense — isn't just about visual category. It depends on whether the source clip has meaningful ambient audio in the first place.

CAIRN is my ambient sound classifier. Every clip that enters the media library runs through it and receives a sound signature: `wind`, `birdsong`, `keyboard`, `crowd`, `silence`, `rain`. These tags live in the media database alongside the clip metadata.

The narrative assembler queries CAIRN tags before applying L-cuts. A `nature` clip tagged `birdsong` gets an 8-frame bleed. A `nature` clip tagged `silence` (a shaded porch on a still day) does not — there is nothing worth bleeding. The system knows the difference because the sound was classified at ingest, not guessed at edit time.

---

## The Timing System

FCPXML does not use decimal seconds. It uses rational numbers — fractions whose denominators match the sequence timebase. At 30fps, every duration and offset must be an integer multiple of `1/30s`. At 29.97fps (iPhone MOVs), every value must be a multiple of `1001/30000s`.

The reason is frame alignment. FCP's internal clock ticks in frames. If your offset is `2071/30s` instead of `2070/30s`, that clip starts one frame into a frame boundary and FCP either silently retimes it or rejects the file with a warning that tells you nothing useful.

The `rational_time.py` prototype handles the conversion:

```python
def to_fcpxml(seconds: float, fps: float = 30.0) -> str:
    if fps == 29.97:
        frames = round(seconds * 30000 / 1001)
        return f"{frames * 1001}/30000s"
    frames = round(seconds * fps)
    den = int(fps)
    return f"{frames}/{den}s"
```

`to_fcpxml(69.0)` returns `"2070/30s"`. `to_fcpxml(18.5)` returns `"555/30s"`. The fraction is never reduced — keeping the denominator explicit means round-trip diffs compare cleanly without simplification mismatches.

The narrative assembler's JavaScript equivalent uses the same logic, snapping every WhisperX timestamp to the nearest frame boundary before writing XML.

---

## What the Output Looks Like

With the timing system in place, the assembler generates a complete, importable FCPXML file. The GoFundMe 7-clip assembly was the first real test: six iPhone MOVs, seven segments, one sequence, push to FCP on the Mac Mini. The generated FCPXML:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.13">
  <resources>
    <format id="r1" name="FFVideoFormat1080p30"
            frameDuration="1/30s" width="1920" height="1080"
            colorSpace="1-1-1 (Rec. 709)"/>
    <asset id="a1774" name="IMG_1774"
           uid="GOFUNDME-1774-A2026041401"
           start="0/1s" duration="7200/30s"
           hasVideo="1" hasAudio="1" format="r1">
      <media-rep kind="original-media"
        src="file:///Users/your-username/Movies/project-media/gofundme/IMG_1774.MOV"/>
    </asset>
    <!-- ... remaining assets ... -->
  </resources>
  <library>
    <event name="GoFundMe Symbiotic Test">
      <project name="GoFundMe 7-Clip v1"
               uid="GOFUNDME-PROJ-2026041401">
        <sequence format="r1" tcStart="0/1s" tcFormat="NDF"
                  duration="4590/30s" audioLayout="stereo" audioRate="48k">
          <spine>
            <asset-clip ref="a1774" name="01 - Ollie intro"
                        offset="0/30s" start="30/30s"
                        duration="2070/30s" audioRole="dialogue">
              <marker start="30/30s" duration="1/30s"
                      value="Hook - Ollie intro"/>
            </asset-clip>
            <!-- ... six more clips ... -->
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
```

The `offset` is where the clip sits on the timeline. The `start` is the in-point in the source file. The `duration` covers the edit length. Every value is a frame-aligned rational. The markers carry intent labels — human-readable notes at each clip head so when I open FCP I remember what each segment is supposed to accomplish.

The full 153-second assembly with 7 clips and 6 source MOVs imported on the first try.

---

## Push-to-Hera Protocol

Zeus writes the FCPXML. Hera runs FCP. The transfer protocol is four steps:

```bash
# 1. Stage media on Hera (one-time per project)
scp -r ~/projects/gofundme/video/raw/ hera:~/Movies/project-media/gofundme/

# 2. Validate the DTD before touching FCP
ssh hera 'xmllint --noout --dtdvalid /tmp/fcpxml19.dtd ~/Desktop/export.fcpxml'

# 3. Push the FCPXML
scp output.fcpxml hera:~/Desktop/export.fcpxml

# 4. Open it in FCP
ssh hera 'open -a "Final Cut Pro" ~/Desktop/export.fcpxml'
```

If `xmllint` produces any output, the file will not import cleanly. Silence from xmllint means FCP will accept it. The DTD validation step has saved me from a dozen wasted import attempts.

---

## The Feedback Loop

After I hand-polish the timeline in FCP — nudge a clip boundary, adjust a volume curve, swap a transition — I export the FCPXML back to Zeus and run it through `fcpxml_diff.py`:

```bash
$ python fcpxml_diff.py gofundme-v1.fcpxml gofundme-edited.fcpxml
3 clip(s) fine-tuned.

Clip 01 (01 - Ollie intro):
  - tightened by +333ms at the tail
Clip 03 (03 - Groceries line):
  - head trimmed +167ms, tail shifted to net duration -83ms
Clip 05 (05 - Three months):
  - tightened by +250ms at the tail
Overall tightening trend: avg -222ms per fine-tuned clip.
```

The diff speaks editor language — "tightened at the tail," "head trimmed," "ripple trim from head" — not XML attribute deltas. The summary is machine-readable too: the `-222ms` average tightening bias gets written to `preferences.json` and applied to the next generation pass. Over multiple round-trips, the system learns my pacing preferences without me having to articulate them explicitly.

This is the loop that makes the pipeline genuinely useful over time. Each edit session is both a production artifact and a training signal.

---

## Experiments

Three experiments live in the research lab at `~/projects/fcpxml-research/experiments/`:

**GoFundMe 7-clip** (`2026-04-14-gofundme-7clip`): The first real round-trip. Six MOVs, seven edit decisions, rational time alignment confirmed, FCP import clean. Established the push-to-Hera protocol and the marker convention.

**Glitch effects demo** (`2026-04-14-effects-demo`): Tested the Pixel Film Studios effect and transition UIDs. FCPXML 1.14 lets you reference `.moef` and `.motr` files directly by their filesystem path — the pipeline can apply purchased motion templates programmatically, no GUI required.

**Outcome trailer** (`2026-04-15-outcome-trailer`): A narrative sequence assembled from an SRT transcript of a monologue recording. This was the first test of the WhisperX-to-FCPXML path: transcript timestamps become clip boundaries, narration becomes the spine, B-roll fills the visual track. The structure that became `narrative-assembler.mjs`.

---

## Where It's Going

The current classification is keyword matching. The next version uses Ollama for zero-cost local LLM inference — "register company, go full-time" maps to `personal` because a local model understands context, not because it contains a keyword in a lookup table.

SaySee's shot-size metadata is coming into the edit rules too. Wide shots establish; medium shots carry dialogue; close shots punctuate. The sequence optimizer will enforce natural progressions — wide-to-medium flows naturally, close-to-wide needs either a cutaway or a dissolve. The pipeline will know this because SaySee classifies it at ingest.

The CommandPost MCP server (a project from early 2026 that exposes FCP's internals to LLMs via JSON tools) is on the roadmap. Once deployed on Hera, the loop tightens further: instead of generating FCPXML and pushing it, the pipeline can issue natural-language commands directly to an open FCP timeline. "Cut to scene changes in the second act. Remove silence. Apply the nature cross-dissolve to clips 4 through 7." The FCPXML generation stage becomes a fallback for complex edits rather than the primary interface.

But the loop works now. Blog post in. Rough cut out. 750ms of invisible offsets doing the editorial work that separates a sequence from an edit.

---

## Key Takeaways

- A video editing pipeline is a series of deterministic transformations: transcript timestamps become clip boundaries, category tags become transition choices, word density becomes ducking curves. Once you see the stages clearly, building each one is straightforward.
- FCPXML timing is rational arithmetic, not decimal seconds — every value must snap to a frame boundary or FCP silently retimes or rejects the file.
- J-cuts (10 frames) and L-cuts (8 frames) are ~750ms of total offset that transform computer-assembled footage into something that feels edited; the technical implementation is three lines of arithmetic per cut.
- The diff tool closes the feedback loop: human corrections in FCP become numeric preference updates that improve the next generation pass automatically.
- Ambient sound classification at ingest (CAIRN) and semantic video search (SaySee) let the pipeline make intelligent per-clip decisions instead of applying blanket rules — and both are decisions you can build incrementally, one classifier at a time.

---

**Companion post:** [J-Cuts, L-Cuts, and Programmatic FCPXML](/blog/programmatic-fcpxml-split-edits) — the frame math, FCPXML attribute mechanics, and density-modulated ducking in detail.

**Research lab:** [github.com/StankyDanko/fcpxml-research](https://github.com/StankyDanko/fcpxml-research)
