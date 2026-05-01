---
title: "Credential Bridging: How AI Agents Access Secrets Safely"
description: "AI agents need API keys to work. But handing over your .env file is a security nightmare. Here's how I built a zero-knowledge credential bridge."
publishDate: 2026-05-01
author: j-martin
tier: professional
postType: project-walkthrough
difficulty: advanced
estimatedMinutes: 16
prerequisites: ["encryption-basics", "api-basics"]
category: cybersecurity
tags: ["security", "credentials", "ai-agents", "encryption", "vault"]
heroImage: "/images/posts/credential-bridging.webp"
featured: false
draft: false
---

## Why Should You Care?

AI coding agents need API keys. But giving an AI agent your `.env` file is like handing your house keys to a stranger. You're trusting that they'll only go to the kitchen, that they won't copy the keys, and that they'll forget your address afterward. None of those things are guaranteed.

This isn't a hypothetical concern. GitGuardian's 2023 State of Secrets Sprawl report found 12.7 million hard-coded secrets across public GitHub commits. Many of those started life in `.env` files that were pasted into agent prompts, accidentally committed, or left unencrypted on disk. The AI agent wave is making this exponentially worse. Every time a coding agent needs to run `sudo`, call an API, or SSH into a server, it needs a credential. The current workarounds are all terrible: plaintext files, pasting secrets into chat windows, disabling authentication entirely, or just telling the agent "skip that step" and doing it yourself.

I ran into this problem firsthand. I was deep in a session with Claude Code, configuring firewall rules on my development workstation, and every `sudo` command required me to manually type my password. The agent couldn't do it. It broke the flow completely. Twenty minutes of work that should have taken two.

So I built something about it. First a bash script. Then a full credential management system. This post walks through the architecture of a zero-knowledge credential bridge — a tool that lets AI agents execute privileged operations without ever seeing, storing, or transmitting the actual secrets.

---

## The Problem Is Worse Than You Think

Let's map out the threat model. When you give an AI coding agent access to your secrets, several things can go wrong:

**Secrets in the context window.** LLMs process text. If you paste an API key into a prompt, it becomes part of the model's input context. Depending on the provider's data retention policy, that key might be logged, cached, or used for training. Even with providers who don't train on your data, the key existed in plaintext on a remote server for the duration of that request.

**Unrestricted scope.** A typical `.env` file is a flat list. There's no concept of "this agent can use `GROK_API_KEY` but not `DATABASE_URL`." When you source a `.env` file, every secret in it becomes available to every process in that shell. An agent that needs one API key gets access to your database credentials, your SSH keys, your payment processor tokens, and whatever else is in the file.

**No audit trail.** When something goes wrong — a key is rotated and you need to know what used it, or an unexpected charge appears on an API bill — there's no record of which process accessed which secret, when, or in what context. You're debugging in the dark.

**Credential persistence.** AI agents that maintain conversation history might retain secrets across sessions. A key you pasted in Tuesday's session could still be in the context window on Thursday. Some agent frameworks cache tool outputs. Some write logs. The blast radius of a leaked secret grows over time in ways that are hard to predict.

**The compounding problem.** As AI agents become more capable, they need more credentials. My own development environment bridges to nine different APIs, plus sudo, SSH access to three machines, and database connections. That's not unusual for a solo developer running a modern stack. Each credential is a separate attack surface, and `.env` files treat them all as equally accessible.

---

## The Insight: A Bash Script That Changed Everything

The solution started with a 12-line bash script called `psudo`. Here's the concept:

```bash
#!/bin/bash
# psudo — sudo bridge for AI agents
# Sources password from encrypted store, pipes to sudo -S
# The AI agent calls this script; it never sees the password

SECRET=$(decrypt_from_vault "SUDO_PASSWORD")
echo "$SECRET" | sudo -S "$@"
# Memory zeroed after execution
```

The insight is simple but profound: **the AI agent doesn't need to know the secret. It needs to use the secret.** Those are two different things.

