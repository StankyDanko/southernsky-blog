---
title: "How AI Chatbots Actually Work (No Math Required)"
description: "You've talked to ChatGPT. But what's actually happening under the hood? Here's how AI language models work — explained without a single equation."
publishDate: 2026-05-01
author: j-martin
tier: foundations
postType: explainer
difficulty: beginner
estimatedMinutes: 10
prerequisites: []
category: ai-ml
tags: ["ai", "llm", "chatgpt", "machine-learning"]
heroImage: "/images/posts/how-ai-chatbots-work.webp"
featured: false
draft: false
---

## Why Should You Care?

You've talked to ChatGPT or Siri. But what's actually happening when you type a question and get an answer?

Most people treat AI chatbots like magic — you put words in, words come out, and somewhere in between a mysterious intelligence does something unknowable. That's understandable. The companies that build these tools aren't exactly rushing to explain how they work. They'd rather you think it's magic.

It's not. And once you understand the core mechanics, you'll be better at using these tools, better at spotting their weaknesses, and better at seeing through the hype. No math required. No PhD prerequisite. Just the fundamental ideas, explained the way I wish someone had explained them to me.

## Your Phone Already Does This

Open the text messaging app on your phone. Start typing a message. Notice those three little word suggestions above the keyboard? Tap one, and a new set of suggestions appears. Tap the next, and another set. You can write an entire sentence by just tapping suggestions.

That right there is the core idea behind every AI chatbot in existence.

Your phone's keyboard has a tiny language model. It looks at what you've typed so far and predicts what word you're most likely to type next. If you type "I'll be there," it might suggest "soon," "tomorrow," or "in." Not because it understands the meaning of your plans — because it has seen millions of text messages where people typed those words after "I'll be there."

ChatGPT, Claude, Gemini, Grok — they all work on the same fundamental principle. They predict the next most likely word. They just do it at a vastly larger scale, with vastly more training data, and with enough nuance that the predictions feel like understanding.

That's the entire secret. Everything else is details.

## Step 1: Your Text Becomes Tokens

When you type a message like "What's the capital of France?", the chatbot doesn't see words the way you do. The first thing that happens is **tokenization** — your text gets broken into smaller pieces called tokens.

Tokens aren't always whole words. Common words like "the" or "is" are usually one token. Longer or rarer words get split. "Understanding" might become "under" + "standing." The word "tokenization" itself might become "token" + "ization."

Why split words? Because the model needs a fixed vocabulary — a list of every piece it knows. You can't have a separate entry for every possible word in every language, including typos, slang, and technical jargon. Instead, you have a vocabulary of maybe 32,000 to 100,000 pieces that can combine to represent any text.

Here's roughly what tokenization looks like:

```
Input:   "What's the capital of France?"

Tokens:  ["What", "'s", " the", " capital", " of", " France", "?"]
```

Each token maps to a number — its position in the vocabulary. The model works entirely with these numbers internally. "What" might be token 1327. "France" might be token 8891. The model never sees letters or words. It sees sequences of numbers.

This is why AI models sometimes struggle with tasks that seem simple to us. Ask one to count the letters in "strawberry" and it might get it wrong — because it never saw individual letters. It saw tokens, and "strawberry" might be a single token or two tokens, neither of which reveals the letter-by-letter structure.

## Step 2: The Model — A Pattern-Matching Engine

Here's where the actual "AI" lives. The model is a massive mathematical structure — called a neural network — that has been trained to recognize patterns in language. I promised no math, so think of it this way:

Imagine you read every book, article, webpage, and forum post ever written in English. After a while, you'd develop incredibly strong intuitions about language. You'd know that "the capital of France is" almost certainly ends with "Paris." You'd know that formal writing uses different patterns than casual texts. You'd know that a question usually gets answered in a certain structure.

That's essentially what a language model has done, except it processed trillions of words and encoded those patterns into billions of numerical weights — adjustable dials that collectively represent "how language works."

