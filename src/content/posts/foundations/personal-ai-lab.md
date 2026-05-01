---
title: "You Don't Need the Cloud: Building a Personal AI Lab on a Single Machine"
description: "I run 69 AI models locally on a single workstation with zero cloud dependencies. Here's the exact hardware, software, and setup."
publishDate: 2026-02-28
author: j-martin
tier: foundations
postType: explainer
difficulty: beginner
estimatedMinutes: 12
prerequisites: []
category: ai-ml
tags: ["ollama", "ai", "local-llm", "gpu", "home-lab", "privacy"]
certTracks: ["comptia-a-plus"]
featured: true
draft: false
---

## Why Should You Care?

Every time you send a message to ChatGPT, that message travels to a data center in another state, gets processed on someone else's hardware, and is potentially stored and used to train future models. For most use cases that's a fine tradeoff. For sensitive work — legal documents, personal journals, proprietary code — it's not.

I run 69 AI models locally. Zero cloud dependencies. My prompts never leave this machine. The latency is under a second for a 7B model, a few seconds for 14B, comfortable for 26B with good quantization. I pay nothing per query.

Here's exactly how I built it.

## The Hardware

You don't need exotic hardware, but you do need a GPU with enough VRAM to load a model. VRAM is the binding constraint — it's where the model weights live during inference.

My workstation, Zeus:

| Component | Spec | Why It Matters |
|-----------|------|----------------|
| CPU | Intel i7-12700K (12 cores / 20 threads) | Handles context prep, tokenization |
| RAM | 62GB DDR4 | Large context windows, multiple services |
| GPU | RTX 3080 Ti — 12GB VRAM | Loads 7B models in FP16, 13B in 4-bit |
| Storage | 3.6TB NVMe + ext4 | Model weights (a 7B model is ~4GB) |
| ZRAM | 16GB compressed swap | Overflow buffer when RAM is under pressure |

The GPU is where inference actually happens. The RTX 3080 Ti's 12GB VRAM is a sweet spot: enough for comfortable 7B-14B inference, enough for 26B with Q4 quantization, not enough for 70B (which needs ~40GB VRAM or falls back to RAM, which is much slower).

## VRAM Budget 101

Model size roughly maps to VRAM like this at common quantization levels:

| Model Size | FP16 (full precision) | Q8 (8-bit) | Q4 (4-bit) |
|------------|----------------------|------------|------------|
| 7B | ~14GB | ~7GB | ~4GB |
| 14B | ~28GB | ~14GB | ~8GB |
| 26B | ~52GB | ~26GB | ~14GB |
| 70B | ~140GB | ~70GB | ~40GB |

With 12GB VRAM on the 3080 Ti, I can run 7B models in full precision, 14B in 8-bit, or 26B in 4-bit quantization. Quantization trades a small amount of accuracy for dramatically lower memory requirements — for most use cases the quality difference is indistinguishable.

## Ollama: The Model Runtime