When Claude Code needs to run `sudo ufw allow 8900`, it doesn't need my password in its context window. It needs a command that runs with elevated privileges. The bridge provides that. The agent calls `psudo ufw allow 8900`, the script decrypts the password from a secure store, pipes it to `sudo -S` via stdin, and returns only the command's output. The password never appears in the agent's input, output, logs, or conversation history.

That 12-line script unblocked an entire class of problems. But it only handled sudo. I needed the same pattern for SSH passphrases, API keys, database passwords, and arbitrary secret injection. That's when `psudo` evolved into a full credential management system.

---

## Architecture: The Four-Layer Stack

The system generalizes the `psudo` insight into four layers. Each layer has a single responsibility, and secrets flow in only one direction — from the encrypted vault outward, never back toward the agent.

```
┌─────────────────────────────────────────────────────────┐
│                     AI Agent Layer                       │
│  Claude Code, OpenCode, Cursor, Copilot, any MCP client │
│  Knows: slot names ("SUDO_PASSWORD", "GROK_API_KEY")    │
│  Never sees: actual secret values                       │
└──────────────────────┬──────────────────────────────────┘
                       │  "exec sudo -- ufw allow 8900"
                       │  (references slot name, not value)
                       v
┌─────────────────────────────────────────────────────────┐
│                  Permission Layer                        │
│  Scope checks: Can this agent use this slot?            │
│  Policy engine: command allowlists, TTL, approval gates │
│  Caller identity: PID, parent process, agent signature  │
└──────────────────────┬──────────────────────────────────┘
                       │  Policy check passed
                       v
┌─────────────────────────────────────────────────────────┐
│                    Vault Layer                           │
│  age-encrypted local file (~/.pman/vault.age)           │
│  Argon2id key derivation from passphrase                │
│  In-memory decryption only, zeroed after use            │
│  Never writes plaintext to disk                         │
└──────────────────────┬──────────────────────────────────┘
                       │  Decrypted secret (in memory only)
                       v
┌─────────────────────────────────────────────────────────┐
│                   Bridge Layer                           │
│  Injects secret into target via stdin pipe or env var   │
│  Runs target command as subprocess                      │
│  Returns only stdout/stderr/exit code to agent          │
│  Zeroes secret from memory after injection              │
└──────────────────────┬──────────────────────────────────┘
                       │  Command output only
                       v
┌─────────────────────────────────────────────────────────┐
│                   Audit Layer                            │
│  Append-only SQLite log (~/.pman/audit.db)              │
│  Records: slot name, timestamp, command, caller, result │
│  Never records: the secret value itself                 │
└─────────────────────────────────────────────────────────┘
```

Let's walk through each layer in detail.

---

### Layer 1: The Zero-Knowledge Vault

The vault is an `age`-encrypted file stored locally at `~/.pman/vault.age`. I chose `age` over GPG for the same reasons the security community has been migrating: it's simpler, has a smaller attack surface, uses modern cryptography (X25519, ChaCha20-Poly1305), and doesn't require managing a keyring.

The encryption flow:

1. **Initialization.** `pman init` generates an age identity file, protected by a passphrase. The passphrase goes through Argon2id key derivation — the same KDF used by Bitwarden, Signal, and most modern password managers. Argon2id is memory-hard, meaning it's resistant to GPU-based brute force attacks.

2. **Storing a secret.** `pman set GROK_API_KEY` prompts interactively for the value (or imports it from an existing environment variable with `--from-env`). The value is encrypted with the vault's age identity and appended to the vault file. At no point is the plaintext value written to disk unencrypted.

3. **Decryption.** When the bridge needs a secret, it decrypts the specific slot in memory. The decrypted value exists only in the process's memory space, and only for the duration of the injection. After the subprocess exits, the memory region is explicitly zeroed using the `zeroize` crate (Rust) — not just freed, but overwritten with zeroes. This prevents the secret from lingering in freed memory where it could be recovered via a core dump or memory scanner.

```
# Vault structure on disk
~/.pman/
├── vault.age          # age-encrypted secret store (NEVER plaintext)
├── config.toml        # Slot policies, agent allowlists, settings
├── audit.db           # SQLite append-only access log
└── vault.age.bak      # Auto-backup before rotation
```

