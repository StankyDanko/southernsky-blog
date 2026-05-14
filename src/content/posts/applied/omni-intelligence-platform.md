---
title: "OMNI: A Personal Intelligence Operating System"
description: "25 live data layers on a 3D globe. Natural language commands. AI-powered news translation. One engineer. Zero funding."
publishDate: 2026-05-14
author: j-martin
tier: applied
postType: project-walkthrough
difficulty: intermediate
estimatedMinutes: 8
prerequisites: []
category: ai-ml
tags: ["omni", "geoint", "osint", "cesium", "geospatial", "intelligence", "southernsky"]
certTracks: []
heroImage: "/images/posts/omni-intelligence-platform.webp"
featured: true
draft: false
---

## What Is This Thing?

OMNI is a personal intelligence operating system — a live 3D globe where every layer of the world you care about lands simultaneously. Aviation, wildfires, earthquakes, satellites, conflict zones, air quality, maritime traffic, breaking news translated from a dozen languages — all of it, on one screen, right now.

Think Google Earth meets Bloomberg Terminal meets personal knowledge graph. I built it alone. It's live at **[omni.southernsky.cloud](https://omni.southernsky.cloud)**. Go open it.

## What You See When You Load It

The interface is dark slate — `#020617`, the color of a command center at 2 AM. A full-screen interactive 3D globe fills the viewport. You can spin it, zoom it, click any entity and get a detail panel.

Flanking the globe are two tabbed docks: the Intel Dock on the left (news feeds, event streams, situational data) and the Tactical Dock on the right (alerts, geofence rules, export controls). A floating command palette hovers at the top. A status strip runs the bottom. NavInstrument sits in the corner showing your current bearing and zoom.

It's Palantir Gotham aesthetic — built for operators, readable at a glance, zero decoration that doesn't carry information.

## The 25 Layers

Every layer is live data, pulling from real APIs on a real schedule. These are a few that stop people mid-scroll when I show them:

**Aviation** — Every commercial and tracked aircraft currently in the air. Click one and you get callsign, altitude, heading, speed, origin, destination. At any given moment there are 10,000+ airborne.

**Satellites (Space-Track)** — Low-Earth orbit debris, active satellites, and the International Space Station plotted against their actual orbital paths. Watch the ISS move in real time.

**Maritime (AIS)** — Cargo ships, tankers, and vessels reporting position over the ocean. Global shipping lanes emerge visually from the data without being drawn on the map.

**Wildfires (NASA FIRMS)** — Active fire detections from MODIS and VIIRS satellite instruments. I've watched fires in the western US appear hours before local news covers them.

**ACLED Conflict** — Armed conflict events with dates, actor names, and fatalities from ACLED's public dataset. Layered over the globe, the density of violence in certain regions becomes immediately visceral.

**CISA KEV** — Known Exploited Vulnerabilities from CISA's catalog. Geolocated where possible. A reminder that infrastructure risk is a geographic problem.

**Property Parcels (Regrid)** — Parcel boundaries and ownership data. Zoom into any metro area and the grid of private ownership snaps into view.

The full list: Aviation, Satellites, Maritime, Wildfires, Air Quality, Cell Towers, Earthquakes, Asteroids, Weather (NEXRAD), CCTV, Field Agents, Infrastructure, Social Media, GDELT News, GDELT Events, ACLED Conflict, ReliefWeb Disasters, NWS Alerts, Cloudflare Radar, CISA KEV, Nuclear Facilities, Property Parcels, Tectonic Plates, Time Zones, Astronomy, Urban Mesh. All 25, on a single screen.

## LENS — The Part That Makes It Magic

OMNI LENS is a natural language command palette that controls all 25 layers. You type what you want in plain English and it does it.

```
show me earthquakes near Japan in the last 24 hours
```

That single sentence parses intent, maps it to the earthquake layer, applies a geographic filter for Japan, sets the time window to 24 hours, toggles the layer on, and flies the camera to the region.

LENS covers 60 distinct actions across every layer. Filter by time window, zoom to a region, cross-reference two layers, trigger an export, open a briefing, enable an alert rule — all from text. It's the difference between a visualization tool and an operating system.

No dropdowns. No sidebar menus. You describe what you want.

## The Intelligence Pipeline

Two systems deserve their own call-out.

**AI-Powered News Translation** — Draw a geofence circle anywhere on the globe. OMNI surfaces local news articles from inside that circle, translates them to English in real time using an AI language pipeline, and presents them in the Intel Dock. Drop a circle over Kinshasa, São Paulo, or Vladivostok and read what local outlets are covering — not the wire translation, the actual local coverage. This is one of the features I'm most proud of.

**Daily Briefing** — Every morning OMNI's AI layer compiles a situational awareness summary across active layers. Overnight earthquakes, new fire detections, active conflict events, notable infrastructure alerts, space weather. One digest. It reads the way a professional analyst brief reads — facts, no filler.

## The Stack

```
Next.js 16 + React 19       — App shell and routing
CesiumJS 1.138              — 3D globe engine
Zustand 5                   — State management (25 layers of real-time state)
TypeScript                  — All of it, top to bottom
Supabase                    — Auth + pgvector semantic search
Stripe                      — Billing (6 tiers)
```

Current build is `v1.1.0-rc87`. That `-rc87` is not a typo. It's what iterating on a real system for months looks like.

The architecture runs 25 independent data adapters, each with its own fetch cadence, normalization logic, and CesiumJS entity mapping. The globe holds thousands of live entities simultaneously without frame drops. Managing that volume of reactive state across all 25 layers without reaching for Redux or heavier abstraction was a solved problem — Zustand handles it cleanly, and the architecture is better for the constraint.

## Go Try It

**[omni.southernsky.cloud](https://omni.southernsky.cloud)**

Open it on a wide screen if you have one. Turn on Aviation and Satellites first — the density alone is worth seeing. Then open LENS and type something. See what happens.

This project took months of evenings and weekends. It's self-funded, solo-built, and has no VC backing, no team, no marketing budget. Just a workstation and a problem I wanted to solve.

If OMNI is useful to you — or just impressive — consider supporting its continued development on [Patreon](https://patreon.com/southernskycloud). Every layer, every LENS action, every feature you see was built on nights and weekends with no runway. Your support is what keeps it moving — and there's a lot more to build.
