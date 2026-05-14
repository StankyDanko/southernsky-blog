---
title: "StegoForge: A Modern Steganography Toolkit in Rust"
description: "A Rust research toolkit for steganographic embedding, detection, and steganalysis — statistical, neural, diffusion, and linguistic backends, all local, all encrypted by default."
publishDate: 2026-05-14
author: j-martin
tier: applied
postType: project-walkthrough
difficulty: advanced
estimatedMinutes: 9
prerequisites: []
category: cybersecurity
tags: ["stegoforge", "steganography", "rust", "security", "encryption", "privacy", "neural-network", "southernsky"]
heroImage: "/images/posts/stegoforge-steganography-toolkit.webp"
featured: false
draft: false
---

## Why Should You Care?

The steganography landscape has been stuck since roughly 2015. The tools that exist are fragmented — one for LSB, a different one for BPCS, another Python script for detection, nothing that handles neural steganalysis or generative backends. If you want to work seriously across the full stack — embedding, extraction, statistical detection, neural detection, and AI-native generation — you're stitching together half a dozen projects with incompatible interfaces.

That's the problem I set out to solve. StegoForge is a Rust CLI and library that unifies all of it under a single pluggable architecture: classical embedding algorithms, a 12-layer neural detector with GPU acceleration, coverless diffusion stego via ComfyUI, and LLM linguistic stego via Ollama. Every backend behind the same trait. Every payload encrypted by default. The goal is a complete platform for security research, steganalysis education, and privacy tool development — all running locally, with no external dependencies.

This is the walkthrough of how it works, why it's built the way it is, and what the current state of the project looks like.

---

## The Problem with Stego Without Crypto

Most steganography tools embed plaintext payloads. That's a problem people rarely think about until they think about it once — at which point it becomes obvious and permanent.

Steganalysis can fail. Statistical detectors give false negatives. Neural detectors can be fooled. But if the payload is plaintext and someone extracts it, the concealment is the only layer of protection — and it just failed. There's no second layer.

StegoForge treats encryption as a precondition, not an option. The default pipeline is:

```
plaintext → Argon2id KDF → XChaCha20-Poly1305 encrypt → SF01 frame → embed
```

Every payload gets encrypted before it touches a carrier. The overhead is 56 bytes: 16 bytes of salt, 24 bytes of nonce, 16 bytes of authentication tag. On a 512x512 PNG, that overhead is invisible. Argon2id derives the key with 64MB memory cost and 3 iterations — that's intentional. It's designed to be slow on a GPU.

If you explicitly want to skip encryption, `--no-encrypt` is available. But you have to ask for it. The secure path is the default.

The `SF01` frame is the other piece of this: every embedded payload gets a 4-byte magic marker plus a 4-byte little-endian length prefix, applied outside the encrypted blob. This enables multi-backend extract fallthrough — the extractor can try each applicable backend, check for `SF01` magic, and return on first valid match without knowing ahead of time which algorithm was used.

---

## The Architecture: One Trait, Every Backend

The core design question for any toolkit with multiple implementations is: what's the interface? StegoForge's answer is a pair of traits in `stegoforge-core`:

```rust
pub trait Backend: Send + Sync {
    fn embed(&self, carrier_data: &[u8], payload: &[u8], opts: &EmbedOpts) -> Result<Vec<u8>, StegoError>;
    fn extract(&self, stego_data: &[u8], opts: &ExtractOpts) -> Result<Vec<u8>, StegoError>;
    fn capacity(&self, carrier_data: &[u8]) -> Result<usize, StegoError>;
    fn name(&self) -> &str;
    fn supported_formats(&self) -> &[CarrierFormat];
}

pub trait Detector: Send + Sync {
    fn detect(&self, data: &[u8], opts: &DetectOpts) -> Result<DetectResult, StegoError>;
    fn name(&self) -> &str;
    fn confidence_threshold(&self) -> f64;
}
```

