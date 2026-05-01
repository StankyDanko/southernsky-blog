---
title: "How I Deployed 90+ AI Agents with Zero Repetitive Clicking"
description: "I built 90+ specialized AI agents on Open WebUI. A bash script handles auth, knowledge upload, profile image, and model creation — no manual UI work."
publishDate: 2026-03-29
author: j-martin
tier: applied
postType: project-walkthrough
difficulty: intermediate
estimatedMinutes: 18
prerequisites: []
category: ai-ml
tags: ["open-webui", "ai-agents", "automation", "bash", "api"]
certTracks: []
featured: true
heroImage: "/images/posts/deploying-90-ai-agents.webp"
draft: false
---

## Why Should You Care?

Open WebUI lets you build custom AI agents with system prompts, knowledge bases, and profile images. The problem: every agent takes 8–12 clicks to configure manually. At agent #3 you start making mistakes. At agent #10 you start hating yourself.

I needed 90+ agents across six categories — Technology, Finance, Creative, Wellness, Education, and Mentalism. That meant a repeatable, scriptable pipeline. Here's the one I built.

## The 90+ Agent Categories

Before touching code, I mapped out the agent portfolio:

| Category | Count | Examples |
|----------|-------|---------|
| Technology | 18 | DevOps Advisor, Security Analyst, Cloud Architect |
| Finance | 16 | Portfolio Strategist, Tax Navigator, Options Analyst |
| Creative | 14 | Screenwriter, Brand Voice, Music Composer |
| Wellness | 12 | Sleep Coach, Nutrition Guide, Mental Clarity |
| Education | 15 | Socratic Tutor, Language Partner, Research Librarian |
| Mentalism | 12 | Pattern Recognition, Cognitive Reframe, Dream Analyst |

Each agent needs: a system prompt, a profile image, optionally a knowledge base. Doing this through the UI is a maintenance trap — changes require re-clicking everything. A script means the definition lives in version control.

## The Pipeline: `deploy-agent.sh`

The script runs 6 steps in sequence. Let's walk through each one.

### Step 1: Get an Auth Token

Open WebUI exposes a REST API, but every endpoint requires a Bearer token. The first thing the script does is exchange credentials for a session token:

```bash
#!/usr/bin/env bash
set -euo pipefail

OWUI_URL="${OWUI_URL:-https://chat.southernsky.cloud}"
OWUI_USER="${OWUI_USER}"
OWUI_PASS="${OWUI_PASS}"

get_token() {
  curl -s -X POST "${OWUI_URL}/api/v1/auths/signin" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${OWUI_USER}\",\"password\":\"${OWUI_PASS}\"}" \
    | jq -r '.token'
}

TOKEN=$(get_token)
echo "Auth OK: ${TOKEN:0:20}..."
```

```
Auth OK: eyJhbGciOiJIUzI1Ni...
```

One gotcha: the API has a rate limit around 15 requests per minute on the auth endpoint. If you're deploying a batch, reuse the token. The script exports `TOKEN` to the environment and all subsequent functions inherit it rather than re-authenticating.

### Step 2: Upload Knowledge Base Files

Some agents get domain-specific knowledge — a finance agent gets market structure docs, a security agent gets CVE categorization guides. Knowledge files are uploaded individually first:

```bash
upload_knowledge_file() {
  local file_path="$1"
  local filename
  filename=$(basename "$file_path")

  curl -s -X POST "${OWUI_URL}/api/v1/files/" \
    -H "Authorization: Bearer ${TOKEN}" \
    -F "file=@${file_path};type=text/plain" \
    | jq -r '.id'
}

FILE_ID=$(upload_knowledge_file "./knowledge/finance-market-structure.txt")
echo "Uploaded file: ${FILE_ID}"
```

```
Uploaded file: f_8a3d1c9e2b4f
```

The upload returns a file ID. You collect these IDs into an array before creating the knowledge collection.

