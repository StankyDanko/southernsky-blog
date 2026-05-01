---
title: "Real-Time AI Typing Coach — Building ZenoType"
description: "ZenoType is a typing practice app that uses a local AI model to generate custom prompts — including a Scripture mode. Built with vanilla TypeScript and Ollama."
publishDate: 2026-03-16
author: j-martin
tier: applied
postType: project-walkthrough
difficulty: intermediate
estimatedMinutes: 15
prerequisites: []
category: javascript-typescript
tags: ["typescript", "ollama", "typing", "education", "vanilla-js", "vite"]
certTracks: []
featured: false
heroImage: "/images/posts/zenotype-ai-typing-coach.webp"
draft: false
---

## Why Should You Care?

Every typing practice app uses the same word lists: the quick brown fox, Lorem ipsum, random dictionary words. They're fine for raw speed practice, but they don't build the vocabulary you actually type at work.

ZenoType takes a different approach: you give it a topic, and a local AI model generates a passage tailored to that domain. If you're a developer, you practice typing code documentation. If you're studying, you practice with actual material from the subject. And if you want to use it for Scripture memorization — there's a mode for that too.

It runs entirely offline. No API keys, no cloud dependencies. The AI runs through Ollama on your own machine.

## Architecture Overview

ZenoType v0.8.0 is about 900 lines of TypeScript across eight modules. No React, no Vue — just vanilla TypeScript compiled by Vite. The decision to avoid a framework was deliberate: typing apps are latency-sensitive. Every keypress needs a sub-millisecond response to feel right. Adding a virtual DOM reconciliation cycle between keydown and the character highlight update would make the app feel sluggish.

```
src/
  main.ts           # Entry point, wires everything together
  components/
    Header.ts       # Title, mode selector, WPM/accuracy display
    ScriptureSelect.ts  # Bible book/chapter picker (Scripture mode)
    TypingArea.ts   # The actual typing interface
  services/
    ollama.ts       # Ollama API calls
    scripture.ts    # ESV passage fetcher
  utils/
    metrics.ts      # WPM and accuracy calculation
    highlight.ts    # Character-by-character coloring
  types.ts          # Shared TypeScript interfaces
```

## The Typing Area Component

The core challenge in any typing app is the character highlight logic. You have a reference string and a user input string, and you need to visually show: correct (green), incorrect (red), not yet typed (neutral), and the cursor position.

```typescript
// src/utils/highlight.ts

export interface CharState {
  char: string;
  status: 'correct' | 'incorrect' | 'pending' | 'cursor';
}

export function computeCharStates(
  reference: string,
  typed: string
): CharState[] {
  return reference.split('').map((char, i) => {
    if (i === typed.length) {
      return { char, status: 'cursor' };
    }
    if (i >= typed.length) {
      return { char, status: 'pending' };
    }
    return {
      char,
      status: typed[i] === char ? 'correct' : 'incorrect',
    };
  });
}
```

The `TypingArea` component calls this on every keypress and re-renders the character spans:

```typescript
// src/components/TypingArea.ts

export class TypingArea {
  private container: HTMLElement;
  private reference: string = '';
  private typed: string = '';
  private startTime: number | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    document.addEventListener('keydown', this.handleKey.bind(this));
  }

  setPrompt(text: string): void {
    this.reference = text;
    this.typed = '';
    this.startTime = null;
    this.render();
  }

  private handleKey(e: KeyboardEvent): void {
    // Ignore modifier-only keypresses
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    if (e.key === 'Backspace') {
      this.typed = this.typed.slice(0, -1);
    } else if (e.key.length === 1 && this.typed.length < this.reference.length) {
      if (this.startTime === null) {
        this.startTime = Date.now();
      }
      this.typed += e.key;
    }

    this.render();

    if (this.typed.length === this.reference.length) {
      this.onComplete();
    }
  }

  private render(): void {
    const states = computeCharStates(this.reference, this.typed);
    this.container.innerHTML = states
      .map(({ char, status }) => {
        const display = char === ' ' ? '&nbsp;' : char;
        return `<span class="char ${status}">${display}</span>`;
      })
      .join('');
  }

  private onComplete(): void {
    const elapsed = (Date.now() - (this.startTime ?? Date.now())) / 1000 / 60;
    const { wpm, accuracy } = calculateMetrics(this.reference, this.typed, elapsed);
    // Emit to Header for display
    document.dispatchEvent(new CustomEvent('typing:complete', {
      detail: { wpm, accuracy }
    }));
  }
}
```

No framework, no state management library. Components communicate through standard DOM CustomEvents. It's the simplest thing that works.

## Metrics: WPM and Accuracy

The standard definition of WPM uses "words" as groups of 5 characters, not actual word counts. This normalizes scores across passages with different average word lengths:

```typescript
// src/utils/metrics.ts

export interface TypingMetrics {
  wpm: number;
  accuracy: number;
}

export function calculateMetrics(
  reference: string,
  typed: string,
  elapsedMinutes: number
): TypingMetrics {
  if (elapsedMinutes === 0) return { wpm: 0, accuracy: 100 };

  // Standard: 1 word = 5 characters
  const grossWpm = typed.length / 5 / elapsedMinutes;

  // Count errors
  let errors = 0;
  for (let i = 0; i < typed.length; i++) {
    if (typed[i] !== reference[i]) errors++;
  }

  // Net WPM = gross WPM minus error penalty
  const errorPenalty = errors / elapsedMinutes;
  const netWpm = Math.max(0, Math.round(grossWpm - errorPenalty));

  const accuracy = typed.length > 0
    ? Math.round(((typed.length - errors) / typed.length) * 100)
    : 100;

  return { wpm: netWpm, accuracy };
}
```

