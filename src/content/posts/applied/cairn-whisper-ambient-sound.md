---
title: "CAIRN: Whisper for Ambient Sound"
description: "A Python CLI that classifies ambient sound in seconds — birds, wind, rain, footsteps, silence. 527 sound classes. One command. JSON sidecars that make your entire archive searchable."
publishDate: 2026-05-14
author: j-martin
tier: applied
postType: project-walkthrough
difficulty: intermediate
estimatedMinutes: 6
prerequisites: []
category: ai-ml
tags: ["cairn", "audio", "machine-learning", "panns", "classification", "sound-classification", "cli", "python", "southernsky"]
certTracks: []
heroImage: "/images/posts/cairn-whisper-ambient-sound.webp"
featured: false
draft: false
---

## The Problem With a Folder Full of Field Recordings

I have hundreds of field recordings. Until this spring, the only way to know what was in them was to listen. That's not a workflow problem — it's a wall. And if you've ever spent twenty minutes scrubbing through recordings looking for the one with clean bird ambience, you already know exactly what I mean.

That changed on April 11, 2026, when I shipped CAIRN — a Python CLI that classifies ambient sound using a pretrained neural network and writes the results into a JSON sidecar next to your audio file. A 13-minute recording tags in roughly five seconds on a GPU. The output is fully searchable with `jq`. MIT licensed, one install command.

If you record nature, produce podcasts, cut documentary footage, or just have a folder of field audio you've never organized, this is for you.

---

## How It Started: An Evening Walk in Meriwether County

The idea came on April 9, 2026. I was walking through rural Georgia with my dog Ollie — just the two of us, gravel road, early spring dusk. We came across a turtle shell by the side of the path. I picked up a stone and placed it underneath, propping the shell up off the ground. The gesture felt right.

I didn't realize until I was home, looking at a Python file I'd just named `cairn.py`, that I'd been building a cairn. Trail markers — stones stacked to say *I was here, the path goes this way.* That's exactly what this tool does: it marks your recordings so you can navigate hours of audio without retracing every step.

The name wasn't planned. It arrived by accidental synchronicity, the way the best names do.

---

## What CAIRN Does

CAIRN runs audio files through a pretrained sound classifier and writes timestamped, structured metadata back to disk. Three commands cover the full workflow:

**Tag a single file:**

```bash
$ cairn tag morning-walk.m4a
```

```
CAIRN v0.1.0
Classifying morning-walk.m4a...
Done. Sidecar written: morning-walk.cairn.json  [4.9s]
```

**Tag an entire directory:**

```bash
$ cairn batch ./recordings/
```

```
CAIRN v0.1.0
Found 47 audio files.

[ 1/47] trailhead-apr09.m4a         → nature-ambience     4.8s
[ 2/47] road-noise-test.wav         → urban-noise         5.1s
[ 3/47] back-porch-evening.flac     → nature-ambience     4.6s
[ 4/47] kitchen-ambient.m4a         → indoor-ambient      4.9s
...
[47/47] creek-bed-apr12.wav         → nature-ambience     4.7s

47 files tagged in 3m 54s.
Errors: 0  |  Nature: 31  |  Urban: 9  |  Indoor: 5  |  Human: 2
```

**Check what backends are available:**

```bash
$ cairn backends
```

```
Backend          Status      Notes
──────────────── ─────────── ────────────────────────────────
PANNs Cnn14      available   309MB model, CUDA detected
FlexSED/CLAP     planned     L2 — open-vocabulary (v0.3 target)
Gemini Enrich    planned     L3 — narrative enrichment (v0.5 target)
```

---

## The JSON Sidecar

Every tagged file gets a `.cairn.json` sidecar written beside it. Here's real output from a field recording taken on the walk where the name came from:

```json
{
  "schema_version": "1.0",
  "file": "meriwether-apr09-evening.m4a",
  "duration_seconds": 312.7,
  "processed_in_seconds": 4.9,
  "backend": "panns-cnn14",
  "model": "Cnn14_mAP=0.431",
  "device": "cuda",
  "tagged_at": "2026-04-09T21:14:33Z",
  "dominant_category": "nature-ambience",
  "usable_for_sync": true,
  "events": [
    {
      "start_seconds": 0.0,
      "end_seconds": 312.7,
      "label": "Bird vocalization, bird call, bird song",
      "confidence": 0.791
    },
    {
      "start_seconds": 0.0,
      "end_seconds": 312.7,
      "label": "Wind noise",
      "confidence": 0.443
    },
    {
      "start_seconds": 84.0,
      "end_seconds": 127.5,
      "label": "Dog",
      "confidence": 0.612
    },
    {
      "start_seconds": 84.0,
      "end_seconds": 127.5,
      "label": "Footsteps",
      "confidence": 0.388
    },
    {
      "start_seconds": 201.0,
      "end_seconds": 231.0,
      "label": "Gravel",
      "confidence": 0.334
    }
  ]
}
```

That `events` array comes from 10-second sliding windows with 5-second overlap, confidence thresholding, event merging, and temporal non-maximum suppression. The result is a clean timeline of what's acoustically present and approximately when — without you opening the file.

Once your archive is tagged, you can query it entirely in the shell. No audio playback required:

