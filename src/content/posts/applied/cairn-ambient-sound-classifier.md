---
title: "Audio Fingerprinting at Scale: Building a 5-Second Ambient Sound Classifier"
description: "Cairn classifies ambient sounds in 5 seconds using PANNs Cnn14 — what took Shazam years of R&D, we built as a CLI tool. Here's the architecture."
publishDate: 2026-04-11
author: j-martin
tier: applied
postType: project-walkthrough
difficulty: intermediate
estimatedMinutes: 18
prerequisites: []
category: ai-ml
tags: ["audio", "machine-learning", "panns", "pytorch", "cli", "sound-classification"]
certTracks: []
featured: false
draft: false
---

## Why Should You Care?

You're editing documentary footage. You have 200 clips. You need to know which ones have clean natural ambience (birds, wind, water) versus intrusive urban noise (traffic, crowd chatter, AC hum). Watching all 200 clips manually is a week of work. Running them through a classifier takes three minutes.

That's the problem Cairn solves. It's a CLI tool that classifies ambient sound in audio files — what category of environmental noise is present, how confident the model is, and what the dominant acoustic events are — in roughly 5 seconds per file regardless of length. A 13-minute field recording and a 30-second clip both return results in the same wall-clock window.

This post walks through how it works, why PANNs Cnn14 was the right model choice, and what the actual JSON output looks like.

---

## The Name

A cairn is a stack of stones left as a trail marker. You follow them through wilderness when the path isn't obvious. The name felt right: Cairn marks your audio files so you can find your way through hours of field recordings without listening to all of them.

---

## The Model: PANNs Cnn14

PANNs stands for **Pretrained Audio Neural Networks**. The research came out of the University of Surrey in 2020 and represented a serious advancement in general-purpose audio classification. The Cnn14 variant is a 14-layer convolutional network trained on **AudioSet** — Google's massive dataset of ~2 million 10-second clips across 527 audio classes.

Why Cnn14 specifically, and not something newer?

1. **AudioSet coverage.** 527 classes covers the full ambient taxonomy: `Bird`, `Rain`, `Traffic noise`, `Crowd`, `Wind noise`, `Air conditioning`, `Power tools`, `Music`, `Speech`, `Dog`, `Thunder` — everything a documentary shooter would care about.

2. **Speed.** Inference on a single audio file takes ~200ms on CPU. On GPU it's near-instant. The 5-second wall-clock time is dominated by file I/O and resampling, not model inference.

3. **Pretrained weights are public.** The Surrey team released `Cnn14_mAP=0.431.pth` — a 309MB checkpoint that you download once and use forever. No training required.

4. **It's well-understood.** Newer models (EfficientAT, BEATs) exist, but Cnn14 has four years of community validation. For a classification task where false positives cost you nothing but a second look, proven beats cutting-edge.

The model accepts 32kHz mono audio and outputs a 527-dimensional probability vector — one confidence score per AudioSet class.

---

## Architecture

```
Input file (any format)
       │
       ▼
  [ffmpeg resample]
  → 32kHz mono WAV
       │
       ▼
  [librosa load]
  → numpy float32 array
       │
       ▼
  [PANNs Cnn14 inference]
  → 527-dim probability vector
       │
       ▼
  [threshold filter + sort]
  → top-N labels above 0.1 confidence
       │
       ▼
  JSON sidecar (.cairn.json)
```

The pipeline is intentionally simple. No streaming, no chunking, no sliding windows — Cnn14 handles variable-length audio internally by applying global average pooling over time. A 30-second clip and a 30-minute clip both reduce to the same feature dimensionality before classification. That's why inference time is constant regardless of file length.

---

## The CLI

Install:

```bash
pip install cairn-audio
# or from source:
git clone https://github.com/stankydanko/cairn
cd cairn && pip install -e .
```

Basic usage:

```bash
cairn tag audio.wav
```

Batch mode:

```bash
cairn tag footage/*.wav --min-confidence 0.15 --top 8
```

Output goes to a `.cairn.json` sidecar next to the input file. You can redirect to stdout with `--stdout` if you're piping into `jq`.

Flag reference:

```
--min-confidence FLOAT   Minimum confidence threshold (default: 0.1)
--top INT                Number of top labels to include (default: 10)
--model PATH             Path to custom Cnn14 checkpoint (default: auto-download)
--device [cpu|cuda]      Force inference device (default: auto-detect)
--stdout                 Print JSON to stdout instead of writing sidecar
--no-resample            Skip ffmpeg resampling (input must already be 32kHz mono)
```

---

## Real Output

Here's a `.cairn.json` sidecar from a field recording taken at a rural trailhead in north Georgia:

```json
{
  "file": "trailhead-morning-001.wav",
  "duration_seconds": 783.4,
  "processed_in_seconds": 4.8,
  "model": "Cnn14_mAP=0.431",
  "device": "cuda",
  "timestamp": "2026-03-14T07:22:11Z",
  "labels": [
    { "label": "Bird", "confidence": 0.847 },
    { "label": "Bird vocalization, bird call, bird song", "confidence": 0.812 },
    { "label": "Wild animals", "confidence": 0.634 },
    { "label": "Wind noise", "confidence": 0.421 },
    { "label": "Rustling leaves", "confidence": 0.388 },
    { "label": "Insect", "confidence": 0.291 },
    { "label": "Cricket", "confidence": 0.244 },
    { "label": "Stream", "confidence": 0.187 },
    { "label": "Rain", "confidence": 0.104 },
    { "label": "Speech", "confidence": 0.031 }
  ],
  "dominant_category": "nature-ambience",
  "usable_for_sync": true
}
```