The common shorthand is **large language model**, or LLM. "Large" refers to the number of those internal weights. A small model might have 3 billion weights (parameters). A medium one, 14 billion. A large one, 70 billion or more. More parameters generally means the model can capture more nuanced patterns — but also means it needs more computing power to run.

I run 69 models locally on my workstation. They range from 2 billion parameters up to 70 billion. The smaller ones answer in under a second. The largest one takes a few seconds per response but captures deeper reasoning patterns. All of them run on my own hardware — no internet connection needed, no cloud subscription, no data leaving my machine.

## Step 3: Prediction — One Word at a Time

Here's the part that surprises most people. When you ask a chatbot "What's the capital of France?", it doesn't retrieve the answer from a database. It doesn't look anything up. It generates the response **one token at a time**, each time asking: "Given everything so far, what's the most likely next token?"

The process looks like this:

```
Input:   "What's the capital of France?"
Step 1:  Model sees the input → predicts "The"
Step 2:  Model sees input + "The" → predicts " capital"
Step 3:  Model sees input + "The capital" → predicts " of"
Step 4:  Model sees input + "The capital of" → predicts " France"
Step 5:  Model sees input + "The capital of France" → predicts " is"
Step 6:  Model sees input + "The capital of France is" → predicts " Paris"
Step 7:  Model sees input + "The capital of France is Paris" → predicts "."
Step 8:  Model predicts [STOP]
```

Each step, the model looks at the entire conversation so far and calculates probability scores for every token in its vocabulary. "Paris" gets a very high probability after "The capital of France is." "Banana" gets a very low one. The model picks from the top candidates and moves on to the next token.

This is why chatbot responses appear word by word when you watch them stream in. That's not a visual effect — that's literally how the model works. Each word appears as it's generated.

## The Context Window: How Much the Model Can See

Remember how each prediction step requires looking at "everything so far"? There's a limit to how much "everything" the model can hold in its working memory at once. This is called the **context window**.

Think of it like a desk. You can spread out a certain number of papers before the desk is full. A model with a 4,000-token context window can see about 3,000 words of conversation at once. A model with a 128,000-token context window can see roughly 100,000 words — an entire novel.

```
Small context window:     [........]           ~3,000 words
Medium context window:    [................]    ~16,000 words
Large context window:     [...............................]  ~100,000 words
```

This is why chatbots sometimes "forget" things you said earlier in a long conversation. If your conversation exceeds the context window, the oldest messages fall off the edge of the desk. The model literally can't see them anymore.

It also explains why you sometimes get better results by repeating important instructions. Putting key information closer to the end of the conversation keeps it near the top of the model's attention.

## Temperature: The Creativity Dial

When the model predicts the next token, it doesn't always pick the single most likely option. There's a setting called **temperature** that controls how adventurous the model gets.

- **Temperature 0** (or close to it): The model almost always picks the highest-probability token. Responses are predictable, consistent, and dry. Good for factual answers, code, and structured data.
- **Temperature 0.7**: The model sometimes picks less likely tokens. Responses have more variety, more creativity, more personality. Good for writing, brainstorming, and conversation.
- **Temperature 1.0+**: The model frequently picks lower-probability tokens. Responses get wild, unpredictable, and sometimes incoherent. Good for creative writing experiments. Bad for anything requiring accuracy.

Here's a concrete example. Given the prompt "The sunset painted the sky," different temperatures produce different continuations:

```
Temperature 0.0:  "in shades of orange and pink."
Temperature 0.5:  "like a watercolor left out in the rain."
Temperature 1.0:  "with the reckless abandon of a jazz drummer."
```

All three are valid English. The first is safe and predictable. The second is evocative. The third is unexpected — maybe brilliant, maybe too much. Temperature is the dial that moves between these modes.

When I run models locally, I choose the temperature based on the task. Code generation gets temperature 0.1 for maximum predictability. Creative brainstorming gets 0.7 or higher. It's the same model either way — the temperature just changes how it samples from its own predictions.

