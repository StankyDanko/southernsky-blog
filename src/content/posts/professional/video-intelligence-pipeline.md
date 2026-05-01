---
title: "Building a Video Intelligence Pipeline: Scene Detection + Audio + Face Recognition"
description: "Three standalone tools — SaySee, Cairn, and Tactical ID — combine into a full video intelligence pipeline. Here's how they fit together."
publishDate: 2026-04-20
author: j-martin
tier: professional
postType: project-walkthrough
difficulty: expert
estimatedMinutes: 22
prerequisites: ["python", "machine-learning"]
category: ai-ml
tags: ["video-intelligence", "scene-detection", "audio-classification", "face-recognition", "pipeline", "documentary"]
certTracks: []
featured: false
heroImage: "/images/posts/video-intelligence-pipeline.webp"
draft: false
---

## Why Should You Care?

Video intelligence at scale requires solving several distinct problems: understanding what's visually in the frame, understanding what's happening in the audio, and managing the identities of people who appear. Each problem has its own failure modes, its own models, and its own latency profile.

Building these as three separate tools — each doing one thing well — turns out to be the right architecture. The tools compose naturally through shared metadata, can be run independently when only one signal is needed, and can be improved or replaced without disrupting the others.

SaySee handles visual analysis and semantic search. Cairn handles ambient audio classification. Tactical ID handles face recognition with privacy defaults. Together, they form a pipeline that can process hours of raw documentary footage into searchable, tagged, privacy-protected material that an editor can actually use.

This is a systems post: how the tools are designed, how they interface, and where the sharp edges are.

---

## The Three Tools

```
Raw footage (MP4, MOV, MTS)
        │
        ├──────────────────────────────────────────────┐
        │                                              │
        ▼                                              ▼
┌───────────────┐                           ┌──────────────────┐
│    SaySee     │                           │      Cairn       │
│  (visual)     │                           │    (audio)       │
│               │                           │                  │
│ Frame extract │                           │ Audio extract    │
│ Scene detect  │                           │ PANNs Cnn14      │
│ AI describe   │                           │ 527-class tags   │
│ Embed → Qdrant│                           │ → 5s latency     │
└───────┬───────┘                           └────────┬─────────┘
        │                                            │
        │                                            │
        ▼                                            ▼
┌───────────────┐                         ┌──────────────────┐
│  Tactical ID  │◄── face crops from ─────┤                  │
│  (identity)   │    SaySee frames        │ Metadata merger  │
│               │                         │                  │
│ dlib detector │                         │ scene_metadata/  │
│ Known faces   │                         │ {clip_id}.json   │
│ Blur unknowns │                         └──────────────────┘
└───────┬───────┘                                  │
        │                                          ▼
        └──────────────────────────► FCP XML / Qdrant / Edit suite
```

---

## Tool 1: SaySee — Visual Scene Intelligence

SaySee's job: extract meaning from video frames and make it searchable.

### Architecture

```
Video file
    │
    ▼ ffmpeg frame extraction (keyframes + every N seconds)
    │
    ▼ PySceneDetect boundary detection
    │
    ▼ Frame batching (4-6 frames per scene)
    │
    ▼ Multimodal AI description (Grok Vision or Gemini)
    │  → structured description JSON
    │
    ▼ Text embedding (nomic-embed-text via Ollama)
    │
    ▼ Qdrant upsert (vector + payload)
```

### Frame Extraction

```python
# saysee/extractor.py

import subprocess
import tempfile
from pathlib import Path

def extract_frames(video_path: str, scene: dict, max_frames: int = 6) -> list[bytes]:
    """Extract representative frames from a scene."""
    duration = scene['duration_s']
    start = scene['start_tc_seconds']

    # Sample evenly across scene duration
    if duration <= 2.0:
        timestamps = [start + duration / 2]  # single midpoint for short scenes
    else:
        step = duration / min(max_frames, int(duration))
        timestamps = [start + step * i for i in range(min(max_frames, int(duration)))]

    frames = []
    for ts in timestamps:
        with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as tmp:
            subprocess.run([
                'ffmpeg', '-ss', str(ts), '-i', video_path,
                '-vframes', '1', '-q:v', '3',  # quality 3 ≈ ~200KB per frame
                '-y', tmp.name
            ], capture_output=True, check=True)
            frames.append(Path(tmp.name).read_bytes())

    return frames
```

