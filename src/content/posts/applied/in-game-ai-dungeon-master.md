---
title: "Building an In-Game AI Dungeon Master"
description: "I built a local AI that watches my Noita runs, predicts shop inventories, and roleplays as a Finnish storm god. Here's the architecture behind Ukko."
publishDate: 2026-05-01
author: j-martin
tier: applied
postType: project-walkthrough
difficulty: intermediate
estimatedMinutes: 16
prerequisites: ["local-llm"]
category: ai-ml
tags: ["noita", "gaming", "ai", "lua", "ipc"]
heroImage: "/images/posts/in-game-ai-dungeon-master.webp"
featured: false
draft: false
---

## The Vision

What if your favorite game had a personal AI companion that could see what you see, predict what's coming, and roleplay as a character from the game's mythology?

Not a wiki overlay. Not a Twitch chatbot. Not a map hack. A character who watches your run unfold, remembers your past deaths, knows what's waiting in the next Holy Mountain before you get there, and delivers all of that knowledge in the voice of a grizzled Finnish wizard who's died 312 times and still gets a stupid grin when a triple-cast homing spark bolt melts a camp of enemies.

That's Ukko. I built it for Noita, a Finnish roguelike where everything is procedurally generated, everything is physically simulated, and everything is trying to kill you. The project started as a save-file parser and grew into a persistent AI daemon with a Lua mod, an in-game chat overlay, voice input via Whisper, and a seed-prediction engine that's byte-exact against the game's own random number generator.

This post walks through how all of that works.

---

## Why Noita?

If you haven't played Noita, here's the pitch: you're a wizard descending through a procedurally generated mountain, collecting wands and perks, fighting increasingly horrific enemies, and dying constantly. The name means "witch" in Finnish. Every pixel in the world is physically simulated --- fire burns, water flows, acid eats through rock, explosions chain-react through gas clouds. The game generates its world, shop inventories, perk offerings, enemy placements, and alchemy recipes from a single seed number at the start of each run.

