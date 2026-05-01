---
title: "Debugging AudioContext Memory Leaks in React"
description: "The app leaked 2MB every mode switch. The culprit: an AudioContext nobody was closing. Here's the full debugging story — from symptom to fix."
publishDate: 2026-05-01
author: j-martin
tier: professional
postType: project-walkthrough
difficulty: advanced
estimatedMinutes: 15
prerequisites: ["react", "javascript-basics"]
category: javascript-typescript
tags: ["react", "debugging", "memory-leaks", "web-audio", "performance"]
heroImage: "/images/posts/audiocontext-memory-leak.webp"
featured: false
draft: false
---

The app was leaking 2MB of memory every time a user switched typing modes. The bug? An AudioContext that nobody was closing.

This is the story of how I found it, what I learned about the Web Audio API's resource model, and three related bugs I uncovered along the way. The project is a typing coach built with React and TypeScript — a real-time input handler that plays audio feedback on every correctly typed word, tracks per-key accuracy stats, and supports multiple text modes including AI-generated content and scripture passages.

---

## The Symptom

I noticed the problem during a long testing session. After switching between typing modes a dozen times, the app was sluggish. The character-level animations stuttered. Chrome's Task Manager showed the tab consuming 400MB+ of memory for what should have been a 30MB application.

At first I assumed it was a state accumulation issue — maybe the word history array was growing unbounded, or the keystroke analytics were piling up objects. Those are the usual suspects in a React app that tracks per-character data.

But closing the analytics overlay and clearing history didn't help. The memory was gone and it wasn't coming back.

---

## What Is AudioContext?

Before we get into the hunt, some background on what was leaking.

The [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) is the browser's audio processing engine. At its center is `AudioContext` — the graph manager. Every audio operation (oscillator, filter, gain node, analyser) lives inside an `AudioContext` graph. When you create one, the browser allocates real system resources:

- An audio processing thread
- OS-level audio session handles
- Internal mixing buffers
- Output routing infrastructure

These are not garbage-collected JavaScript objects. They are heavyweight native resources. The browser enforces a hard limit — Chrome allows roughly 6 concurrent `AudioContext` instances before it starts throwing warnings, and performance degrades well before that.

Here's the key fact: **creating a new `AudioContext` allocates system resources. Dereferencing it in JavaScript does not release them.** You must explicitly call `.close()` to free the underlying audio thread and OS handles. Without that call, the resources persist for the lifetime of the page.

---

## Finding the Leak

### Step 1: Chrome DevTools Memory Tab

I opened DevTools, switched to the **Memory** tab, and took a heap snapshot. Then I typed through 20 words (triggering 20 correct-word audio chimes), took another snapshot, and diffed them.

The snapshot comparison showed 20 new `AudioContext` objects allocated between snapshots. None had been garbage collected. That was the smoking gun.

### Step 2: Tracing the Allocation

I searched the codebase for `new AudioContext` and found exactly one call site — inside the input handler that fires on every spacebar press:

```typescript
// The buggy version — inside handleInputChange
if (value.endsWith(" ")) {
  const typedWord = value.trim();
  const isCorrect = typedWord === targetWord;

  if (isCorrect) {
    if (soundEnabled) {
      const ctx = new (window.AudioContext
        || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.frequency.setValueAtTime(987, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(
        1318, ctx.currentTime + 0.05
      );

      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        0.001, ctx.currentTime + 0.2
      );
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    }
  }
}
```

Every correctly typed word creates a brand new `AudioContext`, wires up an oscillator for a 200ms chime, and lets it play. After the oscillator stops, the function scope ends, and `ctx` becomes unreachable in JavaScript. But the browser's audio thread doesn't know that. The `AudioContext` stays open, consuming memory and a system audio handle, until you explicitly call `ctx.close()`.

A fast typist hitting 80 words per minute generates 60-70 correct words per minute. That's 60-70 orphaned `AudioContext` instances per minute, each consuming roughly 1-2MB of native memory. In a 10-minute session, that's 600+ orphaned contexts and over a gigabyte of leaked memory.