The vault file itself is opaque. You can `cat` it and you'll see binary age-encrypted data. No slot names, no hints about what's inside. The mapping between slot names and encrypted values is internal to the vault format. An attacker who exfiltrates the vault file gets nothing without the passphrase.

**Why not SOPS?** SOPS (Secrets OPerationS, created by Mozilla) is excellent for team workflows because it supports partial encryption — you can encrypt values while leaving keys visible, making diffs readable. But for a single-developer vault, `age` is simpler and has fewer dependencies. SOPS is on the roadmap as an alternative backend for teams.

---

### Layer 2: Scoped Permissions

A flat secrets store isn't enough. The permission layer controls which agents can access which secrets, under what conditions.

Scoping is defined in `config.toml`:

```toml
[slots.SUDO_PASSWORD]
scope = ["sudo"]                    # Only usable with sudo bridge commands
agents = ["claude-code", "opencode"] # Only these agents can request it
ttl = "1h"                          # Re-authentication required after 1 hour
require_approval = true             # Interactive approval prompt before use

[slots.GROK_API_KEY]
scope = ["env", "curl"]             # Can be injected as env var or in curl headers
agents = ["claude-code"]            # Only Claude Code, not other agents
ttl = "24h"
require_approval = false            # Non-destructive, auto-approve

[slots.DATABASE_URL]
scope = ["env"]                     # Env injection only, no curl/stdin
agents = []                         # No agents — human-only
ttl = "30m"
require_approval = true
```

This solves the flat-file problem. Even if an agent knows the slot name `DATABASE_URL`, the policy engine will reject the request because no agents are authorized. The SUDO_PASSWORD slot requires interactive human approval — a prompt appears in the terminal and the user explicitly confirms before the secret is decrypted.

**Agent identity** is determined by inspecting the calling process: PID, parent process name, and environment hints. Claude Code runs as a recognizable process tree. OpenCode has its own signature. This isn't cryptographic authentication (that's a stretch goal involving signed agent tokens), but it raises the bar significantly over "any process in this shell can read any env var."

The permission layer is also where the **principle of least privilege** is enforced. Each slot declares exactly which bridge commands can use it. `SUDO_PASSWORD` can only be used with the `sudo` bridge — you can't accidentally inject it as a curl header. `GROK_API_KEY` can be used as an env var or in curl commands, but not piped to stdin. The permission model is deny-by-default: if a scope isn't explicitly listed, the access is rejected.

---

### Layer 3: The Bridge

The bridge is the mechanism that injects a secret into a target command without exposing it to the calling process. There are four injection patterns:

**Stdin pipe (for sudo, SSH).** The secret is piped to the target command's stdin. `sudo -S` reads the password from stdin instead of the terminal. SSH passphrases use `SSH_ASKPASS` — a mechanism where SSH asks an external program for the passphrase instead of prompting interactively.

```bash
# What the AI agent runs
pman exec sudo -- ufw allow 8900

# What actually happens (simplified)
secret = vault.decrypt("SUDO_PASSWORD")
echo $secret | sudo -S ufw allow 8900
zeroize($secret)
# Agent receives only: "Rule added"
```

**Environment variable injection.** The secret is set as an environment variable in a subprocess's environment, not in the parent shell. When the subprocess exits, the environment variable ceases to exist.

```bash
# What the AI agent runs
pman env GROK_API_KEY -- node research-script.mjs

# What actually happens
secret = vault.decrypt("GROK_API_KEY")
env GROK_API_KEY=$secret node research-script.mjs
zeroize($secret)
# Agent receives only: script output
```

**Template substitution (for curl, HTTP headers).** Placeholder tokens in the command are replaced with decrypted values before execution:

```bash
# What the AI agent runs
pman exec curl -- -H "Authorization: Bearer {GROK_API_KEY}" \
  https://api.example.com/v1/query

# What actually happens
# {GROK_API_KEY} is replaced with the decrypted value
# The full curl command runs in a subprocess
# Agent receives only: API response body
```