That seed is the key insight behind this entire project. If you know the seed and you know the algorithm, you can predict everything: what perks will appear at each Holy Mountain, what spells the shops will sell, what wands will spawn, what the alchemy recipe is, how fungal shifts will cascade. The community has already reverse-engineered most of these systems. Tools like [Noitool](https://www.noitool.com/) let you punch in a seed and see what's coming.

But those tools are web pages you alt-tab to. I wanted the predictions to come from a character who lives inside the game, speaks in its mythology, and adjusts how much it reveals based on how spoiled I want to be.

---

## Architecture Overview

Ukko has three main components that talk to each other through files and WebSockets:

```
┌─────────────────────┐
│   Noita (game)      │
│   ┌───────────────┐ │
│   │  ukko-mod     │ │    Lua mod inside the game
│   │  (Lua)        │ │
│   └───────┬───────┘ │
└───────────┼─────────┘
            │
   File IPC │  state.json   (game state every 3s)
            │  inbox.jsonl  (player messages → daemon)
            │  outbox.jsonl (daemon responses → game)
            │  vitals.jsonl (HP/position every 1s)
            ▼
┌───────────────────────┐
│   ukko-daemon         │
│   (Python, persistent)│
│                       │
│   - Persona engine    │
│   - Grok API client   │
│   - Tool dispatch     │
│   - Seer predictions  │
│   - Snapshot store    │
│   - Whisper STT       │
└───────┬───────────────┘
        │ WebSocket (localhost:7676)
        ▼
┌─────────────────┐
│   ukko-cli      │
│   (terminal)    │
└─────────────────┘
```

The daemon is the brain. It's a long-running Python process that owns the conversation history, manages the LLM calls, dispatches tools, and runs the seed prediction engine. It never dies when you close the game or close a terminal. Walk into the Mines on run five and Ukko remembers you ate a Stendari mushroom on run one.

The Lua mod is the body. It's installed inside Noita and runs every frame. It exports game state to a JSON file, renders the chat overlay on screen, captures keyboard and voice input, and forwards everything to the daemon through JSONL files.

The CLI is the backup mouth. A thin terminal client that connects to the daemon over WebSocket. Same conversation, different renderer. Useful when you want to chat with Ukko while the game is closed.

---

## The IPC Layer: Why Files Beat Sockets

The first design question was: how do the Lua mod and the Python daemon talk to each other?

The obvious answer is WebSockets. Bidirectional, push-based, well-understood. The daemon already runs a WebSocket server for the terminal CLI. But Noita runs under Proton (Wine) on Linux, and the only Lua WebSocket library that works inside Noita --- PollNet --- is a 32-bit Windows DLL loaded via FFI. Under Proton, it's broken. I confirmed this myself and found others in the modding community who hit the same wall.

So I went with files. Specifically, append-only JSONL (JSON Lines) files that both sides can read and write without coordination:

- **`state.json`** --- The mod writes a complete game state snapshot every 3 seconds (configurable). HP, gold, position, biome, perks, nearby entities, seed, NG+ count, Holy Mountain index.
- **`inbox.jsonl`** --- The mod appends one JSON line per player message. The daemon tails this file from its last byte offset.
- **`outbox.jsonl`** --- The daemon appends streaming tokens as JSON lines. The mod tails this file by byte offset and renders each token as it arrives.
- **`vitals.jsonl`** --- Fast-tier telemetry (HP, position, biome) at ~1-second cadence via an in-memory buffer that flushes on a wall-clock interval.

Here's what a round trip looks like:

1. Player presses backtick. The overlay opens. Game auto-pauses.
2. Player types "should I take glass cannon?" and presses Enter.
3. The Lua mod appends to `inbox.jsonl`:
   ```json
   {"seq":42,"ts":1776079123,"text":"should I take glass cannon?"}
   ```
4. The daemon's `OverlayChannel` polls the inbox every 100ms. It sees the file grew, reads from the last offset, parses the new line, and puts it on an asyncio queue.
5. The daemon feeds the message through its conversation pipeline --- persona prompt, tool schemas, Grok API streaming call.
6. For each token from Grok, the daemon appends to `outbox.jsonl`:
   ```json
   {"type":"token","seq":42,"text":"Skip. "}
   {"type":"token","seq":42,"text":"You have no "}
   {"type":"token","seq":42,"text":"HP buffer."}
   {"type":"done","seq":42,"full_text":"Skip. You have no HP buffer..."}
   ```
7. The Lua mod checks the outbox mtime every 3 frames. When it sees new data, it reads from its last byte offset, parses each line, and appends the token text to the streaming display. The response renders live in the overlay while the player watches.

The whole cycle takes under 200ms from Enter to first visible token. File I/O adds maybe 100ms of latency versus a direct socket, but the Grok API round-trip dwarfs that. The player never notices.

### Rotation and cleanup

The outbox grows without bound if you never clean it. The daemon checks file size after every write and, when it crosses 1MB, writes a `{"type":"rotate"}` marker line and truncates the file. The Lua side sees the marker, resets its byte offset to 0, and clears its scrollback. You lose chat history during rotation, but that only happens after 50+ long exchanges --- a non-issue in practice.

### The deploy trick

One detail worth highlighting: the mod's `.lua` source files are *copied* into Noita's mod directory (Noita's Lua loader doesn't follow symlinks for source files), but the data files --- `state.json`, `inbox.jsonl`, `outbox.jsonl`, `vitals.jsonl` --- are *symlinked*. This means the mod and the daemon read and write the same physical files without any path gymnastics. The deploy script (`mod/deploy.sh`) handles this automatically.

---

## The Persona: Making an LLM Sound Like a Character

The daemon sends every player message to the Grok API (xAI) with a system prompt that defines Ukko's voice. This is not a generic "you are a helpful assistant" prompt. It's a compressed knowledgebase and a character sheet:

> You are Ukko, a Noita who has died 312 times, reached Kolmisilma 23 times, looped the parallel worlds twice, and still gets a stupid grin when a triple-cast homing spark bolt melts a Hiisi camp. You speak like the battle-scarred bastard at the starting hut bar --- dry, laconic, black humor, Finnish uncle energy.

The prompt includes:
- **Interaction rules**: short responses (the overlay is only ~15 lines tall), no bullet lists, no wiki dumps, no hedging. "Be decisive. If it's truly unknown, say 'new one on me --- test it in the corner with a pebble.'"
- **Banned phrases**: "seems like", "might", "probably", "I recommend". Ukko doesn't hedge. He's died 312 times. He knows.
- **A compressed biome guide**: what matters in each area, what kills you, what to farm.
- **Perk heuristics**: which perks to always take, which are situational, which are traps.
- **Wand stat priorities by game stage**: early game wants functional fire rate, late game wants max capacity and zero delay.
- **Proactive observation rules**: Ukko volunteers exactly one sharp observation when he sees imminent death or a god-tier synergy about to be missed. Otherwise he waits.

The key constraint is response length. The in-game overlay is a 60-character-wide box that shows maybe 15 wrapped lines. If Ukko writes a wall of text, the player has to scroll through it while the game is paused. The persona prompt enforces "1-2 small paragraphs, usually under 400 characters total. First sentence = the call in plain English, decisive. Then a brief *why*. Stop."

### Tool calling

Ukko has tools. The Grok API supports OpenAI-compatible function calling, so the daemon registers tool schemas and lets Grok invoke them mid-response:

- **`archive_run(name)`** --- Snapshot the current save to the archive. Ukko suggests evocative kebab-case names: "snowy-pheromone-god", "coal-pits-chainsaw-ldc".
- **`restore_run(name)`** --- Overwrite the current save. Destructive --- Ukko always confirms before invoking.
- **`refresh_snapshot()`** --- Re-read the save file when the state looks stale.
- **`lookup_spell(query)` / `lookup_perk(query)`** --- Static data lookups with heuristic advice.
- **`peek_perks()` / `peek_shops()` / `peek_wand()`** --- Seer Mode predictions (more on this below).

The persona prompt tells Ukko: "Don't narrate tool use. Do the thing, weave the result into your normal voice." So instead of "I'll look that up for you... According to the spell database...", Ukko just says: "Fast, cheap, low damage on its own. Stack it six deep under a Trigger and it becomes the engine for half the god builds in this mountain."

---

## The Overlay: A Chat Window Inside the Game

The in-game overlay is built entirely with Noita's vanilla Lua GUI API --- `GuiText`, `GuiImageNinePiece`, `GuiImage`. No external GUI libraries, no Dear ImGui dependency. This was a deliberate choice to avoid the complexity of loading third-party DLLs under Proton.

When the player presses backtick, the overlay opens: a semi-transparent nine-piece panel centered on screen with a scrollable chat history, a text input line with a blinking cursor, and a small Ukko icon in the corner.

### Input handling

Noita's `GuiTextInput` widget is unreliable for runtime chat (it drops characters, fights with the game's own input handling), so the overlay implements its own text input from scratch. Every frame, it polls `InputIsKeyDown` for scancodes 4-56 and maps them through a custom keymap table that handles shift, punctuation, and special characters. Backspace has proper key-repeat (20-frame delay before the first repeat, then every 2 frames). Enter sends. Escape closes.