### Step 3: Verifying With the Performance Monitor

To confirm the diagnosis, I opened Chrome's **Performance Monitor** (three-dot menu > More Tools > Performance Monitor) and watched the "JS heap size" and "DOM Nodes" graphs while typing. The heap grew in a sawtooth pattern, with each tooth corresponding to a correctly typed word. Garbage collection flattened the JavaScript object graph, but the native memory (visible in Task Manager, not in JS heap) only went up. Classic native resource leak profile.

---

## The Fix: Singleton AudioContext via useRef

The solution is a singleton pattern: create one `AudioContext` when you first need it, store it in a React ref, and reuse it for every subsequent sound. Each oscillator and gain node is lightweight and short-lived — it's the `AudioContext` itself that's expensive.

```typescript
// --- REFS ---
const inputRef = useRef<HTMLInputElement>(null);
const activeWordRef = useRef<HTMLDivElement>(null);
const containerRef = useRef<HTMLDivElement>(null);
const audioCtxRef = useRef<AudioContext | null>(null);
```

Then in the input handler:

```typescript
if (isCorrect) {
  if (soundEnabled) {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext
        || (window as any).webkitAudioContext)();
    }
    const ctx = audioCtxRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.frequency.setValueAtTime(987, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(
      1318, ctx.currentTime + 0.05
    );

    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.001, ctx.currentTime + 0.2
    );
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  }
}
```

The change is small — five lines of diff — but the impact is dramatic. Instead of N `AudioContext` instances for N correct words, there's exactly one for the entire session. The oscillator and gain nodes are created fresh each time, but they're cheap: they exist within the context's existing audio graph and are cleaned up when they stop playing.

Why `useRef` instead of `useState` or a module-level variable? Because `useRef`:

1. Persists across renders without triggering re-renders (unlike `useState`)
2. Lives within the component lifecycle, so it gets cleaned up on unmount (unlike a module global)
3. Gives us a mutable `.current` slot that the `useCallback` input handler can read without needing it in its dependency array

If you wanted to be thorough, you'd also close the context on unmount:

```typescript
useEffect(() => {
  return () => {
    audioCtxRef.current?.close();
  };
}, []);
```

In this particular app (a single-page typing coach), the component never unmounts, so the cleanup effect isn't strictly necessary. But it's good practice for components that might be conditionally rendered.

---

## The Pattern: Why This Bug Is So Common

This bug has a specific shape worth naming: **per-event native resource allocation in a hot path**. The hallmarks:

1. A callback that runs frequently (keypress, scroll, mousemove)
2. Inside it, a native resource constructor (`new AudioContext`, `new WebSocket`, `new Worker`, `canvas.getContext()`)
3. No explicit cleanup — just relying on garbage collection
4. Works perfectly in light testing (a few invocations leak a few MB — unnoticeable)
5. Fails at scale (hundreds of invocations during real usage)

The fix is always the same: hoist the expensive construction out of the hot path, store it in a ref or module scope, and reuse it. The API-specific cleanup method (`.close()`, `.terminate()`, `.disconnect()`) goes in the teardown.

Other Web APIs that have this same pattern:

| API | Constructor | Cleanup | Leak Cost |
|-----|------------|---------|-----------|
| Web Audio | `new AudioContext()` | `.close()` | ~2MB + audio thread |
| WebSocket | `new WebSocket(url)` | `.close()` | TCP connection + buffers |
| Web Worker | `new Worker(url)` | `.terminate()` | OS thread + heap |
| Canvas 2D | `canvas.getContext('2d')` | Remove canvas from DOM | GPU texture memory |
| WebGL | `canvas.getContext('webgl')` | `.getExtension('WEBGL_lose_context')` | GPU context slot (limited) |
| MediaStream | `getUserMedia()` | `.getTracks().forEach(t => t.stop())` | Camera/mic hardware lock |