### Step 3: Create a Knowledge Collection

Individual files get grouped into a named collection. The collection ID is what you attach to the agent:

```bash
create_knowledge_collection() {
  local name="$1"
  local description="$2"
  shift 2
  local file_ids=("$@")

  # Build the file_ids JSON array
  local ids_json
  ids_json=$(printf '%s\n' "${file_ids[@]}" | jq -R . | jq -s .)

  curl -s -X POST "${OWUI_URL}/api/v1/knowledge/" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{
      \"name\": \"${name}\",
      \"description\": \"${description}\",
      \"file_ids\": ${ids_json}
    }" | jq -r '.id'
}

COLLECTION_ID=$(create_knowledge_collection \
  "Finance Core" \
  "Market structure, options theory, portfolio management" \
  "$FILE_ID")
echo "Collection: ${COLLECTION_ID}"
```

```
Collection: k_7f2e9a1d5c8b
```

Agents without knowledge bases skip steps 2 and 3 entirely — the collection field in the final payload is just left empty.

### Step 4: Build the Profile Image

This is where most tutorials stop, because profile images are non-trivial. Open WebUI stores them as base64-encoded WebP in a SQLite column. If you try to upload a 1024x1024 PNG, you will crater the database performance — the base64 alone is ~1.4MB, and Open WebUI loads it on every workspace render.

The correct pipeline:

```bash
prepare_profile_image() {
  local source_png="$1"
  local output_webp="/tmp/agent_profile_$$.webp"

  # Resize to 256x256, convert to WebP
  convert "${source_png}" \
    -resize 256x256^ \
    -gravity center \
    -extent 256x256 \
    -quality 85 \
    "${output_webp}"

  # Base64 encode (no line breaks)
  base64 -w 0 "${output_webp}"
}

PROFILE_B64=$(prepare_profile_image "./images/portfolio-strategist.png")
echo "Image encoded: ${#PROFILE_B64} bytes"
```

```
Image encoded: 28432 bytes
```

28KB base64 vs 1.4MB — that's the difference between a responsive UI and one that lags on every page load. The images were generated first with Imagen 4.0 at 1024x1024, then batch-resized through this pipeline.

### Step 5: POST to Create the Model

Now everything comes together. The agent definition is a JSON payload that includes the system prompt, the knowledge collection ID, and the base64 profile image:

```bash
create_agent() {
  local agent_id="$1"
  local agent_name="$2"
  local system_prompt="$3"
  local profile_b64="$4"
  local collection_id="${5:-}"

  # Build knowledge array conditionally
  local knowledge_json="[]"
  if [[ -n "$collection_id" ]]; then
    knowledge_json="[{\"type\":\"collection\",\"id\":\"${collection_id}\"}]"
  fi

  curl -s -X POST "${OWUI_URL}/api/v1/models/create" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{
      \"id\": \"${agent_id}\",
      \"name\": \"${agent_name}\",
      \"base_model_id\": \"grok-3\",
      \"params\": {
        \"system\": \"${system_prompt}\"
      },
      \"meta\": {
        \"profile_image_url\": \"data:image/webp;base64,${profile_b64}\",
        \"knowledge\": ${knowledge_json},
        \"suggestion_prompts\": []
      }
    }" | jq -r '.id'
}

CREATED_ID=$(create_agent \
  "portfolio-strategist" \
  "Portfolio Strategist" \
  "You are a CFA-level portfolio analyst..." \
  "$PROFILE_B64" \
  "$COLLECTION_ID")
echo "Created: ${CREATED_ID}"
```

```
Created: portfolio-strategist
```

One critical detail: the `id` field is alphanumeric plus underscores only. No hyphens. Open WebUI silently rejects hyphens in model IDs, and the failure mode is confusing — the API returns 200 but the agent never appears. The script validates IDs before sending:

