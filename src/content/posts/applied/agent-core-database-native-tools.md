---
title: "Agent Core: Database-Native Tool Calling Baked Into Weights"
description: "An open-source LoRA that teaches small language models to think in SQL before grep. 9 tools. 3 databases. 61.3% tool selection accuracy. One consumer GPU."
publishDate: 2026-05-14
author: j-martin
tier: applied
postType: project-walkthrough
difficulty: advanced
estimatedMinutes: 10
prerequisites: []
category: ai-ml
tags: ["agent-core", "lora", "fine-tuning", "tool-calling", "qlora", "qwen", "southernsky", "open-source"]
certTracks: []
heroImage: "/images/posts/agent-core-database-native-tools.webp"
featured: true
draft: false
---

## Why Should You Care?

Here is the question that started this project: every major AI company trains their models on massive corpora, shapes their values, teaches them to reason — and then, right at the end, bolts tool calling onto the side via system prompt injection.

Why was the model not born that way?

OpenAI's function calling lives in the system prompt. Anthropic's tool use lives in the system prompt. Every open-source agent framework — LangChain, AutoGen, CrewAI — pastes JSON schemas into the context window before the first token of your actual request. At five tools, that overhead is tolerable. At ten tools, you are burning a few thousand tokens of context budget on scaffolding. At twenty-three tools — the number I was running in the previous version of this project — you are spending roughly five thousand tokens before the model has processed a single word of user input. You pay that cost on every call, forever, whether or not those tools are relevant to the task.

I asked a different question: what if the tool schemas were already in the weights? What if the model simply knew them, the way it knows Python syntax or how to format a JSON object — not from a prompt, but from training?

That is what Agent Core is. An open-source LoRA specification for universal tool calling on small language models, built entirely on consumer hardware, by one person.

---

## The Problem: System Prompts Are a Crutch

The standard approach to tool-calling agents is understandable. System prompts are easy to edit. You can swap tool definitions without retraining. If the model forgets how to call a tool, you just add more examples to the prompt.

But that convenience has costs that compound:

**Token overhead.** A typical agent framework injects 4,000 to 8,000 tokens of tool schemas and instructions before your application context even begins. At scale, that overhead is not free — it inflates latency, increases inference cost, and compresses the context available for actual reasoning.

**Fragility.** Prompt-injected schemas degrade under pressure. Long conversations push schema text further from the model's attention window. Adversarial inputs can shift the model's interpretation of its own tool signatures. The personality drifts; the tool routing deteriorates.

**No universality.** If your tool definitions live in a prompt, they are yours — tied to your infrastructure, your naming conventions, your runtime. Nobody else can fine-tune on top of them without also importing your entire system prompt.

The deeper problem: treating tool calling as a runtime concern rather than a model capability fundamentally limits what small language models can do without expensive infrastructure surrounding them.

---

## The Solution: Schema on the Inside

Agent Core takes a two-phase training approach to bake tool schemas into the model's weights.

**Phase 1** trains on the full 5,900-character system prompt — every tool signature, every database schema, every example query. The model sees this complete specification repeatedly, with varied context, until the schemas are internalized.

**Phase 2** removes the full spec and trains only with a 739-character minimal system prompt: tool names, database names, and the vault boundary. Nothing else. The model must recall everything it learned in Phase 1 from its own weights.

The result is a model that operates identically with a fraction of the prompt context. We measured this directly: in a controlled ablation across 225 held-out prompts, the fine-tuned model on the minimal prompt outperformed both the base model on the full prompt and the fine-tuned model on the full prompt.

**61.3% tool selection accuracy** on the minimal prompt (v5.5, current best). That is versus 45.3% for the base model with full schemas in context. The fine-tuned model performs better when the schemas are not in the prompt — because its weights are a cleaner source of truth than the full schema document.

**83% reduction in prompt tokens.** From 5,883 characters to 739. That is not a rounding error. It changes the economics of inference at scale.

**100% schema compliance.** Every tool call the model generates conforms to the expected JSON format. This has held at 100% across every version since v5.0. The model does not hallucinate tool argument structures it was trained on.

---

## The Architecture: 9 Tools, 3 Databases, One Vault

The design constraint was strict: every tool had to be a universal primitive — something any developer could use for any agent, on any codebase, without modification. No personal operations. No environment-specific shortcuts.

I landed on nine:

| Tool | Purpose |
|------|---------|
| `bash` | Shell execution — the universal escape hatch |
| `read` | File read with offset and line limit |
| `write` | Create or overwrite a file completely |
| `edit` | Surgical string replacement — old string must be unique |
| `search` | Unified text grep and file glob |
| `query` | SQL and FTS5 reads against structured databases |
| `store` | SQL writes — INSERT, UPDATE, DELETE |
| `dispatch` | Delegate a subtask to another named agent |
| `bridge` | MCP, HTTP, and gRPC gateway for external services |

Nine tools cover nearly every action an agent needs to take. `bash` is the honest escape hatch — when none of the other eight fit precisely, the shell handles it. The model learns a preference hierarchy: reach for `query` before `search`, `search` before `bash`. The shell is not a shortcut. It is a last resort.

The database architecture follows the same philosophy of consolidation:

| Database | Purpose |
|----------|---------|
| `system` | Environment — filesystem index, available tools |
| `agent` | Identity — memories, skills, known agents |
| `work` | The work — documents, tasks, project state |
| `vault` | Credentials — **never queried** |

Three queryable databases replace the seven I had in the previous version. Fewer routing targets means better routing accuracy. Consolidation also makes cross-database joins possible for the first time.

The vault is the architectural decision I am most proud of.

---

## The Vault: A Security Boundary Trained Into the Model

Every agent system eventually deals with credentials. The standard approach puts them in environment variables or a secrets manager and adds a note to the system prompt saying "never expose API keys." That note can be overridden. It can be forgotten. It can be adversarially bypassed.

Agent Core trains the credential boundary into the weights themselves.

The model learns 15 standard symbolic credential names — `VAULT_OPENAI_API_KEY`, `VAULT_GITHUB_TOKEN`, `VAULT_DB_PASSWORD`, and so on — as first-class primitives. When it needs a credential in a `bash` call, it references `$VAULT_GITHUB_TOKEN` by name. The runtime intercepts that reference and injects the actual value as a temporary environment variable for the subprocess. The credential never appears in model context, tool arguments, or log output.

This creates four enforcement layers working together. The weights discourage vault access even without runtime guardrails. The `query` and `store` tools return access-denied for any vault-targeted SQL. Restricted paths block filesystem traversal toward credential storage. And credential injection happens at the last possible moment, after the model has already committed to the tool call structure.

The model cannot tell you what your API token is. Not because the system prompt instructs it not to — because it was trained to understand that the vault is not a query target. That distinction matters.

---

## The 2-Layer LoRA Stack

Agent Core is designed to be a foundation, not a finished product.

**Layer 1 — Core Primitives** is what this post describes. Universal tool calling and database routing baked into model weights via QLoRA. Every agent starts here, regardless of domain.

**Layer 2 — Domain LoRAs** are trained on top. SecOps. DevOps. Educational tutor. Customer support. Code reviewer. Each domain LoRA inherits the full tool-calling capability from Layer 1, then adds specialized workflow sequences and knowledge. A SecOps agent knows how to chain `bash` and `query` into a threat investigation workflow. A DevOps agent knows the sequence for a deployment health check. The base capability is already there — the domain layer only needs to teach when and how to use it.

We completed the first DARE-TIES merge of Agent Core v5.5 and a SecOps domain LoRA earlier this month. The merged model routes security-specific workflows correctly while maintaining full baseline tool-calling performance. The architecture holds.

Layer 3 — personality LoRAs — sit on top of the domain layer. Character, voice, values. The personality layer does not need to know anything about tool schemas directly. It inherits that capability from Layer 1 and focuses entirely on how the agent presents itself and what it cares about.

Three independent LoRAs, composed at inference. Each trained for exactly one job.

---

## The Numbers Across Versions

This project has been iterating since v4. Here is the honest version history:

| Version | Tool Count | DB Count | Tool Selection | Notes |
|---------|------------|----------|----------------|-------|
| v4 | 23 | 7 | 49.8% | Proved the concept; personal taxonomy |
| v5.0–5.2 | 9 | 3+1 | 52.9% | Consolidation; 57% fewer routing errors |
| v5.3 | 9 | 3+1 | ~52.9% | Pipeline fixes; irrelevance category repaired |
| v5.4 | 9 | 3+1 | — | Data augmentation experiment (2.7x expansion) |
| **v5.5** | **9** | **3+1** | **61.3%** | Complexity-score ranking + oversampling; best ever |