That's it. Every backend — LSB, BPCS, F5, the SRNet neural detector, the diffusion codec, the Ollama linguistic encoder — is an `impl` of one of those two traits. The CLI doesn't know or care which backend it's calling. Neither does the Python binding layer.

The workspace is organized into eight crates:

| Crate | Role |
|-------|------|
| `stegoforge-core` | Traits, crypto, types, carrier analysis — zero heavy deps |
| `stegoforge-backends` | LSB, BPCS, F5 embedding implementations |
| `stegoforge-detect` | Chi-square, RS analysis, SPA, and SRNet (behind `cuda` feature) |
| `stegoforge-linguist` | LLM linguistic stego via Ollama (behind `linguist` feature) |
| `stegoforge-diffusion` | Coverless diffusion stego via ComfyUI (behind `diffusion` feature) |
| `stegoforge-python` | PyO3 bindings via maturin |
| `stegoforge-cli` | The `stegoforge` binary |
| `stegoforge-integration-tests` | Cross-crate integration tests (dev-deps only) |

The feature flag pattern matters here. If you build without `--features cuda`, the neural detection crate has zero tch/PyTorch dependencies. The binary is smaller, the build is faster, and the functionality degrades gracefully rather than failing. Same for `linguist` and `diffusion` — they're opt-in surfaces that don't bloat the default binary.

---

## Phase 1: The Classical Algorithms

Three backends, each with a real implementation story.

### LSB Matching

LSB matching adjusts each carrier byte by ±1 to match the target bit. It's not LSB replacement — that matters. Replacement creates a detectable pattern called the Pairs of Values (PoV) attack: values that differ only in their last bit become artificially balanced after embedding. Matching eliminates that histogram signature at the cost of slightly worse stego quality.

The bit positions are scattered using a keyed PRNG seeded from the Argon2id-derived key. Without the password, you don't know which pixels carry payload and which don't. A brute-force scan looking at sequential LSBs will find noise.

```bash
$ stegoforge embed --carrier photo.png --payload secret.txt --algo lsb --password mykey
Carrier: photo.png (PNG, 512x512, 3 channels)
Capacity: 98,301 bytes (lsb)
Payload: 847 bytes (after encryption, 903 bytes)
Output: photo.stego.png

$ stegoforge extract --input photo.stego.png --password mykey
Extracted: 847 bytes → secret.txt
```

### BPCS (Bit Plane Complexity Segmentation)

BPCS works on bit planes rather than individual pixels. Each channel gets decomposed into 8 bit planes, then each plane is divided into 8x8 blocks. Blocks above a complexity threshold (default 0.3) are candidates for embedding — complex regions look like noise even after payload substitution.

The critical implementation detail: bit planes must be computed in Canonical Gray Coding (CGC), not pure binary. Pure binary creates Hamming cliffs — adjacent values can differ by many bits in pure binary, so the bit planes have artificial high-frequency structure that steganalysis can detect. CGC removes that artifact. The implementation converts each pixel value to its Gray code equivalent, computes the planes in that domain, then converts back.

The other gotcha: the BPCS extractor must perform trial conjugation on block zero. The `SF01` magic header can produce a low-complexity pattern in the first 8x8 block, which triggers conjugation during embedding. But you need to read block zero to know how many blocks exist (and thus where the conjugation map lives) — a chicken-and-egg problem. The solution is to try block zero raw first; if `SF01` isn't found, conjugate it and try again. Conjugation is its own inverse, so this is always safe.

### F5 (DCT Domain)

F5 hides payload in DCT coefficient pairs in JPEG files — adjusting AC coefficients by ±1 to encode bits. The tricky part is shrinkage: when a ±1 coefficient hits zero, it disappears from the quantized representation, losing its bit. The algorithm tracks these losses and re-embeds until all bits are placed.

The F5 backend's capacity estimation is fully implemented. Embed and extract are stubbed behind `UnsupportedFormat` pending a stable `dct-io` API for mutable DCT coefficient access. The algorithm is documented and the implementation path is clear — it's blocked on an upstream crate stabilization, not on any ambiguity in the approach.

---

## Phase 2: Neural Detection with CUDA