The `dominant_category` and `usable_for_sync` fields are computed post-inference by a small rules engine that maps AudioSet labels to production categories:

- Labels like `Bird`, `Stream`, `Wind noise`, `Rustling leaves` → `nature-ambience`, usable
- Labels like `Traffic noise`, `Car`, `Engine` → `urban-noise`, not usable
- Labels like `Speech`, `Crowd` → `human-presence`, depends on context
- Labels like `Air conditioning`, `Hum` → `technical-noise`, usually cut

---

## The 13-Minute Test

The original motivation was classifying a 13-minute ambient field recording. Here's the actual timing output:

```bash
$ cairn tag long-form-ambience.wav --stdout | jq '.processed_in_seconds'

Resampling to 32kHz mono... 1.2s
Loading audio array...      0.4s
Running Cnn14 inference...  0.3s
Post-processing labels...   0.1s
Writing sidecar...          0.0s
──────────────────────────
Total: 2.0s

2.0
```

Two seconds for 13 minutes of audio. The resampling step (ffmpeg converting from 48kHz stereo to 32kHz mono) is actually the slowest part of the pipeline. On files already at 32kHz mono, total time drops below a second.

---

## Setting Up the Checkpoint

The first run triggers an automatic download of the Cnn14 weights:

```bash
$ cairn tag test.wav

Cairn v0.1.0
Downloading Cnn14_mAP=0.431.pth (309MB)...
████████████████████████████ 100% [309MB/309MB]
Saved to ~/.cairn/models/Cnn14_mAP=0.431.pth

Classifying test.wav...
Done. Sidecar written: test.cairn.json
```

Subsequent runs skip the download. If you're deploying Cairn in a CI environment or container, pre-download the checkpoint:

```bash
cairn download-model
# or manually:
wget https://zenodo.org/record/3987831/files/Cnn14_mAP%3D0.431.pth \
  -O ~/.cairn/models/Cnn14_mAP=0.431.pth
```

---

## Python API

If you want to integrate Cairn into a larger pipeline rather than shell out, the Python API is straightforward:

```python
from cairn import Classifier

clf = Classifier(device="cuda", min_confidence=0.1)

results = clf.tag("trailhead-morning-001.wav")

for label in results.labels[:5]:
    print(f"{label.label:<40} {label.confidence:.3f}")
```

Output:

```
Bird                                     0.847
Bird vocalization, bird call, bird song  0.812
Wild animals                             0.634
Wind noise                               0.421
Rustling leaves                          0.388
```

The `Classifier` instance caches the loaded model in memory, so batch processing is efficient:

```python
import glob

clf = Classifier(device="cuda")

for path in glob.glob("footage/**/*.wav", recursive=True):
    result = clf.tag(path)
    print(f"{path}: {result.dominant_category} (usable={result.usable_for_sync})")
```

---

## Batch Processing a Documentary Folder

Here's the shell pattern I actually use before an edit session:

```bash
# Tag everything
find ./footage -name "*.wav" | parallel -j4 cairn tag {}

# Find all usable nature ambience
find ./footage -name "*.cairn.json" -exec jq -r \
  'select(.dominant_category == "nature-ambience" and .usable_for_sync == true) | .file' {} \;

# Find anything with human speech (potential privacy concern)
find ./footage -name "*.cairn.json" -exec jq -r \
  'select(.labels[] | select(.label == "Speech" and .confidence > 0.3)) | .file' {} \;
```

The `jq` select patterns let you filter by any combination of label, confidence threshold, and category — without opening a single audio file.

---

## Limitations

Cnn14 is a general classifier, not a sound event detector. It tells you what's present in the whole file, not when it appears. If you have a clip where a truck drives by at the 4-minute mark in an otherwise clean nature recording, Cairn will report `Traffic noise` with moderate confidence — but won't tell you exactly where.

For temporal localization (knowing when events occur), you'd need a sound event detection model like DCASE entries or HEAR. That's a v0.3.0 target.

Also: Cnn14 was trained on YouTube audio, which skews toward certain acoustic environments. It's slightly overconfident on music (YouTube is music-heavy) and underconfident on highly specialized sounds like specific bird species. For species-level bird ID, use BirdNET. Cairn is for ambient category classification, not taxonomic precision.

---

## What You Learned

- **PANNs Cnn14** is a 14-layer CNN pretrained on AudioSet's 527 classes — fast, well-validated, free weights available from Zenodo
- **Inference time is file-length-independent** because global average pooling compresses the time dimension before classification — a 13-minute file runs in 2 seconds
- **The bottleneck is resampling**, not inference — pre-converting to 32kHz mono eliminates the slowest pipeline step
- **JSON sidecars** are the right output format for batch workflows — they let you filter large clip libraries with `jq` without touching the audio
- **AudioSet's 527 classes** map well to documentary production categories with a simple rules engine — you don't need to retrain to get production-useful outputs