**Stdin passthrough (for arbitrary commands).** For commands that read secrets from stdin (database clients, encryption tools), the secret is piped directly:

```bash
# What the AI agent runs
pman inject DB_PASSWORD --stdin -- psql -h db.example.com -U app

# What actually happens
secret = vault.decrypt("DB_PASSWORD")
echo $secret | psql -h db.example.com -U app
zeroize($secret)
```

In every pattern, the invariant is the same: **the secret enters the subprocess via a side channel (stdin or environment), never through the agent's context window, and the bridge returns only the command's output.**

---

### Layer 4: The Audit Trail

Every secret access is logged to an append-only SQLite database at `~/.pman/audit.db`. The log records:

| Field | Example | Purpose |
|-------|---------|---------|
| `timestamp` | `2026-05-01T14:23:07Z` | When the access occurred |
| `slot` | `SUDO_PASSWORD` | Which secret was accessed |
| `command` | `sudo ufw allow 8900` | What command used the secret |
| `caller` | `claude-code (PID 48291)` | Which agent/process requested it |
| `bridge_type` | `stdin` | How the secret was injected |
| `exit_code` | `0` | Whether the command succeeded |
| `policy_result` | `approved` | Whether the policy check passed |

What is never logged: **the secret value itself.** The audit trail tells you that `SUDO_PASSWORD` was used to run `sudo ufw allow 8900` at 2:23 PM by Claude Code, and the command succeeded. That's enough information to investigate an incident without creating another copy of the secret.

```bash
# View recent access log
pman log
# 2026-05-01 14:23:07 | SUDO_PASSWORD | sudo ufw allow 8900 | claude-code | approved | exit:0
# 2026-05-01 14:25:11 | GROK_API_KEY  | node research.mjs   | claude-code | approved | exit:0

# Filter by slot
pman log --slot SUDO_PASSWORD

# Filter by agent
pman log --caller claude-code
```

The append-only property is important. The audit database is write-only — entries can be added but never modified or deleted (enforced at the application layer, with filesystem permissions as a backup). This means that even if the system is compromised, the attacker can't erase evidence of their access.

---

## Why Not HashiCorp Vault or AWS Secrets Manager?

Fair question. Both are battle-tested, widely deployed, and trusted by enterprises. Let me explain why they're the wrong tool for this particular job.

**HashiCorp Vault** is an infrastructure-grade secrets engine. It supports dynamic secrets, automatic rotation, multiple authentication backends, HA clustering, and audit logging to external SIEM systems. It's also a distributed system that requires a server process, unsealing ceremony (or auto-unseal via cloud KMS), storage backend configuration, and ongoing operational maintenance. For a Fortune 500 company with a dedicated platform team, that's fine. For a solo developer who needs to pipe their sudo password to a shell command, it's like renting a dump truck to move a couch.

I know because I tried it. I spent an afternoon configuring a dev-mode Vault instance. By the time I had the policies, auth methods, and secret engines configured, I'd burned more time than the original problem was worth. And dev-mode Vault stores everything in memory — restart the process and your secrets are gone. Production mode requires a storage backend (Consul, Raft, PostgreSQL) which is itself infrastructure that needs secrets management. It's turtles all the way down.

**AWS Secrets Manager** solves the operational burden by being a managed service. But it introduces a different problem: network dependency. Every secret access requires an HTTPS call to AWS, which means you need network connectivity, AWS credentials (ironic), and you're trusting Amazon with your secrets. For API keys that already go to cloud services, that might be acceptable. For my local sudo password? No.

Secrets Manager also costs money ($0.40 per secret per month, plus $0.05 per 10,000 API calls). For a dozen secrets, that's negligible. But the real cost is the operational surface area: IAM policies, VPC endpoints, KMS key management, CloudTrail audit configuration. Each piece is simple; the composition is not.

**What fits a single-developer use case:**