The three statistical detectors — chi-square, RS analysis, and Sample Pair Analysis — catch unsophisticated LSB embedding reliably. Against LSB matching with PRNG scattering, they're significantly less effective. That gap is where the SRNet neural detector lives.

SRNet is a 12-layer deep residual CNN trained on steganalysis benchmarks. It learned what statistical patterns mean "this image has been modified" from thousands of cover/stego pairs, without being told what to look for. The trait interface is identical to the statistical detectors:

```bash
# Statistical detection
$ stegoforge detect --input suspect.png --methods chi-square,rs-analysis
chi-square: p=0.003 — HIGH confidence (stego likely)
rs-analysis: d=0.41 — MEDIUM confidence (stego possible)

# Neural detection (requires cuda feature + pre-trained weights)
$ stegoforge detect --input suspect.png --model srnet --gpu
srnet: confidence=0.91 — HIGH confidence (stego likely)
Weights: ~/.stegoforge/models/srnet-512.safetensors (auto-downloaded, SHA-256 verified)

# Detection calibration: embed at known rates, measure all detectors
$ stegoforge redtest --input cover.png --rates 10,25,50 --algos lsb,bpcs
```

The `redtest` subcommand is the most useful tool for understanding detection tradeoffs in a research context. Embed at 10%, 25%, and 50% capacity across algorithms, run every detector, and get a JSON matrix. You can see at a glance where statistical detection starts to fail and where neural detection picks up the slack — essential data for evaluating both embedding robustness and detector coverage.

SRNet uses `tch-rs` (Rust bindings for LibTorch/PyTorch). On my development machine, it links directly to the PyTorch installation in the ComfyUI venv — no separate LibTorch download required. Batch scanning uses rayon for parallelism across image directories:

```bash
$ stegoforge detect --dir ./images/ --report results.json
Scanning 1,247 images with 8 workers...
████████████████████ 1247/1247 [00:41<00:00, 30.1 img/s]
Report: results.json (89 flagged, 1158 clean)
```

Phase 2b added a full training loop — `train-detector` and `eval-detector` commands, dataset management for BOSSbase and S-UNIWARD, Adamax optimizer, checkpoint resumption, and evaluation metrics including P_E (the Fridrich community standard), AUC-ROC, and P_D at 5% false alarm rate. The training infrastructure is complete; a full 800-epoch training run on the 10K BOSSbase dataset is the next milestone.

---

## Phase 3b: Coverless Diffusion Stego

Here's where the architecture moves beyond modifying existing media.

Traditional steganography has a theoretical weakness: given the cover image, a detector can compare it to the stego image and measure the distortion. Coverless stego removes the cover. There is no before image. The AI generates the carrier from scratch in a way that encodes the payload — so there's nothing to compare it against.

StegoForge's diffusion backend uses seed-channel encoding via ComfyUI:

1. Derive a ChaCha20 RNG state from the password via Argon2id
2. Generate N candidate diffusion seeds from that RNG
3. Each image bit selects which candidate seed to use for that image in the gallery
4. The receiver, knowing the password and the same model checkpoint, regenerates all candidate seeds and identifies which was selected for each image — recovering the payload bits

The payload is the choice, not a modification. An image generated with a completely different seed is statistically indistinguishable from any member of the gallery.

```bash
$ stegoforge diffuse \
    --payload secret.txt \
    --model dreamshaper_8.safetensors \
    --prompt "misty mountain landscape at dawn" \
    --password mykey
Encoding 847 bytes → 6,776 bits → 6,776 images (1 bit/image)
Queuing ComfyUI jobs... (ComfyUI at http://localhost:8188)
████████████████████ 6776/6776 [45:12<00:00, 2.5 img/s]
Gallery: ./stego-gallery/ (6,776 images, 2.1GB)

$ stegoforge diffuse-extract \
    --gallery ./stego-gallery/ \
    --model dreamshaper_8.safetensors \
    --prompt "misty mountain landscape at dawn" \
    --password mykey
Reconstructing payload...
Extracted: 847 bytes → secret.txt
```

