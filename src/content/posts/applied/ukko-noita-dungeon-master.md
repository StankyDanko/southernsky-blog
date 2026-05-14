---
title: "Ukko: An AI Dungeon Master for Noita"
description: "A local AI companion that reads your Noita save, predicts what's coming, and narrates your run in the voice of a battle-scarred Finnish uncle. Here's how I built it."
publishDate: 2026-05-14
author: j-martin
tier: applied
postType: project-walkthrough
difficulty: intermediate
estimatedMinutes: 9
prerequisites: []
category: ai-ml
tags: ["ukko", "noita", "gaming", "ai", "lua", "dungeon-master", "roguelike", "southernsky"]
heroImage: "/images/posts/ukko-noita-dungeon-master.webp"
featured: false
draft: false
---

## Why Should You Care?

Noita is one of the most technically sophisticated games ever made. Every pixel physically simulates. The world is procedurally generated. And underneath the surface — hidden from every in-game tooltip — is a deterministic RNG that decides your alchemy recipes, your fungal shifts, your Holy Mountain perk offerings, and the contents of every shop. All of it. Seeded. Predictable. Knowable.

The game just doesn't tell you any of it.

After a few hundred deaths you start to feel the shape of this hidden system. You learn that a Lightning Trail wand with a Zeta on a specific seed is going to be in a specific shop. You learn the fungal shift sequences change in ways you could calculate if you just had the algorithm. The community has reverse-engineered all of it — the alchemy, the perk altar spreads, the wand goldening probabilities — but using those tools means tabbing out, entering seeds by hand, reading spreadsheets while your run timer ticks.

That friction is the real problem. Not the math — the context switch.

Ukko fixes that. It's a real-time AI companion that sits beside your run, reads your save, predicts what's coming, and tells you about it in the voice of a man who has seen 312 deaths and isn't impressed by yours.

---

## What Ukko Actually Is

The core insight here is simple: everything Noita knows about your run lives in files on disk. That means any external process can read it. Once you accept that, the architecture writes itself.

Three components that talk to each other through the file system:

**The daemon** — a Python process that starts when you launch a run and stays alive until you quit. It owns the Grok conversation, polls your save file every half-second, and exposes a WebSocket server on `localhost:7676`. It is the brain.

**The Lua mod** — a companion mod loaded into Noita that exports game state Noita doesn't write to disk fast enough to be useful. Health, held wand, spells, current biome, current gold. It writes a snapshot JSON every ~0.5 seconds (every 30 frames) and fires event hooks when things happen. It is the eyes.

**The CLI tools** — `noita-save`, `noita-load`, `noita-status`, and `noita-dm` in your PATH. You open a terminal beside your game window and type. The daemon auto-spawns if it isn't running. A second terminal invocation just attaches to the same daemon and the same conversation.

```
noita-dm
```

That's the entire startup command. If the daemon is already running (maybe from a previous session), the CLI connects to it. If not, it spawns it. Ukko greets you.

---

## The Overlay

The CLI is useful. The overlay is better.

Hit the backtick key in-game. A chat interface renders directly on top of Noita using the Lua GUI layer. Ukko's responses stream in token-by-token while you play — you don't wait for a complete response before the text starts appearing. The game pauses while the overlay is open (three layers of input suppression: keyboard polling zeroed, velocity zeroed, `disable_movement` GameEffect applied each frame from `OnWorldPreUpdate`). Close the overlay with Escape or backtick again and you're back in the run.

Voice input works too. Hold spacebar for about 600ms to arm recording — short taps still pass through as spaces so regular movement isn't disrupted. Release to transcribe. faster-whisper converts the audio to text locally and fires the message. No cloud, no latency spike, no voice data leaving your machine.

The JSONL bridge between the mod and the daemon is append-only: the Lua mod writes events to a file inside the mod directory, which is symlinked to a stable path the daemon polls. Append-only means it survives save/load cycles, Noita crashes, and partial writes cleanly. Every hook writes its record before calling the original vanilla game function — log-then-call — so even if downstream game code throws, the event is already captured.

---

## Event Hooks

Ukko doesn't just wait for you to ask questions. It watches ten events and responds to them proactively — the distinction matters because unsolicited commentary at the right moment is more useful than any query you'd think to type while dodging polymorphine.

- `perk_pickup` — you grabbed something at a Holy Mountain altar
- `shop_scan` — you entered a shop (triggers Seer prediction of contents)
- `shop_purchase` — you bought something
- `perk_reroll` — you spent gold to reroll the altar (and the cost just doubled)
- `spell_unlock` — a new spell came off cooldown or spawned
- `wand_equip`, `wand_drop`, `wand_inspect` — wand lifecycle events
- Plus biome transitions, HP threshold crossings

Biome changes get oracle notes. Perk picks get synergy commentary — Ukko knows your current build and tells you whether that perk actually helps you or whether you just wasted a slot. HP warnings are blunt. Ukko does not sugarcoat.

---

## Seer Mode: The Killer Feature

The Noita community has spent years reverse-engineering the game's RNG. The world seed determines everything — not probabilistically, deterministically. Given your seed, you can calculate in advance exactly what alchemy recipes exist, what your fungal shift sequence will be, what perks will appear on each Holy Mountain floor, and what every shop will stock.