The keymap module (`keymap.lua`) has its own unit test that runs under a plain Lua interpreter with mocked Noita API calls --- one of the few parts of the mod that can be tested outside the game.

### Input suppression (the hard part)

When the overlay is open, you don't want typing "hello" to also make your character walk left, jump, throw a bomb, and fire their wand. Suppressing player input in Noita is surprisingly difficult because there's no official API for it.

The solution is a belt-and-suspenders approach that runs every frame in `OnWorldPreUpdate` (before the engine reads input for the current tick):

1. **Zero all 15 `mButtonDown*` fields on `ControlsComponent`** --- movement, jump, fly, fire, fire2, left click, right click, throw, kick, eat, interact, change item. This catches almost everything.
2. **Zero `VelocityComponent.mVelocity`** --- backup in case any WASD input leaks through. The player physically can't move even if a control signal gets through.
3. **Refresh a `GameEffectComponent` with `disable_movement=1`** --- loaded from an XML file via `LoadGameEffectEntityTo` with a 3-frame lifetime and `exclusivity_function=always_replace`. Triple coverage.

One critical lesson: never call `EntitySetComponentIsEnabled` on `ControlsComponent`. I tried it. Confirmed native crash. `pcall` can't catch it. The entity handle becomes invalid and Noita segfaults. The field-zeroing approach is safe because you're writing values to a component that still exists.

