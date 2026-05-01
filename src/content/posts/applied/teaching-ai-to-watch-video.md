---
title: "Teaching AI to Watch Video: A Multi-Stage Pipeline"
description: "Video is the hardest media for AI to understand. Here's how I built SaySee — a pipeline that extracts frames, transcribes audio, and lets you search video by meaning."
publishDate: 2026-05-01
author: j-martin
tier: applied
postType: project-walkthrough
difficulty: intermediate
estimatedMinutes: 15
prerequisites: ["python"]
category: ai-ml
tags: ["video", "whisper", "embeddings", "qdrant", "pipeline"]
heroImage: "/images/posts/teaching-ai-to-watch-video.webp"
featured: false
draft: false
---

## Why Should You Care?

Video is the hardest media for computers to understand. It's images that move, with sound, and meaning that changes over time.

Text? Feed it to a model and get embeddings. Images? Run them through a vision model. Audio? Whisper transcribes it. But video is all three at once, tangled together on a shared timeline. A spoken sentence starts at one keyframe and ends at another. The person talking changes expression mid-word. Background noise shifts the emotional register of a scene without any visual change.

I built SaySee to solve this problem for myself. I had a personal video archive spanning 15 years of footage — concerts, travel clips, old YouTube uploads — and no way to search any of it by meaning. I couldn't ask "find the clip where I'm slacklining for the first time" or "which video has someone talking about energy and vision." Each clip was a black box labeled with a filename and a date.

SaySee is a six-stage pipeline that breaks video into its component signals, processes each one with the right tool, merges them onto a shared timeline, and indexes the result in a vector database. After processing, you don't watch videos to find moments — you search for them.

This post walks through every stage, why each design decision was made, and what the real output looks like.

---

## The Problem with Naive Approaches

The simplest way to "understand" video with AI is to throw the whole file at a multimodal model. Some models accept video input directly. Why not just do that?

Three reasons:

**Cost.** A 10-minute video at 30fps is 18,000 frames. Sending all of those to a vision API would cost more than the video is worth. Even at pennies per image, it adds up fast.

**Context windows.** No model can hold a full video in context. You'd need to chunk it, which means deciding how to chunk it, which means understanding the content... which is the thing you're trying to do in the first place.

**Modality mismatch.** Vision models see frames. Speech models hear words. Embedding models work on text. No single model does all three well simultaneously. The architecture should reflect that reality: specialized tools for specialized signals, unified through shared metadata.

SaySee takes the specialized-tools approach. Each stage does one thing, produces structured output, and hands it to the next stage.

---

## Architecture Overview

```
Video file (MP4, MOV, MKV)
    |
    v
 [1. EXTRACT] -- ffmpeg
    |       \
    v        v
 frames/   audio.wav
    |           |
    v           v
 [2. SEE]   [3. HEAR] -- (run in parallel when using cloud APIs)
    |           |
    v           v
 frame-       audio.srt
 descriptions
    \         /
     v       v
   [4. MERGE]
       |
       v
   timeline.json  (unified, time-sorted)
       |
       v
   [5. INDEX] -- embed + Qdrant upsert
       |
       v
   [6. RENDER] -- .saysee.json + .saysee.md
```

Six stages. Each one is idempotent — if it crashes halfway through, you can resume where it left off. Each one produces a file on disk that the next stage reads. No hidden state, no in-memory handoffs. If you want to inspect what happened at any stage, you open the file.

Let's walk through each one.

---

## Stage 1: Extract — Getting the Raw Material

The first stage uses ffmpeg to pull two things out of a video file: sampled frames as WebP images, and the audio track as a 16kHz mono WAV.

```javascript
// Simplified from lib/stages/extract.mjs

// Extract frames at the configured sampling rate
execSync(
  `ffmpeg -y -i "${videoPath}" \
    -vf "fps=${fps},scale=${maxWidth}:-1" \
    -c:v libwebp -qscale:v 80 \
    "${framesDir}/%06d.webp"`
);

// Extract audio as 16kHz mono WAV (what Whisper expects)
execSync(
  `ffmpeg -y -i "${videoPath}" \
    -vn -ar 16000 -ac 1 \
    "${audioPath}"`
);
```