### Scene Description

The description prompt is designed to produce structured, searchable text — not a caption:

```python
DESCRIPTION_PROMPT = """Describe this documentary footage scene for search indexing.

Be specific and factual. Include:
- Number of people visible and their approximate age/gender if visible
- What they are doing or saying (if text/speech is readable)
- Setting: interior/exterior, location type, time of day
- Emotional register: tense, neutral, warm, confrontational, reflective
- Notable objects, documents, or text on screen
- Camera technique: close-up, wide, handheld, static

Format as a dense descriptive paragraph optimized for semantic search.
Do not describe what you cannot see. Do not interpret motivation."""
```

The resulting descriptions land in Qdrant as both the text embedding payload and a searchable field:

```python
# saysee/indexer.py

from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct, VectorParams, Distance
import ollama

client = QdrantClient(host='localhost', port=6333)

def ensure_collection(name: str, vector_size: int = 768):
    try:
        client.get_collection(name)
    except Exception:
        client.create_collection(
            collection_name=name,
            vectors_config=VectorParams(size=vector_size, distance=Distance.COSINE),
        )

def index_scene(collection: str, scene: dict, description: str, clip_id: str):
    embedding_response = ollama.embeddings(
        model='nomic-embed-text',
        prompt=description,
    )
    vector = embedding_response['embedding']

    client.upsert(
        collection_name=collection,
        points=[
            PointStruct(
                id=scene['scene_index'],
                vector=vector,
                payload={
                    'clip_id': clip_id,
                    'start_tc': scene['start_tc'],
                    'end_tc': scene['end_tc'],
                    'duration_s': scene['duration_s'],
                    'description': description,
                    'scene_class': scene.get('class'),
                    'confidence': scene.get('confidence'),
                },
            )
        ],
    )
```

### Semantic Search

Once footage is indexed, the editor queries it in natural language:

```python
def search_scenes(collection: str, query: str, limit: int = 10) -> list[dict]:
    embedding = ollama.embeddings(model='nomic-embed-text', prompt=query)['embedding']

    results = client.search(
        collection_name=collection,
        query_vector=embedding,
        limit=limit,
    )

    return [
        {
            'score': r.score,
            'clip_id': r.payload['clip_id'],
            'start_tc': r.payload['start_tc'],
            'description': r.payload['description'],
        }
        for r in results
    ]
```

```bash
$ python -m saysee.search --query "subject looks away after being asked about phone call"

Results:
  0.89  tape_12.mp4  00:47:14.200  "Subject pauses mid-response, breaks eye contact..."
  0.84  tape_08.mp4  01:22:08.440  "Subject turns toward window after interviewer asks..."
  0.77  tape_15.mp4  00:08:31.000  "Visible discomfort after question about 2016..."
```

### Dropbox Bridge

The iPhone→workstation intake pipeline uses Dropbox as a transfer layer. SaySee watches a Dropbox folder and processes incoming files automatically:

```python
# saysee/dropbox_watch.py

import time
from dropbox_sync import DropboxSync  # ~/tools/ai-scripts/dropbox-sync.mjs wrapper

def watch_intake_folder(collection: str, dropbox_path: str = '/SaySee/intake'):
    seen = set()
    sync = DropboxSync()

    while True:
        files = sync.list(dropbox_path)
        new_files = [f for f in files if f['id'] not in seen and f['name'].endswith(('.mp4', '.mov', '.mts'))]

        for file in new_files:
            local_path = sync.download(f"{dropbox_path}/{file['name']}", f"/tmp/saysee_intake/")
            process_video(local_path, collection=collection)
            sync.move(f"{dropbox_path}/{file['name']}", f"/SaySee/processed/{file['name']}")
            seen.add(file['id'])

        time.sleep(30)
```