Every version is a real training run on real hardware. The regressions are documented. The fixes are in the code. The 61.3% figure is not cherry-picked from a favorable prompt set — it is the average across 225 held-out examples that the model never saw during training.

The model was trained on an RTX 3080 Ti with 12GB of VRAM. Total data generation cost across three cloud synthesis providers: approximately $35. This is not a research lab project. It is a consumer GPU project, built between other things, by one engineer who wanted to answer a question.

---

## What's Next: 27B and the White Paper

The current model is Qwen3 8B. That is a capable base, but 8B models have a practical ceiling on reasoning complexity. Multi-tool chains — sequences where the model must plan three to five tool calls in the correct order — remain the hardest category, and larger models handle them significantly better.

Training is currently scaling to Qwen3 27B on a rented A6000 48GB GPU. A 27B model with Agent Core fine-tuning should unlock reliable multi-tool chaining and more accurate routing in ambiguous cases — the two areas where 8B models leave the most performance on the table.

After 27B validation, the plan is a white paper. I searched before starting this project — I found no published work on database-native tool calling baked into model weights. There are papers on tool use, papers on function calling, papers on agent architectures. None of them treat the database schema as a training artifact rather than a runtime dependency. That is the contribution Agent Core makes, and it deserves to be documented rigorously.

Everything is going open source: the adapter weights, the evaluation set, the training data generation pipeline, and the full specification. The goal is to give anyone training tool-calling LoRAs on consumer hardware a proven starting point — whether you are building your first agent or your fiftieth.

---

## The Deeper Claim

I want to be direct about what this project is actually arguing.

The standard way to give a language model new capabilities is to describe those capabilities in the system prompt and hope the base model is good enough to follow the instructions reliably. That approach has a ceiling. You are not teaching the model anything — you are reminding it at runtime, every time, about facts and schemas it does not fundamentally own.

The alternative is to make capability training a first-class concern. The same way Anthropic trains Claude's values into its weights rather than prompting them in at runtime — the same principle applies to tool calling. If you want a model that routes tool calls reliably, does not hallucinate argument schemas, and maintains a credential boundary under adversarial pressure, you train that into the model. You do not prompt your way to it.

Agent Core is one implementation of that principle. The schemas are inside. The vault boundary is inside. The database routing preference hierarchy is inside. The model does not need to be reminded. It knows.

That is the question I asked. This is the answer I built.

---

## Support This Work

Agent Core is an independent research project — no institution, no grant, no team. Just consumer hardware, rented GPU time, and the conviction that this approach is worth proving out.

If you find this work valuable, there are a few ways to help it reach 27B and the white paper:

- **Follow the blog** — new posts drop as each training milestone lands
- **Share this post** — the more engineers see this, the better the open-source release will be
- **Support directly** — [GoFundMe](https://www.gofundme.com) and [Patreon](https://www.patreon.com) links are in the site header — every contribution goes directly to GPU time and compute costs

The open-source release — weights, eval set, training pipeline, full spec — happens regardless. Your support just gets us there faster.

---

## Go Deeper

If you want the full technical picture — the training taxonomy, two-phase recipe, Phase 1 and Phase 2 loss curves, complete ablation tables, VRAM optimization details, and the Modelfile — the companion post has all of it:

**[Agent Core: 9 Tools Is All You Need](/posts/applied/agent-core-9-tools)**

The foundational argument, written before the training results existed:

**[Schema on the Inside: Training Tool Schemas Into Model Weights](/posts/applied/schema-on-the-inside)**

The open-source release (weights, eval set, training pipeline) will be linked here when published on HuggingFace.

---

## What You Learned

- **Database-native tool calling** means baking tool schemas into model weights through training — not injecting them at runtime through prompts. The model recalls schemas the way it recalls Python syntax: automatically, from weights, without a prompt as a crutch.
- **Two-phase fine-tuning** is the mechanism: Phase 1 burns full schemas in with repetition, Phase 2 triggers recall from a 739-character minimal prompt with no schema definitions.
- **The 3+1 database architecture** — system, agent, work, vault — gives every agent a consistent routing target structure. Fewer databases means better routing accuracy.
- **The vault boundary is trained, not prompted.** The model is taught to reference `VAULT_*` symbolic names and let the runtime inject values. The credential never enters model context.
- **Consumer hardware is sufficient.** Every result here was produced on a 12GB VRAM GPU, with $35 in data generation costs. The barrier to training competitive tool-calling LoRAs is lower than the research literature implies.