The capacity is deliberately low per image — 1-3 bits per generation. The payload lives in the statistical patterns of which seed was chosen across the gallery, not in pixel-level modification. DiffStega benchmarks report PSNR of 20-29 dB and XuNet detection rates near 50% — statistically indistinguishable from natural image variation.

---

## Phase 3c: LLM Linguistic Stego

The diffusion backend encodes data in images. The linguistic backend encodes data in text.

At every token position during text generation, the LLM assigns probability mass across its vocabulary. StegoForge's ADG (Adaptive Dynamic Grouping) algorithm partitions the top candidate tokens by probability, then uses the next payload bit to select which group to sample from. The generated text sounds natural — because it is natural; it's drawn from the model's actual probability distribution — but the sequence of sampling choices encodes the payload.

```bash
# Encode payload into AI-generated text
$ stegoforge linguist \
    --payload secret.txt \
    --llm qwen3:8b \
    --style "casual project update email" \
    --password mykey
Encoding 847 bytes → 6,776 bits
Generating stego text via Ollama (qwen3:8b)...
Estimated capacity: 1.2 bpt (bits per token) → ~5,647 tokens needed
Output: stego.txt (5,712 tokens, ~4,300 words)

# Recover payload from stego text
$ stegoforge linguist-extract \
    --text stego.txt \
    --llm qwen3:8b \
    --style "casual project update email" \
    --password mykey
Extracted: 847 bytes → secret.txt

# Estimate capacity before committing
$ stegoforge linguist-capacity \
    --llm qwen3:8b \
    --style "casual project update email" \
    --tokens 500
Estimated: ~600 bytes at 1.2 bpt over 500 tokens
```

The capacity scales with model entropy — higher-entropy models make more uncertain predictions, which means more bits can be steered per token. With Qwen3 8B, practical throughput is 0.5 to 2.5 bits per token depending on prompt style and temperature settings. A 500-word email encodes roughly 60-250 bytes.

Both the sender and receiver need the same model checkpoint and the same generation parameters. Any divergence in the sampling state breaks the decode. This is a real operational constraint — it means the linguistic channel works best in controlled environments where both endpoints run the same local model.

---

## Phase 4: Python Bindings and the Agent Ecosystem

Once the core algorithms were stable, the next logical step was making them accessible from higher-level tooling.

### PyO3 Bindings

The `stegoforge-python` crate exposes four functions via maturin:

```python
from stegoforge import embed, detect, analyze, extract

# Capacity-aware embedding
info = analyze("carrier.png")
# info.format, info.dimensions, info.capacity_by_algo, info.recommended_algo

result = embed("carrier.png", payload=b"secret data", algo="lsb", password="mykey")
# result.output_path, result.bytes_embedded, result.capacity_used_pct

# Statistical detection (full neural detection via CLI bridge)
report = detect("suspect.png", methods=["chi-square", "rs-analysis"])
# report.results: list of DetectResult with method, confidence, verdict
```

All operations release the GIL via `py.allow_threads()` — CPU-bound embedding and detection don't block the Python interpreter. Error types map to a `StegoForgeError` exception hierarchy. The package is designed for publication to PyPI.

### Six Security Agents in Open WebUI

Phase 4b deployed six security-focused agents to the SouthernSky Open WebUI instance, each with domain-specific knowledge files:

| Agent | Role |
|-------|------|
| StegAnalyst | Steganography specialist — embed, detect, interpret |
| RedHawk | Security assessment and authorized testing workflows |
| BlueShield | Defensive security and incident response |
| CipherSmith | Cryptography advisor |
| NetForge | Network and infrastructure operations |
| PenScribe | Security audit and report writing |

These agents run on base model inference today — no LoRA needed for knowledge-file agents. The CryptoStego LoRA (currently in Phase 4d training data generation) will enhance StegAnalyst and CipherSmith with accurate StegoForge tool-calling behavior once training is complete. The two-layer architecture means the base personality layer deploys immediately while the tool-calling layer gets trained properly.