But the interesting decision here isn't the extraction — it's the sampling rate. This is where the L0-L4 system comes in.

### The L0-L4 Sampling Strategy

Not every frame matters equally. A 10-minute video at 30fps has 18,000 frames, but most of them are nearly identical to their neighbors. The question is: how many frames do you actually need to understand what's happening?

The answer depends on what you're trying to do. SaySee defines five sampling levels:

| Level | Rate | Frames per Minute | Use Case |
|-------|------|-------------------|----------|
| **L0** | 1 frame per 60s | 1 | Quick skim — "what is this video roughly about?" |
| **L1** | 1 frame per 15s | 4 | Standard analysis — enough to catch scene changes |
| **L2** | 1 frame per 5s | 12 | Detailed review — catches most visual transitions |
| **L3** | 1 frame per second | 60 | Fine-grained — catches brief moments, text on screen |
| **L4** | Every frame | ~1800 (at 30fps) | Forensic — nothing is missed, but processing is slow |

L1 is the default. For a 10-minute video, that's 40 frames — enough to capture every major scene without drowning in redundancy. The cost of describing 40 frames with a vision model is manageable. The cost of describing 18,000 is not.

The config maps each level to a different vision model too:

```json
{
  "L0": { "fps": "1/60", "model": "gemma4:26b" },
  "L1": { "fps": "1/15", "model": "gemma4:e4b" },
  "L2": { "fps": "1/5",  "model": "gemma4:e4b" },
  "L3": { "fps": "1/1",  "model": "gemma4:e4b" },
  "L4": { "fps": "all",  "model": "gemma4:e2b" }
}
```

The reasoning: L0 produces very few frames, so quality matters — use the biggest model. L4 produces thousands of frames, so speed matters — use the fastest model. The middle levels use the balanced option. This mapping emerged from benchmarking the Gemma 4 model family on real frame descriptions and finding the quality/speed sweet spot for each volume tier.

Each extracted frame gets a timestamp baked into its filename:

```
frames/
  000000_00h00m00s.webp
  000001_00h00m15s.webp
  000002_00h00m30s.webp
  000003_00h00m45s.webp
  000004_00h01m00s.webp
```

This is important. The filename IS the timecode. Downstream stages don't need to recalculate anything — they parse the timestamp directly from the filename.

---

## Stage 2: See — What's in Each Frame

The See stage sends each extracted frame to a vision model with a description prompt. The prompt is deliberately structured for downstream search, not for human reading:

```
Describe what you see in this video frame in 1-2 sentences.
Note any people, facial expressions, emotions, text on screen,
objects, locations, actions, or notable visual details.
```

The vision model returns a text description. SaySee supports three providers — Ollama (local), Grok (cloud), and Gemini (cloud) — swappable at the command line:

```bash
saysee process video.mp4 --provider ollama --model gemma4:e4b
saysee process video.mp4 --provider grok --model grok-4-fast-non-reasoning
```

The output is a JSON file with one entry per frame:

```json
[
  {
    "timestamp": "00:00:00",
    "frame_file": "000000_00h00m00s.webp",
    "description": "A young man stands on a green hillside with a city skyline visible behind him. He is smiling and wearing a dark jacket.",
    "model": "gemma4:e4b",
    "provider": "ollama",
    "level": "L1"
  },
  {
    "timestamp": "00:00:15",
    "frame_file": "000001_00h00m15s.webp",
    "description": "Close-up of hands holding a slackline strap, threading it through a ratchet mechanism. Trees and grass visible in the background.",
    "model": "gemma4:e4b",
    "provider": "ollama",
    "level": "L1"
  }
]
```

A key design decision: **resume support**. Vision model inference is the slowest stage. If you're processing 200 frames and the model crashes on frame 147, you don't want to start over. The See stage loads existing descriptions on startup and only processes frames that don't have descriptions yet:

```javascript
// Load what we already have
const existing = JSON.parse(readFileSync(descriptionsPath, 'utf-8'));
const describedFiles = new Set(existing.map(d => d.frame_file));

// Only describe what's missing
const pendingFrames = allFrames.filter(f => !describedFiles.has(basename(f)));
```

This also means you can upgrade your vision model and re-describe specific frames without reprocessing the entire video.

---

## Stage 3: Hear — What's Being Said

While See processes frames, Hear extracts the spoken word. It runs OpenAI's Whisper model against the extracted audio WAV and produces an SRT subtitle file:

```
1
00:00:01,200 --> 00:00:04,800
So this is my first day trying slacklining.

2
00:00:05,100 --> 00:00:08,300
I set it up between these two trees in the park.

3
00:00:09,000 --> 00:00:12,500
Let's see if I can even stand on this thing.
```

The implementation is straightforward — it shells out to Whisper's CLI:

```javascript
execSync(
  `whisper "${audioPath}" \
    --model large-v3-turbo \
    --output_format srt \
    --output_dir "${outDir}"`
);
```

The model choice matters. Whisper's `large-v3` is the most accurate but requires ~10GB of VRAM, which on a 12GB GPU leaves no room for the vision model. `large-v3-turbo` is the practical choice: roughly the same accuracy, ~6GB VRAM, and 23-33x faster than realtime. A 10-minute video transcribes in under 30 seconds.

### Parallel Execution

Here's where the pipeline gets interesting. When using a cloud vision provider (Grok or Gemini), See and Hear can run in parallel — the vision API doesn't use local GPU, so Whisper can have the full GPU to itself:

```javascript
if (useLocal) {
  // Local model: sequential to avoid VRAM contention
  await see(outDir, config);
  await hear(outDir, config);
} else {
  // Cloud API: run both at once
  await Promise.all([
    see(outDir, config),
    hear(outDir, config),
  ]);
}
```

When using a local vision model (Ollama + Gemma 4), they run sequentially. Both need the GPU, and loading two large models simultaneously on a 12GB card causes out-of-memory errors. The pipeline detects the provider and adjusts automatically.

---

## Stage 4: Merge — The Unified Timeline

This is the conceptual heart of the pipeline. Merge takes two separate streams of information — frame descriptions (what you see) and transcript segments (what you hear) — and weaves them into a single timeline sorted by timestamp.

```javascript
function mergeTimeline(frameDescriptions, srtContent) {
  const timeline = [];

  for (const frame of frameDescriptions) {
    timeline.push({
      time: frame.timestamp,
      timeSeconds: timestampToSeconds(frame.timestamp),
      type: 'scene',
      description: frame.description,
    });
  }

  const srtSegments = parseSrt(srtContent);
  for (const seg of srtSegments) {
    timeline.push({
      time: secondsToTimestamp(seg.startSeconds),
      timeSeconds: seg.startSeconds,
      type: 'audio',
      text: seg.text,
    });
  }

  // Sort by time, scenes before audio at same timestamp
  timeline.sort((a, b) => {
    const diff = a.timeSeconds - b.timeSeconds;
    if (diff !== 0) return diff;
    return a.type === 'scene' ? -1 : 1;
  });

  return timeline;
}
```

The merged timeline looks like this — scene descriptions and audio transcript interleaved in time order:

```
[00:00:00] SCENE: A young man stands on a green hillside...
[00:00:01] AUDIO: "So this is my first day trying slacklining."
[00:00:05] AUDIO: "I set it up between these two trees in the park."
[00:00:09] AUDIO: "Let's see if I can even stand on this thing."
[00:00:15] SCENE: Close-up of hands holding a slackline strap...
[00:00:30] SCENE: Wide shot of the man balancing on the slackline...
[00:00:31] AUDIO: "Okay, I got it. I got it. No I don't."
```

### Windowed Grouping

The raw timeline has too many entries to embed individually — each one would be a tiny snippet with no context. So Merge groups timeline entries into **windows**: 30-second chunks that contain everything that happened in that interval.