## Prompts vs. System Prompts

Everything you type to a chatbot is a **prompt**. But there's a second layer most people never see: the **system prompt**.

A system prompt is a set of instructions that gets injected before your conversation. It defines the chatbot's personality, constraints, and behavior. When you use ChatGPT, there's a system prompt you never see that says things like "You are ChatGPT, a helpful assistant made by OpenAI. Be concise. Decline harmful requests."

Here's the structure of what the model actually sees when you send a message:

```
[System Prompt]
You are a helpful astronomy tutor. Explain concepts using
analogies from everyday life. Keep responses under 200 words.

[User]
Why do stars twinkle?

[Assistant]
Stars twinkle because their light passes through Earth's
atmosphere, which is full of moving air at different
temperatures...
```

The system prompt is why different AI products feel different even when they use the same underlying model. ChatGPT feels different from Claude feels different from Gemini — partly because the models are genuinely different, but partly because each has different system prompt engineering.

I run 90+ specialized AI agents at [chat.southernsky.cloud](https://chat.southernsky.cloud). Each agent is the same underlying model, but with a different system prompt. A Portfolio Strategist agent has a system prompt about financial analysis. A Sleep Coach agent has a system prompt about circadian rhythms and sleep hygiene. Same engine, different instructions. The system prompt is what makes each one useful for a specific domain.

This is something you can do yourself. Many chatbots let you set custom instructions. Those custom instructions become part of the system prompt. Want the chatbot to always explain things like you're 15? Put that in the custom instructions. Want it to always respond in bullet points? Same thing. You're programming the system prompt.

## Why Chatbots "Hallucinate"

This is maybe the most important thing to understand about AI chatbots: **they don't know facts. They predict likely words.**

When a model says "The capital of France is Paris," it's not retrieving a fact from memory. It's recognizing that in the trillions of words it was trained on, the token "Paris" overwhelmingly follows the phrase "the capital of France is." The model is right not because it knows geography, but because the pattern is so strong that the prediction is almost always correct.

But what happens when the pattern isn't strong? What happens when you ask about something obscure, or something that has conflicting information online, or something the model's training data didn't cover well?

The model does the same thing it always does: it predicts the most likely next token. And the most likely next token might be confidently wrong. The model doesn't have a "I don't know" signal — at least not naturally. It will generate a plausible-sounding answer because plausible-sounding answers are what it was trained to produce.

This is called **hallucination**, and it's the fundamental limitation of how these models work. A few examples:

- Ask for a citation, and the model might generate a real-looking author name, journal title, and year — but the paper doesn't exist. The tokens just fit the pattern of what a citation looks like.
- Ask about a niche topic, and the model might blend accurate information with plausible-sounding fabrications, and you can't tell which is which without checking.
- Ask a factual question with a subtle error in the premise ("What year did Einstein win the Nobel Prize for relativity?"), and the model might play along with the false premise rather than correct it. Einstein won the Nobel Prize for the photoelectric effect, not relativity.

This isn't a bug that will be fixed in the next version. It's a structural consequence of how prediction-based language models work. The model doesn't distinguish between "tokens that represent true facts" and "tokens that represent plausible-sounding fiction." It just knows what's likely to come next.

The practical implication: never trust a chatbot's output as fact without verification. Use it to draft, brainstorm, explain concepts, and generate ideas. Verify claims independently. The model is a powerful thinking partner, not an oracle.

## What These Models Are NOT

It's worth being explicit about what these models don't do, because the marketing often implies otherwise:

**They don't understand.** When a model generates a thoughtful response to a personal question, it's not empathizing with you. It's predicting tokens that match the pattern of empathetic responses in its training data. The output can still be genuinely useful — but the mechanism is pattern matching, not comprehension.

**They don't remember between conversations.** Each conversation starts fresh. The model doesn't remember what you discussed yesterday (unless the platform saves your history and feeds it back in as context). There's no persistent memory by default — just the context window of the current session.

**They don't search the internet** (by default). A base language model is frozen in time at its training cutoff date. If you ask about something that happened after training, it either doesn't know or predicts based on outdated patterns. Some chatbot products add web search as a separate feature, but that's the product wrapping — not the model itself.

**They don't reason the way you do.** When a model works through a math problem step by step, it's generating tokens that look like reasoning. Sometimes this produces correct results, especially for well-represented problem types. Sometimes it generates confident, step-by-step nonsense that looks rigorous but arrives at a wrong answer. The form of reasoning isn't the same as the substance.

## The Spectrum: Small to Large

Not all models are created equal. The "large" in Large Language Model is relative, and the spectrum matters:

```
Model Size    Parameters    Typical Use Case
──────────    ──────────    ────────────────
Tiny          1-3B          Simple tasks, autocomplete, edge devices
Small         7-8B          General conversation, summarization
Medium        14-27B        Nuanced writing, analysis, coding
Large         70B+          Complex reasoning, professional tasks
Frontier      200B+         State-of-the-art research, commercial APIs
```

I can run models from 1B up to 70B on my workstation. A 3B model fits comfortably in 4GB of GPU memory and responds almost instantly. A 70B model requires 40GB+ and runs slower, but captures richer patterns. For most everyday tasks — answering questions, writing drafts, explaining concepts — a 7B to 14B model is the sweet spot. You only need the larger models when the task demands nuanced reasoning or specialized knowledge.

The models you interact with through ChatGPT, Claude, or Gemini are at the frontier end — hundreds of billions of parameters running on massive GPU clusters. The models I run locally are smaller but still remarkably capable. And because they run on my own machine, I can use them without an internet connection, without a subscription, and without my data ever leaving my desk.

## Tying It All Together

Let's walk through the complete pipeline one more time, end to end.

You type: "Explain photosynthesis simply."

1. **Tokenization.** Your text is split into tokens: `["Explain", " photo", "synthesis", " simply", "."]`

2. **Context assembly.** The system prompt (if any) plus your message form the full context that the model will process.

3. **Prediction begins.** The model processes the token sequence through its neural network — billions of weights encoding patterns from trillions of words of training data — and calculates probability scores for every possible next token.

4. **Token selection.** Based on the temperature setting, the model selects from the highest-probability candidates. Maybe it picks "Photo" as the first output token.

5. **Repeat.** The selected token gets appended to the context. The model runs again with this slightly longer input. It picks the next token. And the next. And the next. Each one influenced by everything that came before it.

6. **Stop.** When the model predicts a stop token, generation ends. The accumulated tokens get decoded back into text and displayed as the response.

That's it. Tokenize the input, predict one token at a time, decode the output. The magic is in the scale — billions of parameters trained on trillions of words, making predictions sophisticated enough to feel like conversation.

## What You Learned

- AI chatbots work on the same principle as your phone's autocomplete: predicting the next most likely word, just at a massively larger scale
- Text is broken into **tokens** (word pieces) before the model processes it — which is why models can struggle with tasks that require seeing individual letters or characters
- The model is a **pattern-matching engine** trained on trillions of words, not a database of facts
- Responses are generated **one token at a time**, each prediction informed by everything that came before
- The **context window** limits how much of the conversation the model can see at once — longer conversations may lose earlier context
- **Temperature** controls randomness: low temperature for predictable, factual outputs; high temperature for creative, varied outputs
- **System prompts** are hidden instructions that shape the chatbot's personality and behavior — you can influence them through custom instructions
- Models **hallucinate** because they predict likely-sounding tokens, not verified facts — always verify important claims independently
- Models range from 3 billion to 200+ billion parameters; bigger generally means more capable but requires more hardware
- You can run capable AI models locally on your own machine with no cloud dependency — I run 69 of them on a single workstation

Next time a chatbot gives you a confident answer, you'll know what's actually happening: a pattern-matching engine is predicting the most likely next word, one token at a time. That's not a reason to stop using these tools. It's a reason to use them better.
