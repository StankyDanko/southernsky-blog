---
title: "Bandwidth Monitoring with vnstat and systemd Timers"
description: "I built a bandwidth alerting system that warns me before I blow through my ISP's data cap. vnstat tracks usage, a Python script checks thresholds, and systemd fires it every hour."
publishDate: 2026-03-12
author: j-martin
tier: applied
postType: tutorial
difficulty: intermediate
estimatedMinutes: 10
prerequisites: []
category: linux
tags: ["vnstat", "systemd", "bandwidth", "monitoring", "python", "alerting"]
certTracks: ["comptia-network-plus", "comptia-linux-plus"]
featured: false
heroImage: "/images/posts/bandwidth-monitoring-vnstat-systemd.webp"
draft: false
---

## Why Should You Care?

Last year I accidentally transferred 717GB in a single month on a connection with a 1TB cap. I didn't notice until I got the overage notice. That was the last time I let bandwidth go unmonitored.

The solution I built uses three Linux tools that work well together: `vnstat` for usage tracking, a Python script for threshold checking, and systemd timers for hourly execution. No daemons, no cron, no third-party monitoring SaaS.

## Install and Configure vnstat

vnstat is a network traffic monitor that reads kernel network counters. It doesn't intercept packets — it just reads `/proc/net/dev` on a schedule and accumulates totals. This makes it lightweight and accurate.

```bash
sudo apt install vnstat
sudo systemctl enable --now vnstat
```

You need to tell vnstat which interface to watch. Find yours:

```bash
ip link show
```

```
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536
2: enp6s0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 ...
3: wg0: <POINTOPOINT,MULTICAST,NOARP,UP,LOWER_UP> mtu 1280
```

My primary interface is `enp6s0`. Add it to vnstat:

```bash
sudo vnstat --add -i enp6s0
```

vnstat starts collecting immediately, but it needs at least a few minutes to have data. After a day or two you'll see real numbers:

```bash
vnstat -i enp6s0
```

```
Database updated: 2026-03-12 09:42

   enp6s0
                          rx      |     tx      |    total    |   avg. rate
     ------------------------+-------------+-------------+---------------
       2026-03-10      22.51 GiB |   8.33 GiB |  30.84 GiB |    3.00 Mbit/s
       2026-03-11      18.77 GiB |   6.12 GiB |  24.89 GiB |    2.42 Mbit/s
       2026-03-12       9.44 GiB |   3.21 GiB |  12.65 GiB |    2.18 Mbit/s
     ------------------------+-------------+-------------+---------------
     estimated     39.50 GiB |  13.01 GiB |  52.51 GiB |
```

The `estimated` row projects current-day usage to end-of-day based on your rate so far. That's useful context for the alerting script.

## The JSON Interface

The alerting script doesn't parse vnstat's human-readable output — it uses the `--json` flag, which gives you machine-parseable data:

```bash
vnstat -i enp6s0 --json d 2
```

```json
{
  "vnstatversion": "2.12",
  "jsonversion": "2",
  "interfaces": [
    {
      "name": "enp6s0",
      "traffic": {
        "day": [
          {
            "id": 1,
            "date": { "year": 2026, "month": 3, "day": 11 },
            "rx": 20158627021,
            "tx": 6576848231
          },
          {
            "id": 2,
            "date": { "year": 2026, "month": 3, "day": 12 },
            "rx": 10139495986,
            "tx": 3449824093
          }
        ]
      }
    }
  ]
}
```

Note the `rx`/`tx` values are in bytes. The script converts to GiB for threshold comparisons.

## The Python Check Script

```python
#!/usr/bin/env python3
# ~/tools/bandwidth-monitor/check-bandwidth.py

import json
import subprocess
import sys
from datetime import date, datetime
from pathlib import Path

INTERFACE = "enp6s0"
LOG_DIR = Path.home() / "tools" / "bandwidth-monitor" / "logs"

# Thresholds
THRESHOLDS = {
    "day_warn_gb":    50,
    "day_crit_gb":   200,
    "hour_warn_gb":   20,
    "month_warn_gb": 500,
}

def bytes_to_gib(b: int) -> float:
    return b / (1024 ** 3)

def get_vnstat_json(period: str, count: int) -> dict:
    result = subprocess.run(
        ["vnstat", "-i", INTERFACE, "--json", period, str(count)],
        capture_output=True, text=True, check=True
    )
    return json.loads(result.stdout)

def check_daily() -> list[str]:
    alerts = []
    data = get_vnstat_json("d", 1)
    day_entry = data["interfaces"][0]["traffic"]["day"][0]

    total_bytes = day_entry["rx"] + day_entry["tx"]
    total_gib = bytes_to_gib(total_bytes)

    if total_gib >= THRESHOLDS["day_crit_gb"]:
        alerts.append(
            f"CRITICAL: Daily bandwidth {total_gib:.1f} GiB "
            f"exceeds {THRESHOLDS['day_crit_gb']} GiB threshold"
        )
    elif total_gib >= THRESHOLDS["day_warn_gb"]:
        alerts.append(
            f"WARNING: Daily bandwidth {total_gib:.1f} GiB "
            f"exceeds {THRESHOLDS['day_warn_gb']} GiB threshold"
        )

    return alerts

def check_monthly() -> list[str]:
    alerts = []
    data = get_vnstat_json("m", 1)
    month_entry = data["interfaces"][0]["traffic"]["month"][0]

    total_bytes = month_entry["rx"] + month_entry["tx"]
    total_gib = bytes_to_gib(total_bytes)

    if total_gib >= THRESHOLDS["month_warn_gb"]:
        alerts.append(
            f"WARNING: Monthly bandwidth {total_gib:.1f} GiB "
            f"exceeds {THRESHOLDS['month_warn_gb']} GiB threshold"
        )

    return alerts

def check_hourly() -> list[str]:
    alerts = []
    data = get_vnstat_json("h", 1)
    hour_entry = data["interfaces"][0]["traffic"]["hour"][0]

    total_bytes = hour_entry["rx"] + hour_entry["tx"]
    total_gib = bytes_to_gib(total_bytes)

    if total_gib >= THRESHOLDS["hour_warn_gb"]:
        alerts.append(
            f"WARNING: Last hour bandwidth {total_gib:.1f} GiB "
            f"exceeds {THRESHOLDS['hour_warn_gb']} GiB threshold"
        )

    return alerts

def log_alerts(alerts: list[str]) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_file = LOG_DIR / f"alerts-{date.today().isoformat()}.log"

    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with open(log_file, "a") as f:
        for alert in alerts:
            f.write(f"[{timestamp}] {alert}\n")
            print(alert, file=sys.stderr)

def main():
    all_alerts = []
    all_alerts.extend(check_hourly())
    all_alerts.extend(check_daily())
    all_alerts.extend(check_monthly())

    if all_alerts:
        log_alerts(all_alerts)
        sys.exit(1)  # Non-zero so systemd logs it as a failure
    else:
        print(f"OK — bandwidth within thresholds at {datetime.now().strftime('%H:%M')}")

if __name__ == "__main__":
    main()
```