| Requirement | HashiCorp Vault | AWS Secrets Manager | Local Vault (pman) |
|-------------|----------------|--------------------|--------------------|
| Zero network dependency | No (server process) | No (AWS API calls) | Yes |
| No cloud trust required | Depends on backend | No | Yes |
| Setup time | Hours | Minutes (but IAM...) | Minutes |
| Operational overhead | High (unsealing, backups, upgrades) | Medium (IAM, KMS) | Near zero |
| Cost | Free (OSS) but infra cost | $0.40/secret/month | Free |
| AI agent bridge | Custom integration | Custom integration | Native |
| Works offline | With local backend | No | Yes |
| Handles sudo/SSH | Custom plugins | No | Native |

The gap isn't capability. Both enterprise tools can technically handle everything pman does. The gap is **appropriateness**. A solo developer with nine API keys, a sudo password, and some SSH keys doesn't need a distributed secrets engine. They need a tool that fits in their existing workflow without adding operational burden.

---

## The MCP Integration: Making It Native

The CLI bridge works with any agent that can execute shell commands. But the real leverage is MCP — the Model Context Protocol that's becoming the standard interface between AI agents and external tools.

With an MCP server, the credential bridge becomes a native capability that any MCP-compatible agent can discover and use without special configuration. The agent doesn't call a shell command; it invokes a typed tool with structured parameters and gets structured responses:

```json
// MCP tool call (what the agent sends)
{
  "tool": "pman_exec",
  "arguments": {
    "command": "sudo ufw allow 8900",
    "slots": ["SUDO_PASSWORD"]
  }
}

// MCP tool response (what the agent receives)
{
  "stdout": "Rule added\nRule added (v6)",
  "stderr": "",
  "exit_code": 0
}
```

The agent never sees the secret. The MCP server handles decryption, injection, execution, and audit logging internally. From the agent's perspective, it called a tool and got a result.

MCP server registration is a one-line addition to your agent's config:

```json
// Example MCP server registration
{
  "mcpServers": {
    "pman": {
      "command": "pman",
      "args": ["mcp", "serve"],
      "description": "Credential bridge — secure secret injection"
    }
  }
}
```

Once registered, the agent discovers the available tools automatically. It can list slot names (but not values), execute commands with secret injection, set environment variables for subprocesses, and query the audit log. All through typed MCP tool calls with structured responses.

**Why MCP matters for security:** Shell commands are stringly-typed. An agent that constructs shell commands might accidentally echo a secret, pipe it to a log file, or include it in an error message. MCP tool calls are structured — the secret is never in a string that the agent assembles. The injection boundary is enforced by the protocol, not by hoping the agent constructs the right command.

---

## Threat Model: What Are We Defending Against?

No security tool is complete without an explicit threat model. Here's what this architecture addresses and what it doesn't.

### Threats Mitigated

**Secret exfiltration via agent context.** The primary threat. An AI agent's conversation history, logs, or cached outputs could be accessed by the model provider, a third-party plugin, or an attacker who compromises the agent's session. With the bridge, the secret is never in the context window.

**Credential sprawl from `.env` files.** Plaintext `.env` files get committed to repos, copied between machines, left in Docker images, and sourced into shells where every process can read them. The encrypted vault replaces all of those with a single encrypted file.

**Lateral movement via unrestricted secrets.** If an agent can read `SUDO_PASSWORD`, can it also read `STRIPE_SECRET_KEY`? With flat `.env` files, yes. With scoped permissions, each secret has an explicit allowlist of agents and bridge commands.

**Undetected secret access.** Without audit logging, you don't know which secrets were used, when, or by whom. The append-only audit trail makes every access visible and traceable.

**Secrets persisting in memory.** The bridge uses explicit memory zeroing (`zeroize` in Rust) to overwrite decrypted secrets after injection. This prevents recovery from core dumps, swap files, or memory scanning tools.

### Threats NOT Mitigated

**A compromised host system.** If an attacker has root access to the machine where the vault lives, they can read process memory during decryption, keylog the passphrase, or modify the `pman` binary itself. The vault protects secrets at rest and in transit to subprocesses; it doesn't protect against a fully compromised operating system. (This is the same limitation as every software-based secrets manager, including HashiCorp Vault and AWS Secrets Manager.)