```bash
# Every recording with clean bird ambience
find ./recordings -name "*.cairn.json" | \
  xargs jq -r 'select(.dominant_category == "nature-ambience" and .usable_for_sync == true) | .file'

# Any clip where a dog appears
find ./recordings -name "*.cairn.json" | \
  xargs jq -r 'select(.events[] | .label == "Dog" and .confidence > 0.4) | .file'

# Everything under 5 minutes with wind and no traffic
find ./recordings -name "*.cairn.json" | \
  xargs jq -r 'select(
    .duration_seconds < 300 and
    (.events[] | .label | test("Wind")) and
    (.dominant_category != "urban-noise")
  ) | .file'
```

That last query — filtering by duration, acoustic content, and category simultaneously, across hundreds of files, in under a second — is what the sidecar format makes possible.

---

## The Speed Story

CAIRN runs at approximately 16x realtime on a CUDA GPU. A 13-minute recording — 780 seconds of audio — tags in 4.9 seconds. The vast majority of that is ffmpeg resampling to 32kHz mono. The neural network inference itself takes under 300 milliseconds.

On CPU it's roughly 3-4x realtime: that same 13-minute file takes around 4 minutes. Slower, but still practical for overnight batch jobs on a laptop.

The model underneath — PANNs Cnn14_DecisionLevelMax, trained on Google's AudioSet — knows 527 sound classes. Bird species, traffic noise, musical instruments, household appliances, weather events, human activity. It's the AudioSet taxonomy, which means it covers essentially the full range of sounds you'd encounter in field recording work.

---

## Where This Lives in a Larger Pipeline

CAIRN was built to feed two systems I already had in production.

The first is SaySee — my video understanding tool. SaySee analyzes video content using scene detection and vision models. CAIRN gives it an audio layer: now a clip can be tagged for both what's visible and what's audible before any human reviews it.

The second is my FCPXML pipeline. I generate Final Cut Pro XML programmatically for documentary work. With CAIRN sidecars in place, I can write scripts that auto-select ambient audio by acoustic category, pulling only the clips tagged `nature-ambience` with `usable_for_sync: true` when I need clean underlayer.

The JSON sidecar format has a versioned schema (`schema_version: "1.0"`) so future CAIRN versions can add fields without breaking downstream parsers.

---

## Three Planned Layers

What shipped on April 11 is Layer 1. The roadmap has two more:

**L1 — PANNs (current):** Cnn14_DecisionLevelMax, 527 AudioSet classes. Knows the categorical taxonomy. Fast. Reliable. No cloud dependency.

**L2 — Open vocabulary (v0.3 target):** FlexSED or CLAP, which understand natural language descriptions of sound. Instead of matching against a fixed 527-class taxonomy, L2 will answer queries like "does this recording contain a waterfall?" or "find clips that sound like an empty church." Zero-shot, language-driven retrieval.

**L3 — Gemini enrichment (v0.5 target):** Pass the L1/L2 results to Gemini and get back a narrative description. "This recording captures a rural morning scene: sustained bird activity suggesting woodland edge habitat, intermittent wind through deciduous foliage, and a dog passing through the frame between 1:24 and 2:07." That output goes into documentary metadata — searchable, citable, human-readable.

L1 is production-stable. L2 and L3 are on the roadmap.

---

## Install and Try It

```bash
pip install cairn-audio
```

The package name is `cairn-audio` (bare `cairn` was taken on PyPI). The CLI command is still `cairn`.

Or clone and install from source:

```bash
git clone https://github.com/StankyDanko/cairn
cd cairn && pip install -e .
```

First run downloads the Cnn14 checkpoint (~309MB, cached locally after that):

```bash
$ cairn tag your-recording.m4a

CAIRN v0.1.0
Downloading Cnn14_mAP=0.431.pth (309MB)...
████████████████████████████ 100%
Saved to ~/.cairn/models/Cnn14_mAP=0.431.pth

Classifying your-recording.m4a...
Done. Sidecar written: your-recording.cairn.json  [6.1s]
```

Subsequent runs are instant — no re-download. Point it at your recordings folder and let it run.

---

## Go Deeper

This post covers what CAIRN does and why it exists. The companion technical post covers how it works — PANNs Cnn14 architecture, why inference time is constant regardless of file length, the sliding window and temporal NMS implementation, and how to use the Python API directly in your own scripts:

[Audio Fingerprinting at Scale: Building a 5-Second Ambient Sound Classifier](/blog/applied/cairn-ambient-sound-classifier)

Source, issues, and contributions: [github.com/StankyDanko/cairn](https://github.com/StankyDanko/cairn)

---

## What You Can Do Now

- **Tag your archive with one command** — `cairn batch ./recordings/` classifies everything and writes sidecars in place
- **Query by content, not filename** — `jq` filters across hundreds of files in under a second, without opening audio
- **CUDA inference runs at ~16x realtime** — a 13-minute recording tags in under 5 seconds on any NVIDIA GPU
- **The sidecar schema is versioned** — future CAIRN releases extend the format without breaking your existing queries
- **The roadmap goes further** — L2 adds natural language retrieval ("find something that sounds like a waterfall"), L3 adds narrative descriptions written by a language model
