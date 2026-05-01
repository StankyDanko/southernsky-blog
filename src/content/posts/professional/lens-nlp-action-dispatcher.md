---
title: "Natural Language Commanding: Building an NLP Action Dispatcher"
description: "OMNI's LENS command palette lets users type natural language to control 84 platform actions — fly to locations, toggle layers, run queries. Here's how the dispatcher works."
publishDate: 2026-03-14
author: j-martin
tier: professional
postType: project-walkthrough
difficulty: advanced
estimatedMinutes: 20
prerequisites: ["typescript", "nlp-basics"]
category: ai-ml
tags: ["nlp", "command-palette", "ai", "typescript", "ux", "search"]
certTracks: []
featured: false
draft: false
---

## Why Should You Care?

Command palettes are table stakes in dev tools — VS Code, Figma, Linear. But most stop at keyword matching: you type "open" and you get a list of things with "open" in the name.

OMNI needed more. Users describe intent in natural language: *"show earthquake data near Japan"*, *"how many vessels in the South China Sea"*, *"fly me to the Singapore Strait"*. The system needs to understand those as distinct action types, extract parameters, and dispatch to the correct handler — not just surface a fuzzy text match.

LENS (Language ENabled System) is the command layer I built to do that. 84 registered actions, sub-200ms dispatch, and a confidence-scored matcher that degrades gracefully when intent is ambiguous. Here's how it works.

---

## The Action Registry

Every dispatachable action in OMNI is registered in a typed registry. The registry entry defines:

- A canonical name and aliases
- The action category
- A parameter schema
- Training phrases used for matching

```typescript
// src/lens/registry.ts

export type ActionCategory =
  | 'navigation'
  | 'layer-control'
  | 'query'
  | 'ui'
  | 'data-export'
  | 'filter';

export interface LensAction {
  id: string;
  name: string;
  description: string;
  category: ActionCategory;
  aliases: string[];
  trainingPhrases: string[];
  parameters: ActionParameter[];
  handler: (params: Record<string, unknown>) => Promise<void>;
}

export interface ActionParameter {
  name: string;
  type: 'location' | 'layer-name' | 'numeric' | 'boolean' | 'string';
  required: boolean;
  extractionHint: string; // used by the parameter extractor
}
```

A navigation action looks like this:

```typescript
registry.register({
  id: 'nav.fly-to',
  name: 'Fly to Location',
  description: 'Pan and zoom the map to a named location',
  category: 'navigation',
  aliases: ['go to', 'navigate to', 'zoom to', 'center on'],
  trainingPhrases: [
    'fly to Tokyo',
    'go to the Singapore Strait',
    'navigate to the South China Sea',
    'center on Hong Kong',
    'zoom to the Strait of Hormuz',
    'show me Japan',
    'take me to Rotterdam',
  ],
  parameters: [
    {
      name: 'location',
      type: 'location',
      required: true,
      extractionHint: 'geographic location, city, or region name',
    },
  ],
  handler: async ({ location }) => {
    const coords = await geocoder.resolve(location as string);
    mapController.flyTo(coords, { duration: 1200 });
  },
});
```

The training phrases are the key. They're not keywords — they're full example sentences that represent how a real user would phrase this intent. You'll have 5–10 per action. With 84 actions, that's ~600 training phrases that form the matcher's corpus.

---

## The Dispatch Pipeline

```
User input
    │
    ▼
┌─────────────────────┐
│  Intent Classifier  │  ← embedding similarity against training phrases
└─────────────────────┘
    │  top-3 candidate actions with scores
    ▼
┌─────────────────────┐
│   Action Matcher    │  ← alias check + category priors + confidence filter
└─────────────────────┘
    │  winning action (or null)
    ▼
┌─────────────────────┐
│ Parameter Extractor │  ← LLM-backed extraction for complex types
└─────────────────────┘
    │  typed parameter map
    ▼
┌─────────────────────┐
│     Executor        │  ← calls action.handler, handles errors
└─────────────────────┘
```

### Stage 1: Intent Classifier

The classifier converts input to an embedding, then computes cosine similarity against all training phrase embeddings. The training phrase embeddings are pre-computed at startup and held in memory — 600 vectors at 384 dimensions each is ~900KB, entirely acceptable.

```typescript
// src/lens/classifier.ts

export class IntentClassifier {
  private phraseIndex: Array<{
    embedding: Float32Array;
    actionId: string;
    phrase: string;
  }> = [];

  async initialize(registry: ActionRegistry) {
    const phrases = registry.getAllTrainingPhrases();
    const embeddings = await embedder.batchEmbed(phrases.map(p => p.phrase));

    this.phraseIndex = phrases.map((p, i) => ({
      embedding: embeddings[i],
      actionId: p.actionId,
      phrase: p.phrase,
    }));
  }

  async classify(input: string): Promise<ClassificationResult[]> {
    const inputEmbedding = await embedder.embed(input);

    const scores = this.phraseIndex.map(entry => ({
      actionId: entry.actionId,
      score: cosineSimilarity(inputEmbedding, entry.embedding),
      matchedPhrase: entry.phrase,
    }));

    // Group by action, take max score per action
    const byAction = groupBy(scores, s => s.actionId);
    const topScores = Object.entries(byAction).map(([actionId, hits]) => ({
      actionId,
      score: Math.max(...hits.map(h => h.score)),
      matchedPhrase: hits.sort((a, b) => b.score - a.score)[0].matchedPhrase,
    }));

    return topScores
      .sort((a, b) => b.score - a.score)
      .slice(0, 3); // top-3 candidates
  }
}
```