Live WPM updates every second using a `setInterval` that calls this function with the current elapsed time. The typing area doesn't need to complete for you to see your speed — it updates in real time.

## AI Prompt Generation via Ollama

This is what makes ZenoType different from a static word list. The user types a topic (or picks one from a preset), and the app requests a passage from a local Ollama model:

```typescript
// src/services/ollama.ts

const OLLAMA_BASE = 'http://localhost:11434';

export async function generateTypingPassage(
  topic: string,
  model: string = 'qwen2.5:7b'
): Promise<string> {
  const response = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: buildPrompt(topic),
      stream: false,
      options: {
        temperature: 0.7,
        num_predict: 120,
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status}`);
  }

  const data = await response.json();
  return cleanPassage(data.response);
}

function buildPrompt(topic: string): string {
  return `Write a typing practice passage about "${topic}".

Requirements:
- Exactly 80-100 words
- Plain prose, no bullet points or headers
- No special characters or symbols except periods, commas, and apostrophes
- Natural sentences that flow well when typed
- Varied word length for good finger movement practice

Write only the passage. No introduction, no explanation.`;
}

function cleanPassage(raw: string): string {
  return raw
    .trim()
    .replace(/\n+/g, ' ')      // collapse newlines
    .replace(/["""]/g, '"')    // normalize quotes
    .replace(/['']/g, "'")     // normalize apostrophes
    .replace(/\s+/g, ' ');     // normalize whitespace
}
```

The `num_predict: 120` cap keeps response time fast. On a machine running `qwen2.5:7b`, this returns in about 2 seconds — fast enough that the loading state doesn't feel annoying.

The `cleanPassage` function handles a real problem: language models love to output "smart quotes" (curly quotes). If the reference text has `"` but the user types `"` on their keyboard, every quote would register as an error. Normalizing to straight ASCII keeps the comparison clean.

## Scripture Mode

Scripture mode works differently from AI generation. Instead of asking the model to invent a passage, it fetches a real Bible chapter and serves verses as typing prompts:

```typescript
// src/services/scripture.ts

// ESV API endpoint (public, no auth required for small requests)
const ESV_BASE = 'https://api.esv.org/v3/passage/text';

export async function fetchScripturePassage(
  book: string,
  chapter: number,
  verse: number
): Promise<string> {
  const reference = `${book} ${chapter}:${verse}`;
  const params = new URLSearchParams({
    q: reference,
    'include-headings': 'false',
    'include-footnotes': 'false',
    'include-verse-numbers': 'false',
    'include-short-copyright': 'false',
  });

  const response = await fetch(`${ESV_BASE}/?${params}`, {
    headers: { Authorization: `Token ${ESV_API_KEY}` }
  });

  const data = await response.json();
  return data.passages[0].trim();
}
```

The `ScriptureSelect` component renders a book dropdown and chapter/verse selectors. When the user picks a passage, the app fetches it and loads it into the typing area. Practicing Scripture this way has an interesting secondary effect: the repetition of typing a verse multiple times actually helps with memorization.

For users who want fully offline Scripture mode, the app falls back to a bundled cache of common passages when the API is unavailable.

## Vite Configuration

The build config is minimal:

```typescript
// vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    minify: 'esbuild',
  },
  server: {
    port: 5173,
    // Proxy Ollama requests to avoid CORS issues in dev
    proxy: {
      '/ollama': {
        target: 'http://localhost:11434',
        rewrite: (path) => path.replace(/^\/ollama/, ''),
      }
    }
  }
});
```

The Ollama proxy matters during development. Browsers enforce CORS, and Ollama doesn't send `Access-Control-Allow-Origin` headers by default. The Vite dev server proxies `/ollama/*` to `localhost:11434/*`, so all requests appear same-origin. In production, you set `OLLAMA_ORIGINS` in the Ollama environment to allow your domain.

## The SouthernSky Link

ZenoType ships with a small footer linking back to southernsky.cloud — it's part of the SouthernSky Intelligent Software suite. This is handled through an environment variable baked in at build time:

```typescript
// src/components/Header.ts
const BRAND_URL = import.meta.env.VITE_BRAND_URL ?? 'https://southernsky.cloud';
```

Set in `.env`:
```
VITE_BRAND_URL=https://southernsky.cloud
```

Vite's `import.meta.env` replaces these at build time, so the final bundle contains the literal URL string, not an env lookup.

## What You Learned

- Vanilla TypeScript with Vite is a valid choice for latency-sensitive apps where framework overhead is measurable
- DOM CustomEvents (`document.dispatchEvent` / `addEventListener`) are sufficient for cross-component communication without a state library
- Ollama's `/api/generate` endpoint accepts `num_predict` to cap token count and `stream: false` to get a single JSON response instead of a stream
- Smart quote normalization is a real requirement when comparing AI-generated text against keyboard input
- `Persistent=true` — just kidding, that was the last post. Here: Vite's `proxy` config solves Ollama CORS in development without modifying the Ollama service