If you're calling any of these in a `useCallback`, `useEffect`, or event handler that runs more than once, you likely need the singleton-ref pattern.

---

## Bug #2: State Mutation in useCallback

While investigating the AudioContext leak, I found a second bug in the keystroke tracking hook. This one didn't leak memory, but it violated React's immutability contract in a way that could produce incorrect analytics.

Here's the original `recordKeystroke` function:

```typescript
const recordKeystroke = useCallback(
  (expectedChar: string, isCorrect: boolean) => {
    setKeyStats((prev) => {
      const stat = prev[expectedChar] || { hits: 0, misses: 0 };
      if (isCorrect) stat.hits++;
      else stat.misses++;
      return { ...prev, [expectedChar]: stat };
    });
  }, []
);
```

The problem is on the `const stat = prev[expectedChar] || ...` line. When the character already exists in `prev`, this line doesn't create a new object — it returns **a reference to the existing object inside `prev`**. Then `stat.hits++` mutates that object in-place, which means we're mutating the previous state.

The spread `{ ...prev, [expectedChar]: stat }` does create a new top-level object, but `stat` is the same reference that already existed in `prev`. React sees a new object at the top level and triggers a re-render, but the inner object was mutated in both the old and new states. This means any code that compares previous vs. current key stats (diff calculations, analytics history, React.memo comparisons) will see incorrect data — the "previous" values will have already been incremented.

The fix is to always create a new `stat` object:

```typescript
const recordKeystroke = useCallback(
  (expectedChar: string, isCorrect: boolean) => {
    setKeyStats((prev) => {
      const existing = prev[expectedChar];
      const stat = existing
        ? { hits: existing.hits, misses: existing.misses }
        : { hits: 0, misses: 0 };
      if (isCorrect) stat.hits++;
      else stat.misses++;
      return { ...prev, [expectedChar]: stat };
    });
  }, []
);
```

The difference: `{ hits: existing.hits, misses: existing.misses }` creates a fresh object by copying the primitive values. Now mutating `stat` doesn't affect `prev`.

This is one of those bugs that works 99% of the time because React's reconciliation doesn't deeply compare previous state by default. It only surfaces when you add memoization, time-travel debugging, or state comparison logic. But it's a ticking time bomb — and React Strict Mode's double-invocation in development is specifically designed to expose mutations like this.

---

## Bug #3: Effect Dependency Array Causing Constant Re-runs

The third bug was a `useEffect` that was supposed to persist state to `localStorage` when relevant values changed. It was firing on every single render instead:

```typescript
// Before: fires every render
useEffect(() => {
  try {
    keyStatsHook.persistKeyStats();
    localStorage.setItem("zenotype_hands", showHands.toString());
    scripture.persistScripture();
  } catch {}
}, [keyStatsHook, showHands, scripture]);
```

The dependency array includes `keyStatsHook` and `scripture` — the entire return objects from custom hooks. These objects are recreated on every render (hooks return new object literals), so React sees them as changed every time. The effect runs every render, writing to `localStorage` on every single keystroke. That's not a memory leak, but it's unnecessary I/O that adds up in a high-frequency input handler.

The fix: depend on the specific stable callbacks, not the hook objects:

```typescript
// After: only fires when persistence functions change
useEffect(() => {
  try {
    keyStatsHook.persistKeyStats();
    localStorage.setItem("zenotype_hands", showHands.toString());
    scripture.persistScripture();
  } catch {}
}, [keyStatsHook.persistKeyStats, showHands, scripture.persistScripture]);
```

Since `persistKeyStats` and `persistScripture` are wrapped in `useCallback`, they maintain referential stability across renders (unless their own dependencies change). This reduces the effect from "fires every render" to "fires when there's actually something new to persist."

This is a common gotcha with custom hooks that return object literals. The pattern to remember: **never put a hook's return object in a dependency array — always destructure to the specific values or callbacks you depend on.**

---

## React Strict Mode and Double-Mounting

A quick note on React Strict Mode, since two of these three bugs interact with it.