```javascript
function groupIntoWindows(timeline, windowSeconds = 30) {
  const windows = [];
  for (let start = 0; start <= maxTime; start += windowSeconds) {
    const end = start + windowSeconds;
    const entries = timeline.filter(
      e => e.timeSeconds >= start && e.timeSeconds < end
    );
    if (entries.length === 0) continue;

    windows.push({
      start: secondsToTimestamp(start),
      end: secondsToTimestamp(end),
      text: entries.map(e => {
        if (e.type === 'scene') return `[SCENE] ${e.description}`;
        if (e.type === 'audio') return `[AUDIO] ${e.text}`;
      }).join('\n'),
    });
  }
  return windows;
}
```

A single window's text looks like:

```
[SCENE] A young man stands on a green hillside with a city skyline behind him.
[AUDIO] So this is my first day trying slacklining.
[AUDIO] I set it up between these two trees in the park.
[AUDIO] Let's see if I can even stand on this thing.
[SCENE] Close-up of hands holding a slackline strap, threading it through a ratchet.
```

This is what gets embedded. Each window captures both visual and audio context for a 30-second span — enough information for a semantic search to match against.

---

## Stage 5: Index — Making It Searchable

Index takes each window's text, runs it through an embedding model, and upserts the resulting vector into Qdrant (a vector database).

```javascript
for (const window of windows) {
  const vector = await embed(window.text);
  await upsert(qdrantUrl, collection, randomUUID(), vector, {
    tier: 'window',
    video: videoName,
    window_start: window.start,
    window_end: window.end,
    text: window.text.slice(0, 5000),
  });
}
```

The embedding model is `nomic-embed-text`, a 768-dimensional text embedding model that runs locally through Ollama. Each embedding captures the semantic meaning of the window — not the exact words, but the concepts. "A man trying to balance on a thin strap between trees" and "slacklining in a park" should land near each other in vector space.

In addition to the per-window embeddings, the Index stage creates a **summary embedding** — a single vector that represents the entire video. This is built from the first few scene descriptions and transcript segments, giving you a way to search across videos at the collection level ("which of my videos is about outdoor activities?").

The payload stored alongside each vector includes the video filename, the window timestamps, and the full merged text. When you search later, these payloads tell you exactly where to look in the original video.

---

## Stage 6: Render — Human-Readable Output

The final stage produces two files: a `.saysee.json` (the structured source of truth) and a `.saysee.md` (a human-readable timeline with embedded frame references).

The JSON captures everything:

```json
{
  "version": "1.0",
  "videoName": "first-day-slacklining.mp4",
  "duration": 312.4,
  "level": "L1",
  "date": "2026-04-15",
  "summary": "A young man attempts slacklining for the first time...",
  "timeline": [ ... ],
  "windows": [ ... ],
  "processing": {
    "provider": "ollama",
    "model": "gemma4:e4b",
    "whisperModel": "large-v3-turbo",
    "processedAt": "2026-04-15T20:09:11.037Z"
  }
}
```

The markdown is for you to skim:

```markdown
# first-day-slacklining.mp4

**Duration:** 5:12 | **Level:** L1 | **Processed:** 2026-04-15

> A young man attempts slacklining for the first time...

---

[00:00:00] SCENE: A young man stands on a green hillside...
![00:00:00](frames/000000_00h00m00s.webp)

[00:00:01] AUDIO: "So this is my first day trying slacklining."

[00:00:15] SCENE: Close-up of hands holding a slackline strap...
![00:00:15](frames/000001_00h00m15s.webp)
```

The markdown links directly to the extracted frames, so if you open it in a markdown viewer, you see the visual timeline laid out with screenshots.

---

## Searching: The Payoff

Once videos are indexed, you search them by meaning:

```bash
$ saysee search "someone trying to balance for the first time"

1. first-day-slacklining.mp4 [00:00:00-00:00:30] (0.87)
   [SCENE] A young man stands on a green hillside...
   [AUDIO] So this is my first day trying slacklining.

2. first-day-slacklining.mp4 [00:00:30-00:01:00] (0.79)
   [SCENE] Wide shot of the man balancing on the slackline...
   [AUDIO] Okay, I got it. I got it. No I don't.
```