Known limitation: UI keys like I (inventory), Esc (pause menu), Tab, M, and F still reach Noita's menu layer. There's no vanilla Lua API to intercept engine-level UI bindings. You'd need Dear ImGui for that. I chose to accept the limitation rather than take the dependency.

---

## Seer Mode: Predicting the Game's RNG

This is where the project gets technically interesting.

Noita generates everything from a single world seed. The community has reverse-engineered the pseudorandom number generator --- it's a pair of 32-bit LCG (Linear Congruential Generator) states initialized from the seed and a pair of coordinates:

```python
def set_random_seed(self, world_seed: int, x: float, y: float) -> None:
    a = float_to_u32(math.floor(x))
    b = float_to_u32(math.floor(y))
    ws = u32(world_seed)
    self.e = u32(ws ^ u32(a * 0x27D4EB2D))
    self.f = u32(ws ^ u32(b * 0x27D4EB2D + 0x165667B1))
    self._step()
    self._step()
```

The `_step` function is a classic LCG: `state = state * 0x41C64E6D + 0x3039`, truncated to 32 bits. Each `random()` call advances both states and XORs their upper bits to produce a value.

The elegance of this system is that it's deterministic and spatially keyed. Given the same seed and the same coordinates, the same sequence of random numbers always comes out. This means shop inventories, perk offerings, and wand stats are functions of `(seed, x, y, ng_plus)` --- and the temple coordinates are known constants.

### Porting the RNG

I ported the RNG from two sources:
- **`pudy248/noita_random.h`** --- a community C++ port of Noita's PRNG. This gave me `SetRandomSeed`, `ProceduralRandomf`, `ProceduralRandomi`, and `RandomDistribution`.
- **Noitool's WebAssembly module** --- the closed-source web tool compiles its predictor to WASM. I probed it by writing Node.js scripts that fed known inputs and captured outputs, then matched my Python port against those fixtures.

The Python port (`dm/seer/rng.py` and `dm/seer/noita_random.py`) replicates the C++/WASM behavior bit-for-bit. There's one subtle requirement: the WASM module internally casts float64 to float32 on return values. Missing this truncation makes predictions drift after a few RNG calls. The port applies `struct.pack("<f", ...)` / `struct.unpack("<f", ...)` at the boundary to match.

### What Seer Mode predicts

With the RNG port working, Seer Mode can predict:

- **Perks at each Holy Mountain**: what's offered, what appears after rerolls (up to N deep), across all 7 altars. Validated against 1,540 golden test vectors (10 seeds x 2 NG+ x 7 Holy Mountains x 11 reroll depths).
- **Shop inventories**: spells and wands at each Holy Mountain shop and the final altar. The shop model is coordinate-keyed --- each temple has fixed (x, y) coordinates, and the shop type (item vs. wand) is decided by the first `Random(0, 100)` call after seeding.
- **Wand stats**: cast delay, recharge time, capacity, shuffle/non-shuffle, mana max, speed multiplier, loaded spells. 110 out of 120 golden test cases pass byte-exact; the 10 failures are a 1-ULP (Unit in the Last Place) float drift on `speed_multiplier` --- display-only, all downstream fields match.
- **Alchemy recipes**: Lively Concoction and Alchemic Precursor ingredient formulas.
- **Fungal shift sequence**: which materials transform into what, in what order, across all 20 possible shifts.

