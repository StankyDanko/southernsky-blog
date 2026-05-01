---
title: "5-Stage AI Prompt Engine: Building an Automated Newsletter System"
description: "I built a 5-stage prompt pipeline that generates, formats, and publishes AI newsletters automatically — from topic research to final HTML."
publishDate: 2026-03-29
author: j-martin
tier: applied
postType: project-walkthrough
difficulty: intermediate
estimatedMinutes: 15
prerequisites: []
category: ai-ml
tags: ["ai", "newsletters", "prompt-engineering", "n8n", "automation", "grok"]
certTracks: []
featured: false
heroImage: "/images/posts/agent-newsletters-prompt-engine.webp"
draft: false
---

## Why Should You Care?

Most "AI-generated newsletter" demos are one prompt fed to ChatGPT and a manual paste into Mailchimp. That's not a pipeline — it's a party trick. The content is generic, the formatting is inconsistent, and you're doing manual work at every stage.

What I built is different: a five-stage prompt engine where each stage has a specific job, receives structured input from the previous stage, and produces structured output for the next. The result is newsletters that are actually worth reading, published automatically to a public URL, with no human in the loop between cron trigger and live page.

Twenty seed posts are live at `southernsky.cloud/newsletters` — two per AI agent. This post walks through how the engine works.

---

## The Business Context

SouthernSky Chat hosts 90+ AI agents. Each is a specialized assistant with a curated system prompt and a domain focus: Startup Advisor, Cybersecurity Analyst, Options Flow Analyst, Documentary Researcher, and so on. Each agent has a newsletter.

The newsletter pipeline does two things: it demonstrates what each agent does (lead generation for the platform), and it's a standalone subscription product:

| Tier | Price | Cadence | Content |
|------|-------|---------|---------|
| Basic | $4.99/mo | Weekly | Top 5 insights |
| Pro | $9.99/mo | 3x/week | Full analysis + citations |
| Premium | $14.99/mo | Daily | Full analysis + agent access |

Everything from research to HTML is generated and published without manual intervention. A cron trigger in n8n kicks off the pipeline. A live URL is the output.

---

## Why 5 Stages?

The temptation with AI pipelines is to write one big prompt. "Research the top cybersecurity news this week, select the five most important stories, write a 1,000-word newsletter in the voice of a senior analyst, format it as HTML, and publish it."

That doesn't work reliably. The model is trying to do five cognitively distinct things in one forward pass: information retrieval, editorial judgment, long-form writing, formatting, and publishing logic. Quality degrades on every stage because attention is spread across all of them.

Splitting the pipeline means each model call is focused. Stage 1 is a research task. Stage 2 is an editorial task. Stage 3 is a writing task. The model excels at each because it isn't context-switching.

There's also a practical benefit: structured intermediate outputs mean you can debug individual stages. If the newsletter is good but the HTML is broken, the problem is in Stage 4 — you don't have to re-run the expensive research call.

---

## Stage 1: Topic Research

Grok powers Stage 1. The Grok API has live web access, which is non-negotiable for newsletters — you need current information, not model training data from months ago.

Each agent has a `topic_config.json` that defines its research parameters:

```json
{
  "agent_id": "cybersecurity-analyst",
  "agent_name": "Cybersecurity Analyst",
  "research_topics": [
    "CVE disclosures past 7 days",
    "ransomware incidents this week",
    "zero-day exploits in production software"
  ],
  "source_preferences": [
    "NIST NVD", "Krebs on Security",
    "Bleeping Computer", "CISA advisories"
  ],
  "recency_window": "7 days"
}
```

The Stage 1 prompt:

```
You are a research assistant for the {{agent_name}} newsletter.

Search for the most significant {{research_topics}} from the past {{recency_window}}.
Prioritize sources: {{source_preferences}}.

Return a JSON array of exactly 8 research items. Each item must match this schema:
{
  "title": "string (max 80 chars)",
  "summary": "string (2-3 sentences, factual, no editorializing)",
  "source_url": "string (direct article URL)",
  "source_name": "string",
  "published_date": "ISO 8601",
  "relevance_score": number between 1 and 10,
  "category": "string"
}

Return ONLY the JSON array. No preamble. No closing commentary.
```

