---
title: "dankMire: A 5-Machine Home Lab Running 4.3 Million Files"
description: "Five machines named after Greek gods. 4.3 million indexed files. A media database, a productivity heatmap, and an AI video studio — all running on local hardware with zero cloud dependencies."
publishDate: 2026-05-14
author: j-martin
tier: applied
postType: project-walkthrough
difficulty: intermediate
estimatedMinutes: 8
prerequisites: []
category: linux
tags: ["dankmire", "home-lab", "sqlite", "preact", "mesh", "infrastructure", "southernsky"]
heroImage: "/images/posts/dankmire-5-machine-home-lab.webp"
featured: false
draft: false
---

## Five Machines. Greek Gods. Zero Cloud Bills.

The first thing people ask when they see the dankMire dashboard is: "Why does your home lab have a mythology theme?"

The honest answer is that when you name machines after gods, the documentation writes itself. Zeus computes. Hera edits. Atlas holds everything. Ares and Artemis go where they're needed. The names carry their own semantics — and that matters when you're the only person maintaining the infrastructure at 11 PM.

The real answer is that I built this because I needed it — and somewhere along the way it stopped being a project and became the foundation that everything else runs on. OMNI, Agent Core, SaySee, this blog, 69 local AI models, a 2.2 million file media archive. All of it runs on dankMire.

This post is the overview: what the mesh is, what the numbers look like, and why I stopped reaching for cloud services.

---

## The Mesh

Five machines on a gigabit switch, all connected via CIFS/SMB bidirectional mounts. Every machine can read and write to every other machine's share. No SSH tunneling for file transfers, no cloud sync intermediaries. Files move at LAN speed because that's what the hardware is built for.

**Zeus** is the compute node. An i7-12700K, an RTX 3080 Ti with 12GB VRAM, 62GB of RAM. Zeus runs Ollama with 69 local models, the Podman containers behind every SouthernSky service, the build pipelines for OMNI and Agent Core, and the local Qdrant instance that powers semantic search across the media archive. When something needs GPU cycles or memory headroom, it runs on Zeus.

**Hera** is the creative node — a Mac Mini M1. DaVinci Resolve, Final Cut Pro, ProTools. The M1's media engine handles H.264 and H.265 transcoding at speeds Zeus's CPU can't match for that specific workload. Hera and Zeus complemented each other from the start: CPU + GPU compute on one side, media engine + Apple ecosystem on the other.

**Atlas** is the storage node. A Synology NAS with 26TB of capacity, serving as the authoritative archive for everything that doesn't need to be on a fast local disk. Atlas holds the 2.2 million file media database, the documentary footage archive, the music library, the backup store. Atlas doesn't compute — it persists.

**Ares** and **Artemis** are ThinkPad satellites. Ares lives in the living room, connected to the projector — a fixed terminal with full mesh access that doubles as a presentation rig. Artemis is portable: the road machine when local compute matters, carrying the same environment whether it's on the desk or across the city. Both have full read/write access to the mesh via CIFS mounts, so the environment is consistent regardless of which machine I'm sitting in front of.

---

## The Numbers

Raw counts from the mesh crawl as of May 2026:

| Machine | Role | Storage | Indexed Files |
|---------|------|---------|--------------|
| Zeus | Compute | 3.6TB + 458GB | ~680K |
| Hera | Creative | Mac Mini M1 SSD | ~120K |
| Atlas | NAS | 26TB | ~2.2M |
| Ares | Satellite | ThinkPad local | ~85K |
| Artemis | Satellite | ThinkPad local | ~105K |
| **Total** | | **~30TB managed** | **~4.3M** |

The media database (`atlas-media.db`) is the centerpiece: 2.2 million file records, each keyed by a BLAKE3 content hash. Deduplication is a schema constraint — if two copies of the same file exist anywhere on the mesh, only one record survives. The database knows where every copy lives, which machine holds the canonical version, and whether a file has been transcoded, analyzed, or archived.

The 4.3 million figure is the mesh-crawl total: every file across all five machines, indexed into a unified catalog. It's how I can run a semantic search query and get results sourced from footage on Atlas, project files on Zeus, and archived audio on Ares — without manually knowing where anything lives.

Those numbers are useful raw, but they're only half the picture. The other half is the dashboard that makes them navigable.

---

## The Dashboard

dankMire's interface is a Preact 10 + Express 5 + SQLite web app. Five tabs, each surfacing a different lens on the same underlying data.

**Overview** shows the mesh at a glance: which machines are reachable, file counts per node, disk utilization across the 26TB NAS volumes, and service health for the Ollama instance, GPU power limiter, and Open WebUI container. This is the first thing I open in the morning.