### Spoiler levels

Not everyone wants full spoilers. Seer Mode has three presentation levels that the player can switch mid-run:

- **Full**: "Next altar: Extra Perk, Tinker With Wands Everywhere, Greed, Slime Blood. Reroll shows Glass Cannon --- skip."
- **Hint**: "Next altar leans wand-friendly; one trap in the mix."
- **Atmospheric**: "The first altar hums with iron and patience --- choose slow."

The spoiler level is enforced at the tool output layer, not the prompt layer. When `peek_perks()` returns data, the `presentation.py` module redacts it according to the current level before Grok ever sees the full details. This prevents the LLM from accidentally leaking information that the player wanted hidden.

### Golden seed testing

How do you know the predictions are right? You test them against known-good outputs.

The project has a golden seed test harness. Capture scripts (`scripts/capture_shop_goldens.mjs`, `capture_perk_goldens.mjs`, etc.) run Noitool's WASM module against a matrix of seeds, NG+ counts, and Holy Mountain indices, then save the results as JSON fixtures. The Python test suite runs the same inputs through the Python port and asserts byte-exact matches.

The perk reroll predictor alone has 1,540 golden test vectors. The shop predictor has 280+ goldens covering both default-unlocked and all-unlocked spell configurations. Any regression in the RNG port immediately fails CI.

---

## The Lua Mod: Hooks and Exports

The companion mod (`ukko-mod`) has three responsibilities: export game state, render the overlay, and hook game events.

### State export

Every 3 seconds (configurable), the mod builds a snapshot by querying Noita's entity system:

```lua
function build_snapshot()
    local player = EntityGetWithTag("player_unit")[1]
    local x, y = EntityGetTransform(player)

    local damage_comp = EntityGetFirstComponentIncludingDisabled(
        player, "DamageModelComponent")
    local hp = math.floor(
        ComponentGetValue2(damage_comp, "hp") * 25)

    -- ... gold, perks, biome, nearby entities ...

    return {
        hp = hp,
        biome = biome_from_y(y),
        position = { x = math.floor(x), y = math.floor(y) },
        seed = M_seed,
        -- ... 15+ more fields
    }
end
```