I'm using `nomic-embed-text` via a local Ollama instance for embeddings. Cold start on the batch embed is ~400ms; subsequent single queries are ~15ms. You could swap in OpenAI's `text-embedding-3-small` for lower latency at higher cost.

### Stage 2: Action Matcher

The classifier gives you top-3 candidates with raw similarity scores. The matcher applies business logic on top:

```typescript
// src/lens/matcher.ts

const CONFIDENCE_THRESHOLD = 0.72;
const ALIAS_BOOST = 0.12; // bump score if input starts with a registered alias

export class ActionMatcher {
  match(
    input: string,
    candidates: ClassificationResult[],
    registry: ActionRegistry
  ): MatchResult | null {
    const normalizedInput = input.toLowerCase().trim();

    const scored = candidates.map(candidate => {
      const action = registry.get(candidate.actionId);
      let score = candidate.score;

      // Boost if input starts with a known alias
      const aliasMatch = action.aliases.find(alias =>
        normalizedInput.startsWith(alias.toLowerCase())
      );
      if (aliasMatch) score += ALIAS_BOOST;

      // Penalize if input length is far from training phrase length
      // (prevents "show" matching "show me the full Pacific shipping route analysis")
      const lengthRatio =
        normalizedInput.length / candidate.matchedPhrase.length;
      if (lengthRatio < 0.3 || lengthRatio > 3.0) score -= 0.08;

      return { action, score, candidate };
    });

    const best = scored.sort((a, b) => b.score - a.score)[0];

    if (best.score < CONFIDENCE_THRESHOLD) {
      return null; // not confident enough — surface suggestions instead
    }

    return {
      action: best.action,
      confidence: best.score,
      matchedPhrase: best.candidate.matchedPhrase,
    };
  }
}
```

When the matcher returns `null`, LENS falls back to showing the top-3 candidates as suggestions with their confidence percentages. Users can click to execute with a prompt for any missing parameters.

### Stage 3: Parameter Extractor

This is where it gets interesting. Navigation actions need a location. Layer actions need a layer name. Queries need a region and possibly a count threshold. Extracting those from free-form input is a separate problem from intent classification.

For simple types (boolean, numeric), regex extraction is enough. For complex types (location, layer name), I use an LLM with a structured extraction prompt:

```typescript
// src/lens/extractor.ts

export class ParameterExtractor {
  async extract(
    input: string,
    action: LensAction
  ): Promise<Record<string, unknown>> {
    const requiredParams = action.parameters.filter(p => p.required);

    if (requiredParams.length === 0) return {};

    // Build extraction prompt
    const schema = requiredParams.map(p => ({
      name: p.name,
      type: p.type,
      hint: p.extractionHint,
    }));

    const prompt = `Extract parameters from this user command.

Command: "${input}"

Extract these parameters:
${JSON.stringify(schema, null, 2)}

Return a JSON object with the parameter names as keys.
If a parameter cannot be extracted, use null.
Return only valid JSON, no explanation.`;

    const response = await llm.generate(prompt, { format: 'json' });

    return JSON.parse(response);
  }
}
```

In production, the LLM call runs in parallel with a fast regex pass. If regex gets the parameters (90% of cases), the LLM result is discarded. If regex returns null for required fields, the LLM result fills the gap.

---

## Action Categories in Practice

Here's a representative sample across the four main categories:

### Navigation (12 actions)

```
"fly to Tokyo"                     → nav.fly-to         { location: "Tokyo" }
"zoom to Singapore Strait"         → nav.fly-to         { location: "Singapore Strait" }
"show me the Suez Canal"           → nav.fly-to         { location: "Suez Canal" }
"go back to previous view"         → nav.history-back   {}
"reset map to global view"         → nav.reset-view     {}
"fit all vessels on screen"        → nav.fit-vessels    {}
```

### Layer Control (31 actions)

```
"show earthquake data"             → layer.enable       { layer: "earthquakes" }
"hide weather overlay"             → layer.disable      { layer: "weather" }
"toggle shipping lanes"            → layer.toggle       { layer: "shipping-lanes" }
"turn on AIS signal layer"         → layer.enable       { layer: "ais" }
"disable all overlays"             → layer.disable-all  {}
"show me bathymetry"               → layer.enable       { layer: "bathymetry" }
```

### Queries (28 actions)