Make it executable:

```bash
chmod +x ~/tools/bandwidth-monitor/check-bandwidth.py
```

Test it manually:

```bash
~/tools/bandwidth-monitor/check-bandwidth.py
```

```
OK — bandwidth within thresholds at 09:42
```

If you want to test the alert logic without actually blowing your cap, temporarily lower a threshold and re-run.

## The systemd Timer

Two files needed: a service unit that runs the script, and a timer unit that schedules it.

**`~/.config/systemd/user/bandwidth-check.service`**

```ini
[Unit]
Description=Bandwidth threshold check
After=network.target

[Service]
Type=oneshot
ExecStart=%h/tools/bandwidth-monitor/check-bandwidth.py
StandardOutput=journal
StandardError=journal
```

`Type=oneshot` means systemd runs the command, waits for it to exit, and considers the service done. Right for a script that runs and finishes — not a long-running daemon.

**`~/.config/systemd/user/bandwidth-check.timer`**

```ini
[Unit]
Description=Run bandwidth check every hour
Requires=bandwidth-check.service

[Timer]
OnBootSec=5min
OnUnitActiveSec=1h
AccuracySec=1min
Persistent=true

[Install]
WantedBy=timers.target
```

`Persistent=true` means if the machine was off when the timer was supposed to fire, it runs the check immediately on the next boot rather than skipping it. This matters for a laptop that gets shut down overnight.

Enable and start:

```bash
systemctl --user daemon-reload
systemctl --user enable --now bandwidth-check.timer
```

Verify it's scheduled:

```bash
systemctl --user list-timers bandwidth-check.timer
```

```
NEXT                        LEFT     LAST                        PASSED  UNIT                   ACTIVATES
Thu 2026-03-12 10:42:00 CST 59min    Thu 2026-03-12 09:42:05 CST 1s ago  bandwidth-check.timer  bandwidth-check.service
```

Check recent runs:

```bash
journalctl --user -u bandwidth-check.service --since "24h ago"
```

```
Mar 12 01:42:05 workstation bandwidth-check.py[38421]: OK — bandwidth within thresholds at 01:42
Mar 12 02:42:05 workstation bandwidth-check.py[39108]: OK — bandwidth within thresholds at 02:42
Mar 12 03:42:06 workstation bandwidth-check.py[39891]: OK — bandwidth within thresholds at 03:42
...
Mar 12 09:42:05 workstation bandwidth-check.py[47302]: OK — bandwidth within thresholds at 09:42
```

## What Happens When a Threshold Trips

When the script exits non-zero, systemd marks the service as failed. You can see it with `systemctl --user status bandwidth-check.service`. The alert also writes to the daily log file in `~/tools/bandwidth-monitor/logs/`.

For something louder, you can add a desktop notification:

```python
def notify_desktop(message: str) -> None:
    subprocess.run([
        "notify-send",
        "--urgency=critical",
        "--icon=network-error",
        "Bandwidth Alert",
        message
    ])
```

Or route to a Discord webhook, or send yourself an email. The core check script doesn't care about the delivery mechanism — it just writes to stderr and exits non-zero, which lets you wire in whatever notification system fits your workflow.

## Why vnstat Over Other Tools

You could use `nethogs`, `iftop`, or even read `/proc/net/dev` yourself. Here's why vnstat is the right tool for this use case:

- **Persistent across reboots** — stores data in a SQLite database, survives power cycles
- **Interface-level granularity** — tracks each interface separately; VPN traffic on a separate tunnel interface doesn't pollute your physical interface stats
- **No elevated privileges needed** — runs as a normal user once the daemon is set up with root
- **JSON output** — machine-parseable without screen-scraping

The 717GB incident happened on a month where I was running large model downloads and YouTube archive pulls simultaneously. Neither operation felt big in isolation. vnstat would have caught the hourly rate and flagged it before the month total got out of hand.

## What You Learned

- vnstat accumulates network usage persistently across reboots and exposes clean JSON output for scripting
- `--json d 1` / `--json m 1` / `--json h 1` gives you day/month/hour data in parseable form with bytes in the `rx`/`tx` fields
- systemd `Type=oneshot` services are the right pattern for scripts that run and exit, not long-running daemons
- `Persistent=true` on a timer ensures missed runs (due to shutdown) fire on next boot
- Non-zero exit codes from a oneshot service surface as failures in `systemctl status` and `journalctl`, giving you visibility without a separate logging pipeline