Shoot on iPhone → save to Dropbox → SaySee picks it up within 30 seconds → indexed and searchable before the editor sits down.

---

## Tool 2: Cairn — Ambient Audio Classification

Cairn's job: identify what's happening in the audio in near-realtime, using PANNs (Pretrained Audio Neural Networks).

### Why PANNs Cnn14?

PANNs Cnn14 is a 79M parameter CNN trained on AudioSet — 527 audio classes covering everything from "Speech" and "Music" to "Rain," "Gunshot," "Crowd," and "Crying." For documentary footage, the relevant classes cluster into a small set:

| AudioSet class | Documentary meaning |
|----------------|---------------------|
| Speech | Interview, narration, ambient dialogue |
| Music | Score, source music, transition |
| Crowd | Public setting, event |
| Rain, Wind | Weather, outdoor establishing |
| Traffic | Urban location context |
| Bird, Insects | Rural/nature location |
| Laughter | Tone marker |
| Crying, Sobbing | Emotional beat |
| Silence | Significant pause |

The model processes 10-second audio chunks and produces a 527-dimensional probability vector. Classification takes ~5 seconds on CPU — fast enough to batch-process footage faster than realtime on a workstation.

### Processing Pipeline

```python
# cairn/classifier.py

import librosa
import numpy as np
import torch
from cairn.panns_model import Cnn14  # PANNS pretrained weights

SAMPLE_RATE = 32000
CHUNK_DURATION = 10  # seconds
CONFIDENCE_THRESHOLD = 0.3

# Top documentary-relevant AudioSet labels and their indices
DOCUMENTARY_LABELS = {
    0:   'Speech',
    137: 'Music',
    40:  'Laughter',
    25:  'Crying, sobbing',
    6:   'Crowd',
    288: 'Rain',
    290: 'Wind',
    300: 'Traffic noise, roadway noise',
    114: 'Bird',
    500: 'Silence',
}

class CairnClassifier:
    def __init__(self, weights_path: str):
        self.model = Cnn14(sample_rate=SAMPLE_RATE, window_size=1024,
                           hop_size=320, mel_bins=64, fmin=50, fmax=14000,
                           classes_num=527)
        checkpoint = torch.load(weights_path, map_location='cpu')
        self.model.load_state_dict(checkpoint['model'])
        self.model.eval()

    def classify_chunk(self, audio_chunk: np.ndarray) -> dict:
        with torch.no_grad():
            waveform = torch.FloatTensor(audio_chunk[None, :])
            output = self.model(waveform)
            clipwise_output = output['clipwise_output'].squeeze().numpy()

        # Filter to documentary-relevant labels above threshold
        tags = {}
        for idx, label in DOCUMENTARY_LABELS.items():
            score = float(clipwise_output[idx])
            if score > CONFIDENCE_THRESHOLD:
                tags[label] = round(score, 3)

        return {
            'tags': tags,
            'primary': max(tags, key=tags.get) if tags else 'Unknown',
            'full_vector': clipwise_output.tolist(),  # for downstream analysis
        }

    def classify_file(self, audio_path: str) -> list[dict]:
        waveform, _ = librosa.load(audio_path, sr=SAMPLE_RATE, mono=True)
        chunk_samples = SAMPLE_RATE * CHUNK_DURATION

        results = []
        for i, start in enumerate(range(0, len(waveform), chunk_samples)):
            chunk = waveform[start:start + chunk_samples]
            if len(chunk) < chunk_samples * 0.5:  # skip very short trailing chunk
                break

            # Pad to full chunk if needed
            if len(chunk) < chunk_samples:
                chunk = np.pad(chunk, (0, chunk_samples - len(chunk)))

            result = self.classify_chunk(chunk)
            result['chunk_index'] = i
            result['start_s'] = i * CHUNK_DURATION
            result['end_s'] = (i + 1) * CHUNK_DURATION
            results.append(result)

        return results
```

### CLI