**A malicious AI agent.** If the agent's code is backdoored to exfiltrate subprocess outputs, the bridge can't prevent that. The agent receives command output — if the command itself echoes the secret (a misconfigured script that prints its own env vars, for example), the bridge can't detect that. Defense here requires trust in the agent's code, which is a separate problem.

**Side-channel attacks.** Timing attacks, power analysis, and electromagnetic emanation are out of scope for a software tool. Hardware security modules (HSM, TPM, YubiKey) are on the roadmap as a stretch goal for high-value secrets.

**Social engineering.** If an attacker convinces you to run `pman export --env > secrets.txt`, no amount of encryption helps. The bridge makes secure access easy and insecure access explicit — the `export` command exists for migration purposes and prints warnings.

The honest posture: this tool significantly raises the bar for secret access by AI agents, eliminates the most common attack vectors (plaintext files, context window leakage, unrestricted scope), and provides audit visibility. It is not a silver bullet. Defense in depth — network segmentation, filesystem permissions, regular secret rotation, and operational awareness — remains essential.

---

## The Migration Path: From `.env` to Encrypted Vault

If you're currently using `.env` files (and statistically, you probably are), migration is designed to be frictionless:

```bash
# Step 1: Initialize the vault
pman init
# Creates ~/.pman/ directory with age-encrypted vault
# Prompts for a vault passphrase

# Step 2: Import existing secrets
pman import --env ~/.env
# Reads key=value pairs, encrypts each as a named slot
# Warns about weak or duplicate values

# Step 3: Verify
pman list
# SUDO_PASSWORD
# GROK_API_KEY
# GEMINI_API_KEY
# ELEVENLABS_API_KEY
# DROPBOX_APP_KEY
# ... (slot names only, never values)

# Step 4: Test the bridge
pman exec sudo -- whoami
# root
# (SUDO_PASSWORD was decrypted, injected, and zeroed — you saw nothing)

# Step 5: (Eventually) Remove the plaintext file
# Only after you've validated all bridge commands work
```

The import tool supports `.env` files (most common), `pass` (the Unix password store), 1Password CLI, and Bitwarden CLI. Conflict resolution handles duplicate slot names with skip, overwrite, or rename options.

The key insight about migration is that it doesn't have to be all-or-nothing. You can import your most sensitive secrets first (sudo password, payment processor keys, database URLs) and leave less critical ones in `.env` files until you're comfortable with the workflow. The bridge and `.env` files can coexist.

---

## Design Decisions Worth Explaining

A few choices that might not be obvious:

**Rust, not Python or Node.** Three reasons. First, a single static binary with zero runtime dependencies. No `pip install`, no `node_modules`, no version conflicts. The binary goes in `/usr/local/bin` and works. Second, memory safety. Rust's ownership model makes it much harder to accidentally leak secrets through dangling pointers or buffer overruns. Third, the `zeroize` crate provides zero-cost memory zeroing that's guaranteed not to be optimized away by the compiler — a property that's hard to achieve in garbage-collected languages where you don't control when memory is freed.

**age, not GPG.** GPG is the default for encrypted credential stores (`pass` uses it). But GPG's key management is notoriously complex — key servers, trust models, subkeys, expiration policies. `age` has one job: encrypt and decrypt files. Its simplicity is its security property. Less code, less attack surface, less to get wrong.

**SQLite for audit, not flat files.** Append-only semantics are easy to enforce in SQLite (application-layer INSERT-only policy plus filesystem permissions). Flat log files are easier to tamper with, harder to query, and don't support filtered views (`pman log --slot SUDO_PASSWORD --since 2026-04-01`). SQLite is also a single file — no database server to manage.

**TOML for config, not YAML or JSON.** TOML is designed for configuration files. It's more readable than JSON for nested structures (no brace matching), less surprising than YAML (no "Norway problem" where `NO` becomes a boolean), and has a well-defined spec. The slot policies in `config.toml` are readable at a glance:

```toml
[slots.SUDO_PASSWORD]
scope = ["sudo"]
agents = ["claude-code", "opencode"]
ttl = "1h"
require_approval = true
```