The snapshot includes HP (converted from Noita's internal 25-unit scale), gold, position, biome, active perks, nearby entities (perks, chests, enemies within 600px), fungal shift iteration, NG+ count, Holy Mountain index, and the world seed.

The seed is captured in `OnMagicNumbersAndWorldSeedInitialized` --- a Noita lifecycle callback that fires once per run, before the world generates. This is the earliest reliable moment to grab it.

### Tiered snapshot cadence

Full snapshots are expensive in late-game biomes with hundreds of entities. The mod splits its export into two tiers:

- **Fast tier** (every 60 frames, ~1 second): HP, position, biome change detection, and a vitals line appended to `vitals.jsonl`. This is cheap --- no entity scanning.
- **Slow tier** (every 180 frames, ~3 seconds): full snapshot with entity inspection (nearby perks, chests, enemies). Only runs when the overlay is open.

Both intervals are configurable via the mod settings panel. The slow tier also fires immediately on `OnPlayerDied` so the daemon always has the final state.

### Game event hooks

The mod hooks into several game scripts to track events the daemon needs:

- **Perk pickups**: `ModLuaFileAppend` injects a hook into `data/scripts/perks/perk.lua` that writes a line to `picks.jsonl` whenever the player takes a perk.
- **Perk rerolls**: Same technique on `data/scripts/buildings/perks_reroll.lua`.
- **Shop purchases**: Hooks into `data/scripts/buildings/shop_item.lua`.
- **Spell unlocks**: A detour on `AddFlagPersistent` catches spell unlock events and writes them to `spell_unlocks.jsonl`. This is how the shop predictor knows which spells are available in the player's pool.

These JSONL event logs are symlinked to the daemon's working directory, just like the other IPC files.

### Mid-run fallback

If the mod loads after the player has already passed some Holy Mountains (because they installed the mod mid-run), a one-shot fallback runs on world init. It checks Noita's `PERK_PICKED_*` run flags and writes degraded sentinel entries so the daemon can still respond coherently about past altars, even without precise pick data.

---

## Voice Input: Whisper in the Loop

Ukko supports voice input through faster-whisper, a CTranslate2-optimized Whisper implementation. Hold spacebar for 600ms to arm, keep holding to record, release to transcribe and inject the text into the chat buffer.

The daemon manages the Whisper model lifecycle:

- **`small.en`** (~300MB): default, fast, English-only. Runs on anything.
- **`distil-large-v3`** (~1.5GB): multilingual, moderate VRAM.
- **`large-v3-turbo`** (~6GB): best accuracy, needs ~6GB VRAM free.

Model selection is a mod setting. If the selected model OOMs on load, STT is silently disabled for that session --- the daemon logs a warning but doesn't crash. The player can switch to a smaller model and restart.

The arming state machine prevents accidental recordings from brief spacebar taps (which should type a space character). Below 600ms, the space is committed to the input buffer normally. Above 600ms, the overlay shows "ARMING" with a progress percentage, transitioning to a pulsing red "REC" indicator once recording starts.

---

## Proactive Observations

Ukko doesn't just answer questions. When Seer Mode is enabled with `seer.proactive = true`, the mod emits game events that trigger the daemon to generate unsolicited observations:

- **`biome_changed`**: player entered a new biome. Ukko might say: "Hiisi Base --- steel walls need Concentrated Mana or acid, and don't shoot the lamps."
- **`perk_picked`**: player took a perk. Ukko evaluates it against the current build.
- **`low_hp`**: HP below 20%. "Health-gate. Stop greeding and find a heart before the next room."

These proactive responses don't auto-open the overlay. That would pause the game while the player is actively fighting, which is unacceptable UX. Instead, a pulsing golden icon appears in the top-right corner of the screen. Its alpha oscillates sinusoidally between 0.4 and 1.0 at ~1Hz. If there are multiple unread messages, a small count badge appears. When the player opens the overlay, the messages appear in scrollback and the icon clears.

This is a small detail but it matters enormously for feel. The difference between "AI that interrupts you" and "AI that waits for you to be ready" is the difference between annoying and magical.

---

## Persistence: The Daemon Stays Alive

The key architectural invariant is: **the daemon owns conversation state. Clients are stateless.**

Closing Noita doesn't kill the daemon. Closing the terminal doesn't kill the daemon. Restarting the CLI just reconnects to the existing daemon on `localhost:7676`. The daemon writes a pidfile (`.daemon.pid`) for discovery and shuts down gracefully on SIGTERM, saving the current transcript to the `sessions/` directory.

This means Ukko has genuine memory across runs. Die in the Snowy Depths, rage-quit, come back tomorrow, and Ukko remembers: "Back at it. That propane trap is still the funniest death I've seen this week."

The `noita-dm` command handles this transparently:
1. Check for a running daemon on localhost:7676.
2. If absent, spawn one in the background (logs to `.daemon.log`).
3. Attach as a CLI client.
4. `noita-dm --shutdown` kills the daemon cleanly.

---

## The Full Stack in One Interaction

Let me trace a single player interaction through the entire system to show how all the pieces connect.

1. **Player is in the Snowy Depths, approaches a Holy Mountain.** The mod's fast-tier biome check detects `temple_altar` in the biome name. It increments the runtime HM index counter and writes a `biome_changed` event to `inbox.jsonl`.

2. **The daemon's overlay channel polls inbox, sees the event.** Because `seer.proactive` is enabled and the `perks` category is toggled on, the daemon calls `peek_perks()` internally.

3. **The perk predictor fires.** It initializes the PRNG with `(seed, temple_x, temple_y)`, runs the perk deck state machine (spawn order, pool shuffling, slot filling), and returns the 4 perks that will appear at this altar plus reroll previews.

4. **The result passes through presentation.** At spoiler level "hint", the full perk names are replaced with family descriptions: "wand-friendly, one survival perk, one trap."

5. **The daemon constructs a proactive prompt and feeds it to Grok** with the persona system prompt. Grok generates: "Altar's got a wand build in it. One trap --- you'll know it when you see it. Take the first or the third."

6. **The daemon writes the response tokens to `outbox.jsonl`** and appends a `proactive_notice` event. The Lua mod sees the notice while polling with the overlay closed and starts pulsing the golden icon.

7. **The player notices the icon, presses backtick.** The overlay opens, game pauses, the proactive message appears in scrollback. The player reads it, types "/seer peek perks", presses Enter.

8. **The daemon receives the chat command, dispatches to `peek_perks()` with full detail this time** (the `/seer` command overrides spoiler level to `full`). Returns: "Extra Perk, Tinker With Wands Everywhere, Greed, Slime Blood. Reroll 1 shows Glass Cannon --- skip."

9. **The player types "take extra perk" and closes the overlay.** Game resumes. Ukko remembers the choice.

---

## What I Learned

### File IPC is underrated

Every instinct said "use WebSockets everywhere." File-based IPC turned out to be the right call for the mod-daemon link. It works across the Proton boundary, survives process restarts, is trivially debuggable (just `tail -f` the files), and the latency penalty is invisible under real LLM response times. Append-only JSONL with byte-offset tailing is a simple, robust protocol that I'd use again in a heartbeat.

### Persona engineering is product design

The difference between a useful AI and a delightful AI is the persona. Ukko's prompt is not an afterthought --- it's the product. The banned-phrases list, the response length constraint, the instruction to never hedge, the proactive observation rules --- all of that is what makes Ukko feel like a character instead of a chatbot. I spent more time iterating on the system prompt than on any single Python module.

### Input suppression is an unsolved problem in Noita modding

There is no clean way to prevent keyboard input from reaching Noita's engine in vanilla Lua. The triple-mechanism approach (zero controls, zero velocity, load disable-movement effect) works for movement and combat, but UI keys still leak. This is a fundamental limitation of the modding API. The only real solution is Dear ImGui, which is a C++ DLL that intercepts input at the Win32 level. I chose not to take that dependency because it complicates the Proton/Linux story, but it's the right move for anyone building a serious text-input mod.

### Golden-seed testing is essential for RNG ports

Porting a pseudorandom number generator to a different language is a minefield. Off-by-one in bit truncation, float32 vs. float64 precision, signed vs. unsigned overflow --- any of these silently corrupt predictions downstream. The only defense is a large, mechanical test suite that runs your port against known-good outputs from the reference implementation. The 1,540-vector perk reroll test suite caught three bugs that would have been invisible in manual testing.

---

## What's Next

The project is pre-release. The core architecture is solid and the prediction engine passes its test suites, but there's polish work before it's ready for public distribution:

- **Ollama backend**: right now Ukko requires a Grok API key. The next major milestone is an Ollama backend so the entire system runs locally with no cloud dependency, no API key, and no cost. A local 9B-parameter model running on a consumer GPU should handle the persona and tool-calling workload.
- **Side-shop predictions**: the main Holy Mountain shops are predicted, but side shops (Pyramid, Lukki lair, Wizards' Den) have procedurally generated coordinates that can't be hardcoded. This needs a map-scan approach.
- **Steam Workshop release**: once the Ollama backend works, publish `ukko-mod` to the Workshop with a README, installation guide, and demo video.

The dream is that any Noita player can install the mod, run one command, and have a local AI dungeon master that knows their seed, speaks in character, and never phones home.

---

## Links

- **Project**: [github.com/StankyDanko/noita-dm](https://github.com/StankyDanko/noita-dm)
- **Noita**: [store.steampowered.com/app/881100/Noita](https://store.steampowered.com/app/881100/Noita/)
- **Noitool** (community seed explorer): [noitool.com](https://www.noitool.com/)
- **SouthernSky Cloud**: [southernsky.cloud](https://southernsky.cloud)