```
"how many ships near Singapore"    → query.vessel-count { region: "Singapore", radius: null }
"find tankers in the Gulf"         → query.vessel-type  { type: "tanker", region: "Persian Gulf" }
"show vessels flagged Russia"      → query.vessel-flag  { flag: "Russia" }
"count ports in Southeast Asia"    → query.port-count   { region: "Southeast Asia" }
"find vessels over 300m long"      → query.vessel-size  { minLength: 300 }
```

### UI (13 actions)

```
"open the weather panel"           → ui.open-panel      { panel: "weather" }
"close all panels"                 → ui.close-all       {}
"switch to satellite view"         → ui.set-basemap     { basemap: "satellite" }
"export current view as PNG"       → ui.export-image    {}
"open settings"                    → ui.open-settings   {}
```

---

## The Test Suite

All 84 actions have associated test inputs. The test file is the ground truth for the classifier — when you add new training phrases or tune parameters, you run this to see if coverage holds:

```typescript
// src/lens/__tests__/dispatcher.test.ts

const testCases: Array<{ input: string; expectedAction: string }> = [
  { input: 'fly to Tokyo', expectedAction: 'nav.fly-to' },
  { input: 'go to the Singapore Strait', expectedAction: 'nav.fly-to' },
  { input: 'center map on Rotterdam', expectedAction: 'nav.fly-to' },
  { input: 'zoom out to see all vessels', expectedAction: 'nav.zoom-out' },
  { input: 'show earthquake data', expectedAction: 'layer.enable' },
  { input: 'turn on the AIS layer', expectedAction: 'layer.enable' },
  { input: 'hide the weather overlay', expectedAction: 'layer.disable' },
  { input: 'how many container ships near Malacca', expectedAction: 'query.vessel-count' },
  { input: 'find all tankers flagged Liberia', expectedAction: 'query.vessel-flag' },
  { input: 'open the port analysis panel', expectedAction: 'ui.open-panel' },
  // ... 74 more
];

describe('LENS Dispatcher', () => {
  test.each(testCases)('dispatches "$input" to $expectedAction', async ({ input, expectedAction }) => {
    const result = await dispatcher.classify(input);
    expect(result?.action.id).toBe(expectedAction);
  });
});
```

Current pass rate: 81 / 84. The three misses are intentional edge cases I've left in to track: overlapping intents where two actions have nearly identical training phrases. Resolving them requires either more distinct phrasing or a disambiguation step.

---

## The Cmd+K Interface

The UI is a floating palette that opens on Cmd+K (Mac) or Ctrl+K (Windows/Linux). As the user types, results update with a 150ms debounce:

```typescript
// src/components/LensBar.tsx (simplified)

export function LensBar() {
  const [input, setInput] = useState('');
  const [result, setResult] = useState<DispatchResult | null>(null);

  const dispatch = useDebouncedCallback(async (value: string) => {
    if (value.length < 3) return;
    const r = await lensDispatcher.preview(value);
    setResult(r);
  }, 150);

  const execute = async () => {
    if (!result?.action) return;
    await lensDispatcher.execute(result.action.id, result.params);
    close();
  };

  return (
    <Dialog>
      <input
        value={input}
        onChange={e => { setInput(e.target.value); dispatch(e.target.value); }}
        onKeyDown={e => e.key === 'Enter' && execute()}
        placeholder="What would you like to do?"
      />
      {result && (
        <div className="lens-result">
          <ActionPreview action={result.action} params={result.params} confidence={result.confidence} />
          {result.confidence < 0.72 && <SuggestionList candidates={result.candidates} />}
        </div>
      )}
    </Dialog>
  );
}
```

The `preview()` method runs the full pipeline but stops before execution, returning the resolved action and extracted parameters so the UI can show *"Fly to: Tokyo"* before the user commits.

---

## Performance

Real-world dispatch times, measured from keypress to preview render:

```
Embedding (local nomic-embed-text):   15ms
Similarity search (600 vectors):       2ms
Alias + length scoring:                1ms
Parameter extraction (regex path):     3ms
Parameter extraction (LLM path):     180ms  ← only for complex types
UI render:                             4ms
─────────────────────────────────────────
Total (regex path):                   25ms
Total (LLM path):                    205ms
```

The LLM extraction path fires on ~10% of queries. For the other 90%, dispatch is under 30ms — fast enough that it feels synchronous.

---

## What You Learned

- **Training phrases beat keyword lists.** Embedding similarity over example sentences handles paraphrase and intent variation that keyword matching can't.
- **Two-stage classification is more robust than one.** The classifier surfaces candidates; the matcher applies business logic (alias boosting, length penalties, confidence thresholds) to pick the winner.
- **Parameter extraction is a separate concern.** Intent classification and parameter extraction have different failure modes and should be handled by different mechanisms — regex for simple types, LLM for structured complex types.
- **The test suite is the spec.** 84 labeled test cases make the classifier's behavior verifiable and regressions visible when you tune parameters.
- **Degrade gracefully below threshold.** When confidence is low, show suggestions rather than guessing. Users correct the system with their next keystroke.