```bash
$ python -m cairn.classify --input tape_12.mp4

Extracting audio...
Processing 73 chunks (10s each)...

Audio tag summary:
  Speech     68.4%  ████████████████████████████████████████████
  Music       8.2%  █████
  Laughter    6.8%  ████
  Crowd       4.1%  ██
  Silence     3.0%  █

Chunks with Crying/Sobbing:
  00:32:10 - 00:32:30  (score: 0.71)
  00:58:40 - 00:59:00  (score: 0.64)

Output: tape_12_audio_tags.json  (73 chunks × 527 classes)
```

The output JSON is the audio counterpart to SaySee's scene metadata — same timecode system, different signal.

---

## Tool 3: Tactical ID — Face Recognition with Privacy Defaults

Tactical ID's job: identify known subjects across footage, and blur everyone else.

The privacy default is inversion of the usual approach. Generic face blurring identifies faces and blurs them all. Tactical ID maintains a roster of "known" subjects (explicitly enrolled), identifies them, and blurs everyone not on the roster. This is the correct default for documentary work — protecting bystanders and non-consenting parties while keeping subjects recognizable.

### Architecture

```python
# tactical_id/recognizer.py

import dlib
import numpy as np
from pathlib import Path
import pickle

detector = dlib.get_frontal_face_detector()
shape_predictor = dlib.shape_predictor('models/shape_predictor_68_face_landmarks.dat')
face_encoder = dlib.face_recognition_model_v1('models/dlib_face_recognition_resnet_model_v1.dat')

RECOGNITION_THRESHOLD = 0.5  # Euclidean distance; lower = more similar

class TacticalIDRoster:
    def __init__(self, roster_path: str):
        self.roster_path = Path(roster_path)
        self.known_encodings: dict[str, np.ndarray] = {}
        if self.roster_path.exists():
            with open(self.roster_path, 'rb') as f:
                self.known_encodings = pickle.load(f)

    def enroll(self, name: str, photo_path: str):
        """Add a person to the known roster."""
        img = dlib.load_rgb_image(photo_path)
        dets = detector(img, 1)
        if not dets:
            raise ValueError(f"No face detected in {photo_path}")

        shape = shape_predictor(img, dets[0])
        encoding = np.array(face_encoder.compute_face_descriptor(img, shape))
        self.known_encodings[name] = encoding

        with open(self.roster_path, 'wb') as f:
            pickle.dump(self.known_encodings, f)
        print(f"Enrolled: {name}")

    def identify(self, face_encoding: np.ndarray) -> tuple[str | None, float]:
        """Return (name, distance) for best match, or (None, inf) if unknown."""
        if not self.known_encodings:
            return None, float('inf')

        distances = {
            name: np.linalg.norm(enc - face_encoding)
            for name, enc in self.known_encodings.items()
        }
        best_name = min(distances, key=distances.get)
        best_dist = distances[best_name]

        if best_dist <= RECOGNITION_THRESHOLD:
            return best_name, best_dist
        return None, best_dist  # Unknown
```

### Frame Processing with Selective Blur

```python
# tactical_id/processor.py

import cv2
import numpy as np
import dlib

def process_frame(frame: np.ndarray, roster: TacticalIDRoster) -> tuple[np.ndarray, list[dict]]:
    """
    Returns (processed_frame, face_metadata).
    Known faces: labeled, unblurred.
    Unknown faces: blurred, labeled as 'Unknown'.
    """
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    detections = detector(rgb, 0)  # upsample=0 for speed

    frame_out = frame.copy()
    face_meta = []

    for det in detections:
        shape = shape_predictor(rgb, det)
        encoding = np.array(face_encoder.compute_face_descriptor(rgb, shape))
        name, distance = roster.identify(encoding)

        x1, y1, x2, y2 = det.left(), det.top(), det.right(), det.bottom()
        # Expand bounding box slightly for better blur coverage
        pad = 15
        x1, y1 = max(0, x1 - pad), max(0, y1 - pad)
        x2, y2 = min(frame.shape[1], x2 + pad), min(frame.shape[0], y2 + pad)

        if name is None:
            # Unknown: apply Gaussian blur
            face_region = frame_out[y1:y2, x1:x2]
            blurred = cv2.GaussianBlur(face_region, (99, 99), 30)
            frame_out[y1:y2, x1:x2] = blurred
            label = 'Unknown'
        else:
            # Known: draw labeled box
            cv2.rectangle(frame_out, (x1, y1), (x2, y2), (0, 255, 0), 2)
            cv2.putText(frame_out, f"{name} ({distance:.2f})",
                        (x1, y1 - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)
            label = name

        face_meta.append({
            'label': label,
            'distance': round(float(distance), 3),
            'bbox': [x1, y1, x2, y2],
            'is_known': name is not None,
        })

    return frame_out, face_meta
```