The `Return ONLY the JSON array` instruction is load-bearing. Without it, Grok (and every other LLM) will prefix the JSON with "Here are the 8 research items:" and append a summary paragraph. Those strings break `JSON.parse`. After adding explicit structured output instructions, parse failures dropped from ~35% to under 5%.

The remaining failures get caught by a retry wrapper that strips everything before the first `[` and after the last `]`:

```js
function safeParseJsonArray(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]") + 1;
    if (start === -1 || end === 0) throw new Error("No JSON array found in response");
    return JSON.parse(raw.slice(start, end));
  }
}
```

---

## Stage 2: Editorial Selection

Stage 2 receives the 8 research items and does two things: selects the 5 strongest stories and finds the narrative thread connecting them.

```
You are the editor of {{agent_name}}.

Research items (JSON array):
{{stage1_output}}

Your task:
1. Select the 5 most newsworthy items
2. Rank them by narrative impact (lead story first)
3. Identify one unifying theme across all 5
4. Write a 2-sentence "this week in context" frame for that theme
5. Write one sentence describing the narrative arc across all 5 stories

Return JSON only:
{
  "theme": "string (3-6 words)",
  "framing": "string (exactly 2 sentences)",
  "narrative_arc": "string (exactly 1 sentence)",
  "selected_indices": [array of 5 integers referencing stage1 items],
  "lead_index": integer
}
```

The `narrative_arc` field is the insight that changed the output quality the most. Early versions without it produced five isolated summaries that read like a listicle. The narrative arc forces the model to find the thread connecting the stories — and that thread becomes the newsletter's editorial voice.

---

## Stage 3: Content Drafting

The longest and most important stage. Stage 3 receives the outline and the full text of the 5 selected stories.

```
You are {{agent_name}}, writing this week's newsletter.

Context:
- Theme: {{theme}}
- Opening frame: {{framing}}
- Narrative arc: {{narrative_arc}}

Stories (in publication order):
{{selected_stories_with_full_research}}

Write the full newsletter body:
- Opening: 3-4 sentences setting the theme and why it matters right now
- Each story: 150-200 words. Lead with the implication, not the fact.
- Citations: inline as [Source Name](url) after each story section
- Closing: 2-3 sentences returning to the narrative arc, setting up next week
- Total length: 800-1,000 words
- Voice: {{agent_tone}} — see agent profile below

Banned phrases: "dive in", "let's explore", "it's worth noting",
"in conclusion", "takeaway", "as we can see", "at the end of the day"

Write plain text only. No HTML. No subject line.

Agent profile:
{{agent_system_prompt}}
```

The banned phrases list grew from real output analysis. "Dive in" appeared in 71% of early drafts. The list is now 14 phrases long. Every item on it came from actual published output that read badly.

"Lead with the implication, not the fact" is the most impactful single instruction in the pipeline. Without it:

> A critical vulnerability was discovered in Apache HTTP Server this week.

With it:

> Every Apache server running in production is potentially serving attacker-controlled content right now — and most teams won't find out until they check their logs after the breach.

Same information, completely different utility.

---

## Stage 4: HTML Formatting

Stage 3 produces clean prose. Stage 4 is not a model call — it's a template engine. The content is deterministic at this point; no AI judgment is needed for formatting.

```js
// stage4.mjs
import { readFileSync, writeFileSync } from "fs";
import { marked } from "marked";

const TEMPLATE = readFileSync("./templates/newsletter.html", "utf8");

export function formatNewsletter({ agentId, agentName, theme, body, issueNumber, date }) {
  const htmlBody = marked.parse(body); // convert markdown links, bold, etc.

  return TEMPLATE
    .replaceAll("{{AGENT_ID}}", agentId)
    .replaceAll("{{AGENT_NAME}}", agentName)
    .replaceAll("{{THEME}}", theme)
    .replaceAll("{{BODY}}", htmlBody)
    .replaceAll("{{ISSUE}}", issueNumber)
    .replaceAll("{{DATE}}", new Date(date).toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric"
    }));
}
```