The score (0.87) is the cosine similarity between your query embedding and the stored window embedding. Higher means more semantically similar.

Notice what's happening: the search query uses the word "balance" and "first time." The stored text uses "stands on a green hillside" and "first day trying slacklining." These aren't keyword matches — the embedding model understands that "trying to balance" and "slacklining for the first time" are semantically close.

This is the fundamental advantage of embedding-based search over full-text search. You don't need to remember the exact words that were spoken or the exact phrasing the vision model used. You describe what you're looking for in your own words, and the vector space does the matching.

---

## The Watch Daemon: Automated Processing

SaySee includes a file watcher that turns a folder into an intake pipeline:

```bash
$ saysee watch
[watch] SaySee daemon started
[watch] Inbox: data/inbox
[watch] Default collection: saysee
[watch] Subdirectories in inbox map to Qdrant collection names
[watch] Waiting for media files...
```

Drop a video file into `data/inbox/` and it gets processed automatically — extracted, described, transcribed, merged, embedded, and indexed. When it's done, the original file moves to `data/processed/` with a date prefix.

The subdirectory naming convention is particularly useful: drop files into `data/inbox/concerts/` and they get indexed into a Qdrant collection called `concerts`. Drop them into `data/inbox/documentary/` and they go into `documentary`. The folder name becomes the collection name. This means you can organize your video archive into searchable categories just by organizing your intake folders.

The watch daemon also integrates with Dropbox. There's a companion script that syncs from a Dropbox folder to the local inbox, creating a full pipeline from iPhone camera to searchable archive: shoot on your phone, the video syncs to Dropbox, the bridge script pulls it to your workstation, and the watch daemon processes it. By the time you sit down at your desk, the video is indexed and searchable.

---

## Real Use Cases

### Personal video archive

I had 15 years of YouTube uploads, concert recordings, and travel clips — hundreds of files. Processing the full archive at L1 took a few hours unattended. Now I can search across all of them:

```bash
saysee search "outdoor music festival"
saysee search "someone cooking"
saysee search "sunset over water"
```

Each result includes the filename and the exact timecode window. No more scrubbing through hours of footage.

### Documentary production

The pipeline was originally built for documentary work. When you have 50+ hours of interview footage and field recordings, the ability to search by meaning is transformative. Instead of maintaining spreadsheets of clip notes, you index everything and search:

```bash
saysee search "subject discusses childhood" --collection documentary
saysee search "exterior shot of house" --collection b-roll
```

The collection system keeps different categories of footage separated but searchable with the same interface.

### Content indexing

If you produce video content — tutorials, lectures, vlogs — SaySee lets you build a searchable index of everything you've published. Feed your back catalog through the pipeline at L0 (one frame per minute, minimal processing cost) and you get a rough semantic index of your entire library.

---

## Multi-Media Support

SaySee isn't limited to video. The pipeline detects the input media type and adjusts:

| Media Type | Extract | See | Hear | Merge | Index | Render |
|-----------|---------|-----|------|-------|-------|--------|
| Video | frames + audio | yes | yes | visual + audio | yes | yes |
| Audio | audio only | skip | yes | audio only | yes | yes |
| Image | convert to frame | yes | skip | visual only | yes | yes |
| Text | chunk into segments | skip | skip | text windows | yes | yes |

Audio files go straight to Whisper — no frames to extract. Images get a single frame description. Text files get chunked into 500-character segments with virtual 30-second timestamps. Everything ends up in the same Qdrant collection with the same search interface.

This means you can mix media types in a single collection. Index interview recordings (audio), B-roll footage (video), location photos (image), and research notes (text) into one searchable corpus.

---

## What I Learned Building This