**Calendar** is a GitHub-style productivity heatmap backed by the same SQLite database that drives the rest of the dashboard. Every task I add via the `cal.mjs` CLI shows up here — project slug, priority, due date, completion. The heatmap makes months of work visible at once. There are also wellness templates and story notes, because tracking output without tracking the person doing the work is missing the point.

**Media Browser** connects to the Qdrant vector database and surfaces semantic search across the video, audio, and image collections. Searching for "morning fog on water" returns matching footage from the archive — not by filename, but by what the model understands about the content. This is how I navigate 2.2 million files without a filing cabinet.

**R&D** visualizes the research pipeline: automated sweep results, a triage queue ranked by actionability, and implementation briefs generated for the top items. The pipeline runs three times daily, queues Gemini Deep Research on the highest-priority knowledge gaps across all active projects, and stores results in a 501-file archive with full-text search. The R&D tab makes that queue visible and actionable without opening six terminal windows.

**Studio** is the blog-to-video assembly pipeline. Given a finished blog post, the Studio tab runs a narrative assembler that breaks the content into visual beats, proposes a shot sequence, and exports an FCPXML timeline for import into Final Cut Pro on Hera. It's not a fully automated video generator — it's a structured starting point that eliminates the blank-page problem. Every video on the J. Kenneth Martin YouTube channel starts here.

---

## Fully Owned Infrastructure

I don't have a Dropbox dependency for media storage. I don't have a Notion dependency for project tracking. I don't have a Pinecone dependency for vector search. I don't have a GitHub Actions dependency for research automation.

This isn't a philosophical position — it's a practical one that I arrived at through experience.

Cloud services are fast to start and slow to leave. The exit costs are rarely obvious at signup: price increases, API deprecations, data export limits, account suspensions for ambiguous ToS violations. I've been through enough of those to prefer a simpler mental model.

When you own the infrastructure, the failure modes are your own hardware failing — something you can monitor, diagnose, and fix. That's a tractable problem. The mesh cost real money to build. Synology NASes aren't cheap. ThinkPads accumulate. But the marginal cost of the next gigabyte of storage, the next 10,000 inference calls, the next research sweep — that's zero. The infrastructure is paid for.

Cloud has its place. I use Grok and Gemini APIs for tasks that specifically need their capabilities — video generation, deep research synthesis, image generation. But the data lives here. The compute lives here. The search index lives here. Cloud is a tool I reach for, not a dependency I can't shed.

---

## What dankMire Enables

The documentary project is the clearest example of what this infrastructure actually means. Thousands of files of footage, audio, documents, and correspondence — all indexed in `atlas-media.db`, all searchable via the Media Browser, all backed up to Atlas's RAID array. The mesh didn't make the documentary possible. But losing any of that material would end it, and the mesh is what ensures that doesn't happen.

The same logic applies across every active project. OMNI — a geospatial platform with a full-stack TypeScript web client and AI reasoning layer — runs its development environment on Zeus and deploys to the VPS. Agent Core — a LoRA training pipeline producing specialized AI agents — trains on Zeus's GPU, stores checkpoints on Atlas, and evaluates against a test harness that lives in dankMire's task system. SaySee, ZenoType, SouthernSky Chat, this blog — all developed, tested, and deployed from within the mesh.

The infrastructure doesn't just store work. It holds the continuity that makes long-term projects survivable.

---

## The Name

dankMire comes from a compound of "dank" (the internet-slang meaning: excellent, choice) and "mire" (a bog — a place where things accumulate, a deep substrate that doesn't shift). A damp foundation. The excellent bog everything runs in.

It's also a mild self-deprecating admission that home labs are inherently layered — scripts called by scripts, services watching services, mounts that reference mounts. You know exactly what everything does and why, but explaining the full stack to someone else requires a whiteboard.

This post is the whiteboard.

---

## What You Learned

- A home lab mesh built on CIFS/SMB bidirectional mounts gives every machine full access to every other machine's filesystem without complex orchestration — and LAN speeds make it fast enough for real workloads
- Content-addressed storage with BLAKE3 hashing handles deduplication at the schema level: the primary key constraint is the dedup logic
- A unified SQLite catalog across 4.3 million files spanning five machines makes semantic search, task tracking, and pipeline automation possible without cloud infrastructure
- Owning the infrastructure changes the failure mode calculus — hardware failures are diagnosable and fixable; cloud dependency failures are often neither
- A dashboard built around how you actually work — calendar, media, research, studio — is more useful than any combination of SaaS tools that don't share a data model