Seer Mode ports that math into Ukko and makes it queryable mid-run.

The implementation is a Python port of the canonical C++ reverse-engineering work (pudy248's `noita_random.h`). The critical constraint: byte-exact parity. Not "close enough" — identical output to Noita's internal RNG on every call. The test suite validates against golden fixtures pulled from known seeds.

```
peek_alchemy   → Lively Concoction + Alchemic Precursor recipes for your seed
peek_fungal    → All 20 fungal reality shift sequences, in order
peek_perks     → Holy Mountain perk altar offerings by floor + reroll preview
peek_shops     → Every shop on every floor, wand internals included (110/120 goldens byte-exact)
```

The HP vitals calculator — which determines fast-tier HP values from the underlying float representation — hits 1540/1540 byte-exact parity against noitool's fixtures. That number matters because the HP system in Noita is not what it appears to be on screen; displayed HP is the actual value multiplied by 25, and healing/damage calculations operate on the raw float.

Once you have byte-exact parity, you have oracle access. Walk into a Holy Mountain — Ukko tells you what's on the altar before you see it. Find a wand in a chest — Ukko tells you whether it's a golden. Considering a fungal shift — Ukko shows you the next 19 in sequence and flags whether one of them is about to turn your water flask into acid.

---

## The Persona

Ukko is a Finnish uncle. Not the warm kind. The one who survived something he doesn't talk about, drinks alone at the bar in the starting hut, and dispenses advice in two sentences or fewer.

He calls you "player" or nothing. He doesn't celebrate. He observes. When you pick up a bad perk he notes that you've made this mistake before. When you die in an obviously avoidable way he has an observation about that too, cross-referenced against his 312-death archive.

```
You picked up Slime Blood.

It stains everything. Your next shop will notice.
```

That voice is encoded in a persona module the daemon loads at startup. Every Grok call goes through it. I chose `grok-4-1-fast-reasoning` after testing several models for this use case — the deciding factors were tool-calling streaming reliability and round-trip latency. For a real-time overlay where the player is mid-run, a two-second response that starts streaming immediately beats a half-second response that waits for the full completion. The persona suppresses the usual LLM instinct toward cheerfulness and replaces it with something more honest.

---

## Run Archival

Every run is archivable. `noita-save <name>` copies the live save into a named archive with a timestamp. `noita-load <name>` restores it. `noita-status` shows what you have.

Ukko proposes archive names based on the run state. The convention is `<seed>_<descriptor>` — for example, `339064549_fungal-hm_tinker_ldc-explosions`. Descriptors accumulate vocabulary from the run: notable perks, the build direction, the build-defining wand. If you die before naming the run, Ukko gives it one anyway.

The daemon survives CLI exits. Close the terminal. Reopen it. `noita-dm` reattaches to the same conversation. The transcript is still there. The run context is still there. Ukko remembers what you were attempting.

---

## By the Numbers

- **7,988 lines** of Python daemon code
- **~110KB** of Lua mod
- **73 pytest tests** covering protocol, snapshot store, grok client, daemon lifecycle, CLI, and end-to-end — yes, a gaming mod with full test coverage; Seer Mode math is too consequential to debug by feel
- **10 event hooks** fired from the mod to the daemon
- **12 settings toggles** (Seer enabled/disabled, spoiler level, 9 per-category toggles)
- **Phases 3a through 3f** completed for Seer Mode: alchemy, fungal, perks, shops, HP vitals, golden wand parity
- **0 cloud calls for voice** — faster-whisper runs locally
- **0 accounts required** — Grok API key in your environment, that's it

---

## What Building This Taught Me

- File-based IPC (append-only JSONL) is a surprisingly robust inter-process bridge for game modding contexts where you can't inject into the process and network sockets aren't available from the Lua side. The append-only constraint is a feature, not a limitation — it makes the bridge crash-safe by design.
- Byte-exact RNG parity is achievable by porting from a canonical reference implementation and validating against golden fixtures from known seeds. "Close enough" is not close enough when the downstream consumers are hex-encoded recipe indices — a single off-by-one in the RNG state produces completely wrong alchemy recipes.
- A three-layer architecture (daemon + mod + CLI) separates concerns cleanly: the daemon owns AI state and tools, the mod owns live game observability, the CLI and overlay own presentation. Each layer can fail or restart independently.
- Push-to-talk via hardware scancode (not ModSetting) avoids Noita's per-save stale value problem — scancodes are stable across saves, but ModSettings values are serialized into the save file and can drift.
- Voice input with a hold-to-arm pattern (600ms threshold) lets you disambiguate intentional recording from incidental keypresses without requiring a dedicated key. The threshold is long enough to be unambiguous but short enough to feel instant.

---

The architecture here — file-based IPC, event-driven hooks, a persistent daemon that outlives the UI — applies well beyond Noita. Any game that writes state to disk is a candidate for this kind of companion.

The repo is private (`StankyDanko/noita-dm`) — it's a donor-tier perk on the GoFundMe. If you've been playing Noita long enough to know what a fungal shift sequence costs you on floor 4, you know why this exists.

Runs locally. No cloud, no account, no telemetry. Just Ukko, your seed, and whatever you're about to do wrong.