**Idempotency is worth the effort.** Every stage checks whether its output already exists before running. This sounds tedious, but it saved me dozens of times during development. When a vision model API goes down at frame 147 of 200, you fix the issue and run the pipeline again — it picks up at frame 148. The resume flag clears error sidecars and retries the failed stage.

**Not every frame matters equally.** The L0-L4 system was born from watching the pipeline process hundreds of frames that were visually identical to their neighbors. L1 (one frame every 15 seconds) catches every meaningful scene change in normal video. L3 and L4 exist for edge cases — catching text that flashes on screen for two seconds, or analyzing motion frame by frame.

**Text descriptions are more searchable than visual embeddings.** An early version of SaySee embedded frame images directly using CLIP. The results were mediocre — you could search for "a dog" and find dogs, but you couldn't search for "a tense conversation" or "someone who looks surprised." Converting frames to text descriptions first, then embedding the text, allows the embedding to capture emotional content, context, and narrative meaning that visual embeddings miss entirely.

**The merge step is where the magic happens.** Individually, frame descriptions and transcripts are useful but limited. A frame description says "two people sitting at a table" — the transcript says "I never told you about that." Neither one tells the full story. The merged window says both: you see the scene and hear the words in context. That combined representation is what makes semantic search actually work for video.

**30-second windows are a good default.** Too short (5 seconds) and each window lacks context. Too long (2 minutes) and the embedding dilutes — too many concepts crammed into one vector. 30 seconds captures a complete thought: a question and its answer, a scene establishing shot and the action that follows, a musical phrase.

**Local models changed everything.** The original SaySee used cloud APIs for vision (Grok) and worked well but cost money per frame. Switching to local Gemma 4 models running on Ollama made processing free after the one-time model download. The quality is comparable for frame descriptions, and the latency is actually better for batch processing since there's no API rate limiting. The tradeoff is VRAM contention with Whisper — solved by running See and Hear sequentially instead of in parallel when both need the GPU.

---

## The Output Structure

After processing, each video gets a directory:

```
data/output/first-day-slacklining/
  frames/
    000000_00h00m00s.webp
    000001_00h00m15s.webp
    000002_00h00m30s.webp
    ...
  audio.wav
  audio.srt
  frame-descriptions.json
  timeline.json
  first-day-slacklining.saysee.json
  first-day-slacklining.saysee.md
```

Every intermediate artifact is preserved. You can inspect the frame descriptions to see what the vision model thought it saw. You can read the SRT to check the transcript. You can open the timeline JSON to see exactly how the two streams were merged. Nothing is hidden inside the pipeline — every stage's output is a file you can read.

This transparency matters. When a search result seems wrong, you can trace back through the chain: was the frame description inaccurate? Did Whisper mishear a word? Was the merge window too wide? Each failure mode is diagnosable because each stage's output is visible.

---

## Running It Yourself

SaySee requires ffmpeg, Whisper, Ollama, and Qdrant. If you have those installed, processing a video is one command:

```bash
saysee process my-video.mp4 --level L1 --provider ollama --model gemma4:e4b
```

Search across everything you've processed:

```bash
saysee search "the moment everything changed"
```

Set up the watch daemon for automated intake:

```bash
saysee watch
# Now drop files into data/inbox/ — they process automatically
```

The pipeline runs on a single workstation. No cloud services required (unless you choose a cloud vision provider). No cluster, no Kubernetes, no infrastructure beyond what's already on your machine.

---

## What's Next

SaySee is one piece of a larger video intelligence stack. It handles the "what do you see and hear" question. Cairn (ambient sound classification) handles "what kind of audio environment is this." Tactical ID (face recognition) handles "who is in this frame." Together, they compose into a full pipeline where SaySee's frame descriptions, Cairn's audio tags, and Tactical ID's face metadata all merge into a single searchable record per clip.

But that's a story for [another post](/blog/professional/video-intelligence-pipeline).

The core insight from building SaySee is simple: video understanding is a decomposition problem. You don't build one model that understands video. You build a pipeline that breaks video into signals, processes each signal with the right tool, and reunifies them on a shared timeline. The pipeline is the intelligence.