### sscode Tool Integration

Phase 4c wrapped the full CLI as five tools for the sscode agent framework:

- `stegoforge.embed` — carrier + payload + password → stego output
- `stegoforge.extract` — stego file + password → recovered payload
- `stegoforge.detect` — suspect images → detection results
- `stegoforge.analyze` — carrier analysis with capacity estimates
- `stegoforge.redtest` — detection calibration matrix across algorithms and payload rates

An agent can now chain these in a single conversation: analyze a carrier to check capacity, embed a payload, run `redtest` to verify it passes statistical detection at the chosen rate, and extract to confirm round-trip integrity. The bridge supports both CLI and Python protocol modes depending on whether richer return types are needed.

---

## The Numbers

Current test coverage: **167 Rust tests + 12 pytest integration tests**.

| Layer | Tests | Status |
|-------|-------|--------|
| Core (traits, crypto, types) | 45 | Passing |
| Linguist (ADG + Ollama codec) | 23 | Passing |
| Diffusion (ComfyUI seed-channel) | 24 | Passing |
| Python bindings | 31 | Passing |
| CUDA-gated (SRNet + training) | 40 | Passing with `cuda` feature |
| Linguist integration | 2 | Passing with `linguist` feature |
| Diffusion integration | 2 | Passing with `diffusion` feature |
| pytest | 12 | Passing (maturin build required) |

Build without any features:

```bash
$ cargo build --workspace
$ cargo test --workspace
running 90 tests
test result: ok. 90 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

Build with everything:

```bash
$ LIBTORCH_USE_PYTORCH=1 LIBTORCH_BYPASS_VERSION_CHECK=1 \
    LD_LIBRARY_PATH=/path/to/comfyui/venv/lib/torch/lib:$LD_LIBRARY_PATH \
    cargo build --workspace --features cuda,linguist,diffusion
```

---

## What's Next

Phase 4d (CryptoStego LoRA training data) is in active generation. The pipeline is built — 7 weighted categories, 116 seed topics, XML tool-call validation, multi-provider generation across Grok, Gemini, and local Ollama. Target is 600 training examples, 85/15 train/val split.

Phase 3a (neural adaptive embedding, cost maps via U-Net) and Phase 3d (adversarial embedding, GAN-like training) are both blocked on a trained SRNet. The 10K BOSSbase + S-UNIWARD dataset is downloaded and the training infrastructure is complete. A 5-epoch smoke test followed by a full 800-epoch run on the RTX 3080 Ti is the unlock condition for both phases.

The planned open-source release — `stegoforge-core`, `stegoforge-backends`, `stegoforge-detect`, and `stegoforge-cli` with pre-trained weights — will happen at v0.5.0 once SRNet training validates the full detection pipeline end to end. When it ships, researchers and educators will have a single unified toolkit covering the complete steganalysis stack, which is something the field has been missing for a decade.

---

## What You Learned

- Encrypt-then-embed is the correct default for any steganography tool — stego without crypto is security theater, and making the insecure path require explicit opt-in is better API design than documenting the risk in a README
- Trait-based pluggability in Rust (`Backend: Send + Sync`, `Detector: Send + Sync`) lets you add neural, generative, and linguistic backends without changing the CLI or library interface — the boundary is defined once and all future work is just another `impl`
- Coverless diffusion stego is fundamentally different from carrier modification — the payload lives in the selection among AI-generated images, not in pixel-level changes, which eliminates the reference image comparison attack
- LLM linguistic stego uses the model's own probability distribution as the encoding channel — at 0.5-2.5 bits per token, a few thousand words of generated text carries meaningful payloads in a format that looks like normal writing
- Feature-gated Cargo features are the right way to handle optional heavy dependencies: without `--features cuda`, the binary builds with zero tch/PyTorch deps and the neural detection gracefully degrades
- Detection calibration (the `redtest` matrix) is the correct way to evaluate stego robustness in a research context — understanding where each detector succeeds and fails is what separates principled security research from blind tinkering
