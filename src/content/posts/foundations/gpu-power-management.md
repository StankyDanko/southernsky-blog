---
title: "What Is GPU Power Management and Why Should You Care?"
description: "My RTX 3080 Ti ran at 350W by default. I wrote a systemd service to lock it at 300W — here's exactly how."
publishDate: 2026-03-10
author: j-martin
tier: foundations
postType: today-i-learned
difficulty: beginner
estimatedMinutes: 7
prerequisites: []
category: linux
tags: ["nvidia", "systemd", "gpu", "power-management", "rtx-3080-ti"]
certTracks: ["comptia-a-plus"]
featured: false
heroImage: "/images/posts/gpu-power-management.webp"
draft: false
---

## Why Should You Care?

If you have an NVIDIA GPU and you're running AI workloads, your card is probably pulling way more power than it needs to. My RTX 3080 Ti was drawing 350W at stock — hot, loud, and shortening its lifespan for no good reason.

I locked it to 300W and 1700MHz with a single systemd service. Performance barely changed. Thermals dropped significantly. Here's how.

## The Problem

NVIDIA GPUs ship with aggressive power limits. The RTX 3080 Ti defaults to 350W TDP. When you're running Ollama inference or training models, the card pins at max power for hours. That means:

- **Heat** — sustained 80°C+ temps degrade the card over time
- **Fan noise** — sounds like a jet engine
- **Power bill** — 350W is a space heater
- **Throttling** — ironically, running too hot causes the GPU to throttle itself anyway

## The Fix: nvidia-smi Power Limit

NVIDIA includes `nvidia-smi` with their drivers. One command sets a power ceiling:

```bash
sudo nvidia-smi -pl 300
```

That limits the card to 300W. You can also lock the GPU clock:

```bash
sudo nvidia-smi -lgc 210,1700
```

This sets the clock range to 210-1700MHz (down from the stock 1700-1950MHz boost range).

## Making It Permanent with systemd

The `nvidia-smi` settings reset on reboot. To make them stick, create a systemd service:

```ini
[Unit]
Description=Set GPU power limit and clock speed
After=nvidia-persistenced.service

[Service]
Type=oneshot
ExecStart=/usr/bin/nvidia-smi -pl 300
ExecStart=/usr/bin/nvidia-smi -lgc 210,1700
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
```

Save this as `/etc/systemd/system/gpu-power-limit.service`, then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now gpu-power-limit.service
```

## Verify It Works

```bash
$ nvidia-smi -q -d POWER | grep -A2 "Power Limit"
    Min Power Limit                   : 100.00 W
    Max Power Limit                   : 350.00 W
    Current Power Limit               : 300.00 W
```

## The Result

After running this for two months on my home lab workstation:

- GPU temp dropped from ~82°C under load to ~72°C
- Fan noise went from "jet engine" to "noticeable but fine"
- Ollama inference speed: no measurable difference
- The card will last years longer

For 10 minutes of setup, that's a no-brainer.

## What You Learned

- `nvidia-smi -pl` sets a watt ceiling for your GPU
- `nvidia-smi -lgc` locks clock speed ranges
- A `oneshot` systemd service makes settings survive reboots
- Lower power ≠ lower performance for most AI/inference workloads