```bash
validate_agent_id() {
  local id="$1"
  if [[ ! "$id" =~ ^[a-z0-9_]+$ ]]; then
    echo "ERROR: Agent ID '${id}' contains invalid characters" >&2
    exit 1
  fi
}
```

### Step 6: Cleanup Temp Files

The script creates temporary WebP files during image encoding. Always clean up:

```bash
cleanup() {
  rm -f /tmp/agent_profile_$$.webp
  echo "Cleanup complete"
}
trap cleanup EXIT
```

The `trap` on `EXIT` runs cleanup regardless of whether the script succeeds or fails. This matters when you're running batch deploys — a crash halfway through shouldn't leave 40 temp files sitting around.

## Running a Full Batch Deploy

With the functions defined, deploying a batch looks like this:

```bash
#!/usr/bin/env bash
# deploy-batch.sh — deploy all agents in agents.json

TOKEN=$(get_token)
export TOKEN

jq -c '.[]' agents.json | while read -r agent; do
  ID=$(echo "$agent" | jq -r '.id')
  NAME=$(echo "$agent" | jq -r '.name')
  PROMPT=$(echo "$agent" | jq -r '.system_prompt')
  IMAGE=$(echo "$agent" | jq -r '.image')

  echo "Deploying: ${NAME}..."
  PROFILE_B64=$(prepare_profile_image "./images/${IMAGE}")
  create_agent "$ID" "$NAME" "$PROMPT" "$PROFILE_B64"
  echo "  OK"

  # Respect rate limit
  sleep 5
done
```

The `sleep 5` between creates isn't optional — OWUI rate-limits the model create endpoint too. Without it, you'll start getting 429s around agent #15.

Full batch output for one category:

```
Deploying: Portfolio Strategist...
  OK
Deploying: Options Analyst...
  OK
Deploying: Tax Navigator...
  OK
Deploying: Retirement Planner...
  OK
[...12 more agents...]
Finance category complete: 16 agents deployed
```

## The Grok API Backend

One important architectural note: these agents run on Grok (xAI's API), not local Ollama. The `base_model_id` in the payload is `grok-3`, which OWUI routes through its Grok API connection.

This was a deliberate choice. Local Ollama models are fast and free, but for a multi-user platform serving real customers, you want the reliability and reasoning quality of a hosted API. The agents handle finance analysis, legal concepts, and medical information — domains where a smaller local model's hallucinations are genuinely risky.

The tradeoff: Grok API usage costs real money. The system prompt engineering is where you control this. Tight, focused prompts that guide the model to answer concisely keep token consumption down.

## Updating an Existing Agent

When you need to update a system prompt, you don't recreate — you PATCH:

```bash
update_agent_prompt() {
  local agent_id="$1"
  local new_prompt="$2"

  # First fetch current metadata so we don't wipe other fields
  local current
  current=$(curl -s "${OWUI_URL}/api/v1/models/${agent_id}" \
    -H "Authorization: Bearer ${TOKEN}")

  local current_meta
  current_meta=$(echo "$current" | jq '.meta')

  curl -s -X POST "${OWUI_URL}/api/v1/models/${agent_id}/update" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{
      \"params\": {\"system\": \"${new_prompt}\"},
      \"meta\": ${current_meta}
    }"
}
```

The fetch-before-update pattern is critical. The OWUI update API merges only top-level keys, not nested ones. If you send `meta: { profile_image_url: ... }` without including `knowledge` and `suggestion_prompts`, those fields get silently wiped. Always fetch the current state, modify what you need, and send the full object back.

## What You Learned

- Open WebUI's REST API covers the full agent lifecycle: auth, file upload, knowledge collection, model creation, and update
- Profile images must be 256x256 WebP before base64 encoding — larger images cause UI performance degradation
- Model IDs must be alphanumeric + underscores only; hyphens are silently rejected
- Rate limits on both auth (~15/min) and create endpoints require explicit delays in batch scripts
- Fetch-before-update is mandatory on OWUI's model update endpoint to avoid silently wiping nested metadata fields