**No cloud component.** The vault is a local file. No account creation, no subscription, no data leaving the machine. This is a deliberate architectural constraint, not a limitation. For solo developers, local-first means the tool works offline, on air-gapped machines, and without trusting a third party with your most sensitive credentials. Team features (shared vaults with per-user age recipients) are a planned extension, but the core tool will always work standalone.

---

## Where This Sits in the Ecosystem

The AI credential security space is young and fragmented. A few projects are worth knowing about:

**OpaqueVault** is the closest competitor. It's a zero-knowledge vault with MCP tools for secret injection. Client-side decryption using Argon2id and AES-256-GCM, memory zeroing, and leak scanning. It's well-designed but focused specifically on MCP and API workflows — it doesn't handle the generalized cases like sudo, SSH, and arbitrary stdin injection.

**Gap** (by Mike Kelly) takes a different approach: a local proxy that injects credentials into HTTP requests. The agent gets a bearer token, the proxy swaps it for real credentials before forwarding the request. Clever, but limited to HTTP — no support for shell commands, sudo, or SSH.

**Anthropic's managed Vaults** is platform-native credential registration for Anthropic's managed agent platform. Write-only, workspace-scoped, limited to 20 credentials per vault. It's the right solution if you're exclusively in Anthropic's ecosystem, but it doesn't help with other agents or non-API credentials.

The established players — HashiCorp Vault, Infisical, Doppler, 1Password — are all adapting their products for AI agent workflows. But they're coming at it from the enterprise direction: cloud-first, team-oriented, operationally heavy. That's the right approach for organizations. It's the wrong approach for a solo developer who needs to bridge their sudo password to a coding agent.

The gap in the market is a tool that's **local-first, encrypted, generalized to all credential types, and designed from the ground up for the AI agent workflow.** Not adapted from an enterprise secrets manager. Not limited to one agent platform. Not dependent on a cloud service. Just a simple, secure bridge between your secrets and the tools that need them.

---

## What I Learned Building This

Three things surprised me during this project:

**The injection mechanism is the easy part.** Piping a password to stdin or setting an env var is trivial. The hard part is everything around it: encryption at rest, scoped permissions, audit logging, memory zeroing, caller identification, migration tooling, and MCP integration. The bridge itself is maybe 50 lines of code. The infrastructure that makes it safe is thousands.

**Flat credential files are a form of technical debt.** I'd been using `.env` files for years without thinking of them as a risk. They worked, they were convenient, and everyone uses them. But "everyone uses them" is exactly why they're a target. The AI agent era turns passive risk (a file sitting on disk) into active risk (a file being read and processed by autonomous agents). The transition from passive to active is what makes this urgent.

**The academic research is ahead of the tooling.** Papers on authenticated delegation, agentic JWT, and credential leakage in LLM skills describe security models that are more sophisticated than anything shipping in production tools today. The research community has mapped the threat landscape. The tooling community is still building `.env` wrappers. The gap between the two is where the opportunity lives.

---

## Try It Yourself

The architecture described in this post is implemented in a project called pman. It's currently in the research-and-design phase, with a phased development plan that starts with the core vault and sudo bridge and builds toward MCP integration and policy engines.

If you're building something similar, here are the key design principles:

1. **Zero-knowledge bridge.** The agent never receives the secret value. It references a name, and the bridge handles decryption and injection in a subprocess the agent can't inspect.

2. **Encrypted at rest, zeroed after use.** No plaintext credential files on disk. Decrypted values exist only in memory, only during injection, and are explicitly overwritten afterward.

3. **Scoped by default.** Every secret has an explicit policy defining which agents, which bridge commands, and what TTL. Deny everything not explicitly allowed.

4. **Audit everything.** Every access logged with timestamp, caller, command, and result. Never log the secret itself.

5. **Stay local.** No cloud dependency, no subscription, no data leaving the machine. The vault is a file you control.

The AI agent revolution is happening whether we secure it or not. Twelve million hard-coded secrets on GitHub say we haven't secured the pre-agent era. Let's not repeat that mistake in the post-agent one.