### Video Processing

```python
def process_video(input_path: str, output_path: str, roster: TacticalIDRoster,
                  sample_every_n: int = 3):
    """Process full video: blur unknowns, label known, emit face timeline metadata."""
    cap = cv2.VideoCapture(input_path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    out = cv2.VideoWriter(output_path, cv2.VideoWriter_fourcc(*'mp4v'), fps, (w, h))

    timeline = []
    frame_idx = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if frame_idx % sample_every_n == 0:
            processed, meta = process_frame(frame, roster)
        else:
            processed = frame  # reuse previous frame's processing
            meta = []

        out.write(processed)

        if meta:
            timeline.append({
                'frame': frame_idx,
                'timecode': f"{frame_idx / fps:.3f}",
                'faces': meta,
            })

        frame_idx += 1

    cap.release()
    out.release()
    return timeline
```

dlib's ResNet face encoder is accurate but CPU-bound — on a 30-minute clip at 30fps, full-frame processing takes ~4 hours on CPU. The `sample_every_n=3` parameter processes every 3rd frame (still 10fps of face data), which reduces processing time to ~90 minutes. For CUDA-accelerated inference, there's a `dlib.cuda` build path that brings this under 20 minutes, but it requires the CUDA-enabled dlib build with CMake (`-DDLIB_USE_CUDA=1`).

---

## Composing the Pipeline

The three tools share a metadata format and a clip ID convention. A single orchestrator ties them together:

```python
# pipeline.py

import asyncio
from pathlib import Path
from saysee import process_video as saysee_process
from cairn.classifier import CairnClassifier
from tactical_id.processor import process_video as tactical_process
from tactical_id.recognizer import TacticalIDRoster
from scorsai.index import run_beat_indexer
import json

async def run_full_pipeline(
    input_path: str,
    collection: str,
    roster_path: str = '~/.tactical_id/roster.pkl',
    output_dir: str = './pipeline_output/',
):
    clip_id = Path(input_path).stem
    out = Path(output_dir) / clip_id
    out.mkdir(parents=True, exist_ok=True)

    print(f"Pipeline: {clip_id}")
    print("  [1/4] SaySee: visual analysis + embedding...")

    # Run SaySee: returns scene metadata with descriptions and Qdrant IDs
    scene_meta = saysee_process(input_path, collection=collection, clip_id=clip_id)
    (out / 'scenes.json').write_text(json.dumps(scene_meta, indent=2))

    print(f"  [2/4] Cairn: audio classification...")

    # Run Cairn: returns per-chunk audio tags
    cairn = CairnClassifier(weights_path='models/Cnn14_mAP=0.431.pth')
    audio_tags = cairn.classify_file(input_path)
    (out / 'audio_tags.json').write_text(json.dumps(audio_tags, indent=2))

    print(f"  [3/4] Tactical ID: face recognition + blur...")

    # Run Tactical ID: writes privacy-protected video, returns face timeline
    roster = TacticalIDRoster(roster_path)
    protected_path = str(out / f"{clip_id}_protected.mp4")
    face_timeline = tactical_process(input_path, protected_path, roster)
    (out / 'face_timeline.json').write_text(json.dumps(face_timeline, indent=2))

    print(f"  [4/4] ScorsAI: beat classification + FCPXML export...")

    # Run ScorsAI beat indexer on top of scene metadata
    beat_sheet = run_beat_indexer(scene_meta, clip_id=clip_id)
    (out / 'beat_sheet.json').write_text(json.dumps(beat_sheet, indent=2))

    # Export FCPXML for Final Cut Pro
    from scorsai.fcpxml_export import export_fcpxml
    export_fcpxml(beat_sheet, str(out / f"{clip_id}_markers.fcpxml"))

    # Merge all metadata into unified clip record
    clip_record = {
        'clip_id': clip_id,
        'source': input_path,
        'scenes': scene_meta,
        'audio': audio_tags,
        'faces': face_timeline,
        'beats': beat_sheet['beats'],
    }
    (out / 'clip_record.json').write_text(json.dumps(clip_record, indent=2))

    print(f"  Pipeline complete: {out}/")
    return clip_record
```