In development, React 18+ mounts every component twice (mount → unmount → mount) to help surface bugs with missing cleanup. This means:

- **AudioContext leak:** Strict Mode would create two `AudioContext` instances on mount instead of one. With the buggy per-word allocation, this was noise — two extra among hundreds. With the singleton fix, you'd notice one extra context. This is why the cleanup effect (`audioCtxRef.current?.close()` in a return function) matters even for "permanent" components — Strict Mode will exercise that path.

- **State mutation:** Strict Mode's double-invocation of state updaters would call the buggy `recordKeystroke` twice with the same `prev` object. The first call mutates `prev[expectedChar]` in-place; the second call reads the already-mutated value and increments again. You'd get double-counted keystrokes — but only in development, making it an extremely confusing debug target.

- **Effect dependency:** Strict Mode's double-mount triggers the persistence effect twice on initial load. With the object-reference dependency array, this was invisible because it was already firing every render. With the fix applied, you'd see two writes on mount — correct behavior for Strict Mode's intentional double-invocation.

---

## How to Detect These Bugs in Your Own Code

### Memory Leaks (AudioContext Pattern)

1. Open Chrome DevTools > Memory tab
2. Take a heap snapshot (baseline)
3. Perform the action you suspect is leaking (in this case, type 20 correct words)
4. Take another heap snapshot
5. Switch to "Comparison" view between the two snapshots
6. Sort by "# New" — look for native resource objects (`AudioContext`, `WebSocket`, `Worker`)
7. If the count equals the number of times you performed the action, you have a per-event allocation leak

You can also use the **Performance Monitor** panel to watch the JS heap in real time. Memory sawtooth patterns (up, GC drop, up higher) indicate accumulation. But native resource leaks won't show in JS heap — use Chrome's Task Manager (Shift+Esc) to see the full process memory.

### State Mutations

1. Enable React Strict Mode in development (it's on by default in Vite + React)
2. Install the [React DevTools](https://react.dev/learn/react-developer-tools) browser extension
3. Use the Profiler to record renders
4. Look for components rendering with "unchanged" props that still produce different output — this indicates a mutation upstream
5. Add `Object.freeze()` to your state updater returns during debugging: if a mutation happens later, it will throw

### Effect Over-firing

1. Add a `console.count('effect-name')` inside the effect body
2. Perform a single action that should trigger the effect once
3. If the console shows more than one invocation (accounting for Strict Mode doubling), your dependency array is too broad
4. Use the [eslint-plugin-react-hooks](https://www.npmjs.com/package/eslint-plugin-react-hooks) `exhaustive-deps` rule — but understand that it can't distinguish between stable and unstable references. That judgment is on you.

---

## The Broader Lesson

The three bugs I found during this investigation share a common root cause: **treating browser APIs like pure JavaScript**. JavaScript is garbage-collected. The DOM is garbage-collected (mostly). But the Web Audio API, WebSocket, WebGL, and friends allocate resources outside the JavaScript heap. React's component lifecycle manages JavaScript state beautifully, but it has no awareness of native resources. That bridge — between React's declarative world and the browser's imperative resource management — is where these bugs live.

The rules of thumb:

1. **If the constructor allocates system resources, hoist it to a ref.** Don't create it in a callback.
2. **If you're putting it in a `useCallback`, you're probably creating it too often.** Move it to `useRef` and initialize lazily.
3. **If the API has a `.close()` or `.terminate()` method, call it in cleanup.** That method exists because GC won't do it for you.
4. **If you're spreading previous state but referencing its inner objects, you're probably mutating.** Clone the inner objects too.
5. **If your dependency array contains a hook's return object, you're firing every render.** Destructure to stable references.

The AudioContext fix was five lines of diff. The state mutation fix was three lines. The effect dependency fix was a single line. Combined, they eliminated a gigabyte-scale memory leak, a data integrity issue, and hundreds of unnecessary `localStorage` writes per session. Small bugs. Big impact. The kind of thing that separates code that works in a demo from code that works in a real session.