[Ollama](https://ollama.com) is the piece that makes local AI actually usable. It handles:

- Downloading and caching model weights
- Loading models into GPU VRAM
- Serving an API (compatible with the OpenAI API format)
- Automatically unloading models from VRAM when idle

Install it on Linux:

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

Ollama runs as a system service. Check it's active:

```bash
$ sudo systemctl status ollama
● ollama.service - Ollama Service
     Loaded: loaded (/etc/systemd/system/ollama.service; enabled)
     Active: active (running) since Mon 2026-02-24 09:15:33 CST; 4 days ago
   Main PID: 1203 (ollama)
```

Pull your first model:

```bash
ollama pull llama3.2:3b
```

Run it:

```bash
$ ollama run llama3.2:3b "Explain what a GPU does in one paragraph."

A GPU (Graphics Processing Unit) is a specialized processor designed to handle the 
parallel computations required for rendering graphics. While a CPU has a few powerful 
cores optimized for sequential tasks, a GPU has thousands of smaller cores optimized 
for doing many simple operations simultaneously. This parallel architecture makes GPUs 
extraordinarily efficient for tasks that can be broken into independent chunks — which 
is why they became essential for training and running AI models, not just rendering games.
```

That ran entirely on my machine. Nothing left my network.

## What 69 Models Looks Like

`ollama list` shows every model you've pulled:

```bash
$ ollama list
NAME                            ID              SIZE    MODIFIED
qwen3:32b                       2de7a3a7bde8    20 GB   2 days ago
qwen3:14b                       a397f6a6a0af    9.3 GB  2 days ago
qwen3:8b                        50b7a30cbc53    5.2 GB  2 days ago
qwen3:4b                        e470a5e36e6e    2.6 GB  3 days ago
llama3.3:70b-instruct-q4_K_M    a6eb4748fd2e    43 GB   5 days ago
llama3.2:3b                     a80c4f17acd5    2.0 GB  1 week ago
gemma3:27b-it-q4_K_M            a418fc6a3e37    17 GB   1 week ago
gemma3:12b-it-q4_K_M            dde7aef6d83a    8.0 GB  2 weeks ago
deepseek-r1:14b                 ea35dfe18182    9.0 GB  3 weeks ago
mistral:7b-instruct             f974a74358d6    4.1 GB  1 month ago
nomic-embed-text                0a109f422b47    274 MB  1 month ago
mxbai-embed-large               468836162de7    670 MB  1 month ago
# ... 57 more
```

The 70B Llama model at 43GB lives mostly on disk — it exceeds 12GB VRAM, so inference falls back to RAM + VRAM which is slower but works. The 7B-14B models are where I spend most of my time; they're fast and accurate for everyday tasks.

Small embedding models (the `nomic-embed-text` and `mxbai-embed-large` rows at the bottom) are a few hundred MB and are used for semantic search, not chat.

## Open WebUI: The Chat Interface

`ollama run` in the terminal is fine for quick tests. For real work, I use [Open WebUI](https://openwebui.com) — a full chat interface that runs in a browser and connects to your local Ollama instance.

It runs in a Podman container:

```bash
podman run -d \
  --name open-webui \
  --restart unless-stopped \
  -p 3000:8080 \
  -e OLLAMA_BASE_URL=http://host.containers.internal:11434 \
  -v open-webui:/app/backend/data \
  ghcr.io/open-webui/open-webui:main
```

Open `http://localhost:3000` and you get a full ChatGPT-style interface connected entirely to your local models. You can switch between models mid-conversation, create system prompts, manage chat history — all of it stored locally on your machine.

I've added external APIs (Grok, Gemini) to the same interface, so I can route different conversations to different models from one UI. But the default for anything sensitive goes to a local model.

## ZRAM: Squeezing More Out of RAM

When you're running multiple services alongside Ollama — the web UI, other applications, background processes — RAM pressure builds. ZRAM is a compressed swap space that lives in RAM itself. It uses CPU cycles to compress/decompress pages, but the tradeoff is worth it: compressed RAM is much faster than disk swap.

My setup runs 16GB of ZRAM, giving me the equivalent of ~62GB + ~16GB = ~78GB usable memory for bursts:

```bash
$ zramctl
NAME       ALGORITHM DISKSIZE  DATA COMPR TOTAL STREAMS MOUNTPOINT
/dev/zram0 lz4           16G 12.4G  3.8G  4.0G      20 [SWAP]
```

The compression ratio here is 3.26:1 — 12.4GB of actual data compressed to 3.8GB. That's the kind of efficiency that makes running a 26B model alongside a web UI actually comfortable.

## The Privacy Argument

Running models locally isn't just about cost. It's about control.

When you use a cloud AI service:
- Your prompts may be stored and reviewed for safety
- Your queries can be used to train future models (depending on the ToS)
- Your usage patterns are visible to the provider
- A service outage means you're blocked

When you run locally:
- Prompts stay on your machine
- No training data contribution
- No usage logging to third parties
- Works offline, works when APIs are down

For me, the documentary work I do requires this. I'm processing sensitive personal archives. That data doesn't belong in anyone else's system.

## Getting Started: Minimum Viable Setup

You don't need a $1,500 GPU to start. The minimum useful setup:

- Any NVIDIA GPU with 6GB+ VRAM (GTX 1060, RTX 3060, etc.)
- 16GB system RAM
- Install Ollama, pull `llama3.2:3b` (2GB, fits in 6GB VRAM)

If you only have a CPU (no dedicated GPU), Ollama still works — it falls back to CPU inference. A 3B model is usable at ~5-10 tokens/second on a modern CPU. A 7B model is slow but functional for non-interactive tasks.

The ceiling is determined by your hardware. The floor is remarkably accessible.

## What You Learned

- Local AI means your prompts, your data, and your inference stay on your machine — no cloud dependency, no per-query cost
- VRAM is the binding constraint: 12GB handles 7B (full precision) through 26B (4-bit quantization) comfortably
- Ollama installs in one command and serves a local API that other tools can connect to
- Open WebUI gives you a full chat interface in a browser, connected to your local models via Podman
- ZRAM compressed swap lets you run larger models and more services simultaneously without requiring more physical RAM