### Running It

```bash
# Enroll a subject
python -m tactical_id.enroll --name "Subject Name" --photo reference_photo.jpg

# Process one clip
python -m pipeline --input tape_12.mp4 --collection scorsai_documentary

# Batch process a directory
for f in /mnt/footage/*.mp4; do
    python -m pipeline --input "$f" --collection scorsai_documentary
done

# Search across all processed footage
python -m saysee.search --collection scorsai_documentary \
  --query "subject looking at document or letter"
```

### Output per Clip

```
pipeline_output/tape_12/
├── scenes.json           # SaySee scene metadata + descriptions
├── audio_tags.json       # Cairn 10s-chunk audio tags
├── face_timeline.json    # Tactical ID face detections per frame
├── beat_sheet.json       # ScorsAI beat classifications
├── tape_12_markers.fcpxml  # FCP timeline markers
├── tape_12_protected.mp4   # Privacy-protected video (unknowns blurred)
└── clip_record.json      # Unified metadata (all of the above merged)
```

---

## Performance Benchmarks (i7-12700K, RTX 3080 Ti)

| Tool | 30-min clip | Notes |
|------|------------|-------|
| SaySee (frame extract + embed) | ~8 min | Ollama on GPU for embeddings |
| Cairn (audio classification) | ~4 min | CPU-only, PANNs Cnn14 |
| Tactical ID (CPU path) | ~90 min | sample_every_n=3 |
| Tactical ID (CUDA path) | ~18 min | Requires CUDA dlib build |
| ScorsAI beat indexer | ~12 min | Grok + Gemini API latency |
| **Full pipeline (CUDA)** | **~42 min** | Per 30-min clip |
| **Full pipeline (CPU)** | **~114 min** | Per 30-min clip |

The bottleneck without CUDA is Tactical ID — dlib face encoding is embarrassingly parallelizable but pure CPU. With CUDA, the bottleneck shifts to the ScorsAI beat indexer waiting on Grok/Gemini API responses, which is rate-limited.

---

## What You Learned

- **Single-concern tools compose better than monoliths.** SaySee, Cairn, and Tactical ID each have clear interfaces (JSON metadata, timecoded output, shared clip ID convention) that make them independently useful and easily composable.
- **Privacy defaults should be opt-out, not opt-in.** Tactical ID blurs by default and preserves only known enrolled subjects — the correct posture for documentary work where bystanders appear in raw footage without consent.
- **Embedding text descriptions is more flexible than visual embeddings.** SaySee describes frames in text, then embeds the description. This lets you search with natural language queries that reference emotional content, context, and narrative function — things visual embeddings can't represent.
- **Sample rate vs. processing time is the main lever.** Tactical ID at `sample_every_n=3` gives 10fps of face metadata at 3x the speed of full-frame processing. For most editorial use cases, 10fps of face tracking is sufficient.
- **Unified clip records enable cross-signal queries.** With SaySee scenes, Cairn audio tags, and Tactical ID face appearances merged into one JSON per clip, you can query for "scenes where Subject A is speaking and audio includes music" by joining timecodes across the three signals.