The HTML template uses inline styles throughout. In 2026, Outlook still strips external stylesheets. Inline styles are not optional if you're sending to email clients — and even for web-only newsletters, they make the HTML self-contained without a stylesheet dependency.

Key template decisions:
- Max-width 600px centered for universal readability
- `font-family: Georgia, serif` for body text — newsletters read better in serif
- SouthernSky brand colors: `#0f172a` (slate-950) background, `#3b82f6` (blue-500) accents, `#f8fafc` text

---

## Stage 5: Publish

```js
// stage5.mjs
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export async function publish({ agentId, issueNumber, html, theme, wordCount }) {
  // Write static HTML file
  const dir = `./dist/newsletters/${agentId}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `issue-${issueNumber}.html`), html, "utf8");
  writeFileSync(join(dir, "latest.html"), html, "utf8"); // always points to current

  // Record in Supabase for the index page
  await supabase.from("newsletter_issues").insert({
    agent_id:     agentId,
    issue_number: issueNumber,
    theme,
    word_count:   wordCount,
    published_at: new Date().toISOString(),
    url:          `/newsletters/${agentId}/issue-${issueNumber}`,
  });

  console.log(`Published: /newsletters/${agentId}/issue-${issueNumber}`);
}
```

Static HTML files are served by Caddy at `southernsky.cloud/newsletters/`. The Caddy route:

```caddy
route /newsletters/* {
  root * /var/www/southernsky
  try_files {path} {path}.html /newsletters/index.html
  file_server
}
```

The `try_files` directive handles both `/newsletters/cybersecurity-analyst/issue-12` (resolves to `issue-12.html`) and `/newsletters/cybersecurity-analyst/latest` (resolves to `latest.html`). No server-side rendering needed — static files all the way down.

---

## n8n Automation

The pipeline runs inside n8n on a per-agent cron schedule. Staggered start times prevent simultaneous API calls from all 20 active newsletters at once.

n8n workflow structure:

```
Cron Trigger (agent-specific schedule)
  |
  +--> HTTP Request: Grok API (Stage 1 research)
  |
  +--> Code Node: parse Stage 1 JSON, build Stage 2 prompt
  |
  +--> HTTP Request: Grok API (Stage 2 editorial)
  |
  +--> Code Node: parse Stage 2, select stories, build Stage 3 prompt
  |
  +--> HTTP Request: Grok API (Stage 3 draft)
  |
  +--> Code Node: Stage 4 HTML formatting (template injection)
  |
  +--> HTTP Request: internal publish endpoint (Stage 5)
  |
  +--> Slack: success/failure notification
```

The n8n Code node constraint: no `fetch`, no `require`. All HTTP inside Code nodes goes through `this.helpers.httpRequest()`. Using `fetch` causes a silent failure — the request never fires, the workflow hangs at that node, and nothing in the logs tells you why.

```js
// Correct — inside n8n Code node
const response = await this.helpers.httpRequest({
  method: "POST",
  url: "https://api.x.ai/v1/chat/completions",
  headers: {
    "Authorization": `Bearer ${$env.GROK_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: {
    model: "grok-3",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  },
  json: true,
});
```

The `response_format: { type: "json_object" }` parameter activates constrained decoding in Grok (same as OpenAI's JSON mode). Combined with explicit format instructions in the prompt, this reduces parse failures to near zero.

---

## What You Learned

- **Staged pipelines beat monolithic prompts**: research, editorial selection, long-form writing, and HTML formatting are distinct cognitive tasks — doing them in separate model calls produces better output than one mega-prompt
- **Structured output instructions are mandatory**: `Return ONLY the JSON array` + `response_format: { type: "json_object" }` together cut parse failures from 35% to under 5%
- **"Lead with the implication, not the fact"** is the single instruction most responsible for the difference between AI-generated content and useful journalism
- **n8n Code nodes block `fetch` and `require`**: use `this.helpers.httpRequest()` for all HTTP inside workflows — the failure is silent and nothing in the logs reveals the cause
- **Inline CSS is still mandatory for email-compatible HTML** in 2026: Outlook strips external stylesheets, so the template carries all styling as inline `style=` attributes
