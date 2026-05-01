---
title: "Building an AI Typing Coach That Generates Its Own Lessons"
description: "Most typing tutors use the same boring sentences. I built one that generates infinite lessons on any topic using a local AI model."
publishDate: 2026-05-01
author: j-martin
tier: applied
postType: project-walkthrough
difficulty: intermediate
estimatedMinutes: 14
prerequisites: ["typescript-basics"]
category: javascript-typescript
tags: ["typing", "ollama", "ai", "react", "ux"]
heroImage: "/images/posts/ai-typing-coach.webp"
featured: false
draft: false
---

## Why Should You Care?

You already know how to type. You've been doing it since you were eight years old. But have you ever practiced typing *about something you actually wanted to learn*? Every typing tutor I've ever used hands you the same canned sentences: "The quick brown fox jumps over the lazy dog." Lorem ipsum. Random dictionary words. You get fast at typing nonsense. It doesn't stick.

When I built ZenoType, I wanted to solve a different problem: what if the typing coach *taught you something new every time you used it?* What if you picked a topic -- "the economics of speedrunning" or "how TCP handshakes work" -- and the app generated an original educational passage on that topic, streamed it into the typing interface, and then kept generating more passages that continued the thread as you typed?

That's what this post is about. Not the typing interface (we covered that in a previous walkthrough), but the AI text generation pipeline underneath it. How I wired a local Ollama model into a React app so that it generates infinite, adaptive typing lessons on any topic -- and how I solved the UX problem of making sure the typist never has to wait for the AI to catch up.

---

## The Core Problem: Text That Teaches

Static typing tutors have a fixed corpus. Even the good ones -- Monkeytype, Keybr -- generate from word frequency lists or random character sequences. They're optimized for *raw speed practice*, not comprehension. The text is disposable. You type it and forget it.

I wanted ZenoType's text to be worth reading. If someone picks "The Bizarre Economics of Speedrunning" as their topic, the passages they type should actually explain something about speedrunning economics. And when they finish one paragraph, the next one should continue the story -- not restart from scratch with a disconnected fact.

This means the AI backend needs to do three things:

1. **Generate educational prose** on an arbitrary topic, formatted for typing practice (no bullet points, no headers, no special characters that aren't on a standard keyboard).
2. **Maintain narrative continuity** across multiple generations so the text reads like a coherent article, not a bag of random paragraphs.
3. **Adapt the content** to the typist's speed, accuracy, and weak keys -- targeting their problem areas without them noticing.

Let's walk through each piece.

---

## Boot Sequence: Finding the AI

Before any text generation happens, ZenoType needs to discover what AI models are available. The app supports two modes: online (Ollama-powered) and offline (static sentence pools). The boot sequence determines which one to use:

```typescript
// src/hooks/useOllama.ts — AI-First Boot Sequence

useEffect(() => {
  let mounted = true;
  fetch(`${OLLAMA_BASE_URL}/api/tags`)
    .then((res) => res.json())
    .then((data) => {
      if (data.models && data.models.length > 0 && mounted) {
        const modelNames = data.models.map(
          (m: { name: string }) => m.name
        );

        // Prefer the custom ZenoType model, fall back to llama3.2:3b
        let initialModel = modelNames[0];
        if (modelNames.includes('zenotype:latest'))
          initialModel = 'zenotype:latest';
        else if (modelNames.includes('llama3.2:3b'))
          initialModel = 'llama3.2:3b';

        setSelectedModel(initialModel);
        setOllamaEnabled(true);
        onBootSuccess(initialModel);
        fetchTopicsFromOllama(initialModel);
      } else {
        throw new Error('No models detected');
      }
    })
    .catch(() => {
      if (mounted) {
        setOllamaEnabled(false);
        onBootFailed('adaptive');
      }
    });
  return () => { mounted = false; };
}, []);
```

The `OLLAMA_BASE_URL` is environment-configurable. In development, it points to `localhost:11434`. In production (on GitHub Pages), it hits a remote Ollama endpoint I host at `zenotype-api.southernsky.cloud`. Either way, the boot logic is the same: hit the `/api/tags` endpoint, enumerate available models, pick the best one.

If Ollama isn't reachable -- no server running, network down, remote endpoint offline -- the app degrades to offline mode silently. No error modal. No "AI features unavailable" banner. It just starts generating text from a local sentence pool instead. The user still gets a typing experience; it's just not AI-powered.

This graceful degradation is important. A typing coach that crashes because the AI server is down is worse than one that never had AI at all.

---

## Topic Selection: The Neural Uplink

When Ollama boots successfully, the app enters what I call the "Neural Uplink" -- a topic selection screen where the AI generates eight quirky, niche topic suggestions:

```typescript
const promptPayload = `Generate a comma-separated list of exactly 8
highly diverse, incredibly niche, and slightly absurd topics.

The vibe should appeal to a 25-year-old American who loves internet
culture, obscure history, nuance, and has a great sense of humor.

CRITICAL RULES:
1. NO numbering or bullet points.
2. NO introductory text or conversational filler.
3. Output ONLY the topics separated by commas.
4. DO NOT output the words "Quantum Physics".
5. DO NOT use underscores to separate words.
Random Seed: ${seed}`;
```

A few things worth noting about this prompt:

**The random seed.** Without it, consecutive calls to the same model tend to produce very similar topic lists. Models have preferred "resting states" -- patterns they fall into when the prompt doesn't push them somewhere specific. The random seed injects entropy into the prompt itself, so even if the model's temperature is moderate, the outputs vary.

**The anti-pattern rules.** Rules 1, 2, and 3 exist because language models *love* to be helpful. Left unconstrained, they'll produce output like: "Sure! Here are 8 fascinating topics for you: 1. The History of..." That's unusable for a comma-split parser. The rules are stern because politeness gets you preambles.

**Rule 4: "DO NOT output the words Quantum Physics."** This one is real. During development, roughly 40% of topic lists included some variant of "The Quantum Physics of [X]." It's the model's security blanket. Banning it explicitly forced more creative outputs.

**Rule 5: underscores.** Small models sometimes output `The_History_Of_Bread` instead of `The History Of Bread`. This breaks the UI layout. Explicit prohibition plus a post-processing `.replace(/_/g, ' ')` handles both the instruction and the models that ignore it.

The response gets parsed through a sanitizer that strips quotes, asterisks, leading dashes, and filters by length:

```typescript
const parsedTopics = data.response
  .split(',')
  .map((t: string) =>
    t.trim()
      .replace(/['"]/g, '')
      .replace(/^[*-]\s*/, '')
      .replace(/_/g, ' ')
  )
  .filter((t: string) => t.length > 0 && t.length < 50)
  .slice(0, 8);
```

If sanitization produces fewer than 4 valid topics, the whole result is discarded and the app falls back to a curated pool of hand-written topics. Things like "The Cutthroat World of Competitive Excel" and "Why Evolution Keeps Turning Things Into Crabs." These are always good. They never produce empty strings. And they're funny enough that nobody feels like the AI failed them.

---

## The Educator Engine: Generating Typing Passages

Once the user picks a topic, the real work begins. The `fetchOllamaWords` function is the heart of ZenoType's AI pipeline. It constructs a prompt that adapts to four signals: the user's speed (TPM), their difficulty mode, their weak keys, and whether they're in a flow state.

### Adaptive Tone

The prompt's tone shifts based on how fast the user is typing:

```typescript
const tone =
  tpm > 120
    ? 'urgent, fast-paced, and highly technical'
    : tpm > 70
      ? 'informative and analytical'
      : 'calm, methodical, and accessible';
```

A slow typist gets approachable prose. A fast typist gets dense, technical material. This isn't just for variety -- it's pedagogically sound. When someone is typing slowly, they're reading more carefully. Give them something worth reading carefully. When they're flying, give them challenging material that matches their energy.

### Difficulty Modes

ZenoType has five difficulty modes: Standard, Code, Syntax, Scripture, and Adaptive. For the AI pipeline, the interesting ones are Code, Syntax, and Adaptive. Each one modifies the prompt's formatting instructions:

```typescript
let contextModifier =
  'Write standard, engaging, grammatical English prose.';

if (difficulty === 'code' ||
    (difficulty === 'adaptive' && tpm > 60 && tpm <= 100)) {
  contextModifier =
    'Write standard English prose, but substitute key concepts ' +
    'with camelCaseVariables and snake_case_terms.';
}

if (difficulty === 'syntax' ||
    (difficulty === 'adaptive' && tpm > 100)) {
  contextModifier =
    'Write flowing English prose, but aggressively pepper the ' +
    'sentences with programming symbols like {}, [], (), &&, ' +
    '||, and ===. Substitute some nouns with camelCase.';
}
```

In Adaptive mode, the difficulty escalates automatically. Below 60 TPM, you get clean English. Between 60 and 100, camelCase and snake_case start appearing. Above 100, you're typing through brackets, pipes, and triple-equals. The idea is that developers need to be fast with symbols, not just letters. Most typing tutors ignore this entirely.

### Weak Key Targeting

This is my favorite part. ZenoType tracks every keystroke the user makes and records which characters they miss most often. The `useKeyStats` hook maintains a hit/miss counter per character, persisted to localStorage across sessions. Before each generation request, the app identifies the user's four worst keys:

```typescript
const worstKeys = Object.entries(aggregatedKeyStats)
  .map(([k, v]) => ({
    key: k,
    acc: v.hits / (v.hits + v.misses),
    total: v.hits + v.misses,
  }))
  .filter((k) => k.total >= 3 && k.acc < 1)
  .sort((a, b) => a.acc - b.acc)
  .slice(0, 4)
  .map((k) => k.key);
```

The `total >= 3` filter prevents noise. If you've only typed the letter 'q' twice, one miss is a 50% accuracy rate -- but that's not statistically meaningful. Three attempts is the minimum before the system starts acting on the data.

These weak keys get appended to the prompt:

```text
6. Naturally incorporate words that contain these specific
characters to help the user practice their weak points: j, q, z, x
```

The key word is "naturally." You don't want the AI to produce "Jazzily, the quixotic fox juxtaposed..." -- that's obviously mechanical. By asking it to incorporate the characters *naturally* within an educational passage, the practice feels organic. The user doesn't know they're being targeted. They just notice that after a few sessions, their 'j' key accuracy went from 72% to 91%.

### Thread Continuity

Most AI text generation is stateless. You send a prompt, you get a response, the model forgets everything. ZenoType breaks this pattern with a lightweight memory system.

After each generation, the app stores the last 15 words of the passage:

```typescript
const lastWords = parsedWords
  .slice(-15)
  .map((w) => w.text)
  .join(' ');
threadHistoryRef.current = lastWords;
```

On the next generation request, those words get injected into the prompt as context:

```typescript
const promptPayload = threadHistoryRef.current
  ? `CONTINUE the educational narrative about ${thread}
     seamlessly. Context to continue from:
     "...${threadHistoryRef.current}"`
  : `You are an expert educator. Write a fascinating paragraph
     (3 to 4 sentences) teaching the user about ${thread}.`;
```

This creates a "persistent neural thread" -- each paragraph picks up where the last one left off. The user types about the economics of speedrunning, finishes the paragraph about prize pool distributions, and the next paragraph opens with a transition into sponsorship deals. It reads like an article being written in real time, not a series of disconnected prompts.

Fifteen words is enough context for the model to maintain topical coherence without burning excessive tokens on the input. I tested with 5, 10, 15, and 30. Five words caused frequent topic drift. Thirty words didn't produce noticeably better continuity than fifteen, but doubled the prompt length. Fifteen was the sweet spot.

---

## Flow State Detection

ZenoType has a gamification layer built around "Transformer words" -- 5% of words are randomly tagged as special (shown in purple). Capturing five Transformer words increments a `tScore`. When the tScore crosses a milestone threshold, the app enters a "flow state" and generates a special kind of passage:

```typescript
const isFlowState = currentTScore >= flowMilestone + 5;

const promptPayload = isFlowState
  ? `Write a highly rhythmic, calming, and flowing paragraph
     (3 to 4 sentences) about ${thread}.
     CRITICAL RULES:
     1. MUST be entirely lowercase.
     2. MUST NOT contain ANY punctuation or numbers.
     3. Output ONLY the raw text to give the user a smooth
        speed boost.`
  : // ...normal generation prompt
```

Flow state passages are lowercase, unpunctuated, rhythmic prose. No capital letters to fumble. No periods or commas to break your stride. Just smooth, flowing words designed to let the typist feel *fast*. It's the typing equivalent of a downhill section in a running course -- a reward for sustained performance that also lets you build momentum.

The milestone ratchets up after each flow state (`flowMilestone + 5`), so the gaps between flow states get longer as you play. You can't farm them.

---

## The Pre-Fetch Problem

Here's the UX challenge that made this project interesting: the typist should never see a loading screen.

A competent typist at 100 TPM (roughly 80 WPM) burns through a 50-word passage in about 30 seconds. A strong typist at 150+ TPM does it in under 20 seconds. Meanwhile, a 7B parameter model on decent hardware takes 1-3 seconds to generate a passage, but that's assuming the request is already in flight. If you wait until the user finishes the current passage to *start* generating the next one, there's a 1-3 second gap where they're staring at a spinner. That gap breaks flow. It feels broken.

The solution is pre-fetching. ZenoType monitors the user's position in the word array and triggers a new generation request when they're 40 words from the end:

```typescript
// src/App.tsx — Word pre-fetch effect

useEffect(() => {
  if (
    appPhase === 'playing' &&
    words.length > 0 &&
    activeWordIndex > words.length - 40 &&
    difficulty !== 'scripture'
  ) {
    if (ollama.ollamaEnabled) {
      ollama.fetchOllamaWords({
        aggregatedKeyStats: keyStatsHook.aggregatedKeyStats,
        tpm: gameEngine.tpm,
        difficulty,
        tScore: gameEngine.tScore,
      });
    } else {
      setWords((prev) => [
        ...prev,
        ...generateWords(40, gameEngine.tpm, difficulty),
      ]);
    }
  }
}, [activeWordIndex, words.length]);
```

When the trigger fires, the new words get *appended* to the existing array, not replaced:

```typescript
onWordsGenerated: useCallback(
  (newWords: Word[], isReset: boolean) => {
    if (isReset) {
      setWords(newWords);
    } else {
      setWords((prev) => [...prev, ...newWords]);
    }
  }, []
),
```

The `isReset` flag distinguishes between "user picked a new topic" (replace everything) and "user is still typing, feed them more" (append). This is the same pattern used in infinite scroll on social media feeds, but applied to educational text generation.

At 100 TPM, the user hits the 40-word threshold roughly 25 seconds into a 50-word buffer. That gives the model 25 seconds of runway to generate the next batch -- more than enough, even on slower hardware. By the time the user reaches the end of the current batch, the next batch is already loaded and waiting.

The result: from the user's perspective, the text is infinite. They pick a topic and start typing. New paragraphs appear seamlessly. They never wait. They never see a loading state after the initial topic selection. The AI is always one step ahead.

---

## The Sanitization Gauntlet

AI-generated text is not keyboard-ready by default. Language models produce characters that don't exist on a standard keyboard, and if those characters end up in the reference text, every occurrence registers as an error even when the user types "correctly." This was the source of approximately 100% of my early bug reports during testing.

The sanitization pipeline strips everything problematic:

```typescript
let cleanText = data.response
  // Strip model control tokens (qwen artifacts)
  .replace(/<\|.*?\|>/g, '')
  // Strip markdown formatting
  .replace(/[*_`#]/g, '')
  // Strip preamble ("Here is the paragraph...")
  .replace(
    /(here is|here are|sure|certainly|generated paragraph).*?\n/gi,
    ''
  )
  // Normalize smart quotes to straight quotes
  .replace(/[‘’]/g, "'")
  .replace(/[“”]/g, '"')
  // Normalize dashes
  .replace(/[–—]/g, '-')
  // Nuclear option: strip any remaining non-ASCII
  .replace(/[^\x20-\x7E\n]/g, '')
  .trim();
```

Let me walk through the interesting ones:

**Model control tokens.** Qwen-family models sometimes leak special tokens like `<|im_start|>` or `<|endoftext|>` into their output. These are invisible in most terminals but absolutely visible in a typing interface. The regex `/<\|.*?\|>/g` catches all of them.

**Preamble stripping.** Despite explicit instructions not to, models regularly start their output with "Sure! Here is a paragraph about..." or "Certainly, here is the generated paragraph:" This regex catches the most common variants and strips everything up to the first newline. It's a blunt instrument -- it might occasionally eat a legitimate sentence that starts with "Here is" -- but in practice, educational paragraphs about speedrunning economics don't tend to start that way.

**Smart quote normalization.** This is the big one. When the reference text contains a curly apostrophe (Unicode `’`) but the user types a straight apostrophe (ASCII `\x27`), the character comparison fails. The word "don't" registers as incorrect even when typed perfectly. Normalizing all Unicode quotes to their ASCII equivalents before the text reaches the typing interface eliminates this entire class of bugs.

**The nuclear option.** After all the targeted replacements, one final regex strips any remaining non-ASCII characters. If the model outputs an em-dash that the targeted replace missed, or an accented character, or an emoji -- gone. The typing interface only deals with characters in the `0x20` to `0x7E` range (printable ASCII). This is aggressive, but typing practice demands it.

---

## Abort Control and Race Conditions

When the user switches topics mid-generation, or the pre-fetch fires while a previous generation is still in flight, you get race conditions. Two responses arrive. The second one might be for the old topic. Words from different topics get interleaved. Chaos.

ZenoType handles this with `AbortController`:

```typescript
if (isReset && generateAbortControllerRef.current) {
  generateAbortControllerRef.current.abort();
}

const controller = new AbortController();
generateAbortControllerRef.current = controller;

const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
  // ...
  signal: controller.signal,
});
```

When a new generation request fires, the previous one is aborted. The in-flight `fetch` throws an `AbortError`, which gets caught and silently ignored:

```typescript
catch (error: any) {
  if (error.name === 'AbortError') return;
  // ...handle real errors
}
```

The same pattern protects topic generation. Both the topic generator and the passage generator maintain their own `AbortController` refs. When the user resets (`Alt+R`), both controllers fire, both in-flight requests die, and the UI transitions cleanly to the topic selection screen.

Without this, switching topics fast enough would crash the app. With it, you can mash `Alt+R` as fast as you want and the state machine stays coherent.

---

## The Fallback System

Not everyone has Ollama running. Not everyone has a GPU. The app needs to work for everyone, so the offline fallback is a first-class feature, not an afterthought.

When Ollama is unreachable -- either at boot or mid-session -- the app generates text from a local sentence pool:

```typescript
export const generateWords = (
  count = 60,
  tpm = 0,
  difficulty: Difficulty = 'adaptive',
  forceFlow = false,
): Word[] => {
  let wordPool: Word[] = [];
  while (wordPool.length < count) {
    let wordType: WordType = 'standard';
    if (difficulty === 'adaptive') {
      wordType = tpm > 100 ? 'syntax'
               : tpm > 60  ? 'code'
               : 'standard';
    }

    let sentence = '';
    if (forceFlow) {
      sentence = 'finding your rhythm is the key to achieving ' +
        'a true zen state of mind where your fingers simply ' +
        'fly across the keyboard';
    } else if (wordType === 'syntax') {
      sentence = SENTENCES_SYNTAX[
        Math.floor(Math.random() * SENTENCES_SYNTAX.length)
      ];
    }
    // ...pool selection continues

    const sentenceWords: Word[] = sentence.split(' ').map((w) => {
      const isTransformer = Math.random() < 0.05;
      return {
        type: isTransformer ? 'transformer' : wordType,
        text: w,
      };
    });

    wordPool = [...wordPool, ...sentenceWords];
  }
  return wordPool.slice(0, count);
};
```

The offline generator mirrors the AI pipeline's features where it can: adaptive difficulty (standard/code/syntax based on TPM), Transformer word insertion (5% random), and flow state passages. It can't do topic-specific content or weak-key targeting -- those require the model -- but the core typing experience is intact.

This two-tier architecture means ZenoType works on a Chromebook with no AI stack just as well as it works on my workstation with 69 Ollama models. The feature set scales to the user's hardware.

---

## What Makes This Different From the Typing Interface Post

If you read the previous ZenoType walkthrough on this blog, you saw the character-by-character highlight system, the WPM math, the Vite proxy, and the Scripture mode. That post was about the *typing experience* -- what happens after the text is on screen.

This post is about what happens *before* the text is on screen. The prompt engineering. The thread continuity. The adaptive difficulty pipeline. The pre-fetch timing. The sanitization gauntlet. The fallback hierarchy.

They're two halves of the same system. The typing interface is the part the user sees. The AI pipeline is the part that makes the content worth typing.

---

## What You Learned

- Ollama's `/api/tags` endpoint lets you discover available models at boot time, enabling graceful degradation when the AI backend is offline.
- Thread continuity across AI generations can be achieved cheaply by storing the last N words of each response and injecting them as context in the next prompt. Fifteen words was the empirical sweet spot for topical coherence without excessive token cost.
- Pre-fetching AI-generated content at a threshold (40 words remaining) creates the illusion of infinite text by overlapping generation with typing time.
- ASCII sanitization is non-negotiable for AI-generated typing content. Smart quotes, em-dashes, and model control tokens all break character-by-character comparison.
- `AbortController` prevents race conditions when the user switches topics or triggers multiple generation requests. Always abort the previous request before starting a new one.
- Weak-key targeting -- identifying the user's least accurate characters and injecting them into AI prompts -- creates personalized practice that feels invisible to the user.
- Two-tier generation (AI-powered with offline fallback) ensures the app works on any hardware, with the feature set scaling to available resources.
