---
title: "Bare Metal Gaming on Linux: Steam from a TTY Without a Desktop"
description: "How I set up desktop-free gaming on Pop!_OS with an RTX 3080 Ti — every failure, every fix, and the launcher script that finally made it work."
publishDate: 2026-05-03
author: j-martin
tier: applied
postType: project-walkthrough
difficulty: intermediate
estimatedMinutes: 14
prerequisites: []
category: linux
tags: ["linux", "gaming", "tty", "nvidia", "steam", "pop-os", "xorg"]
certTracks: []
featured: false
heroImage: "/images/posts/bare-metal-gaming-tty-linux.webp"
draft: false
---

## Why Should You Care?

My workstation runs local AI inference — 69 Ollama models, CUDA compute, the works. When I want to play Noita, every GPU cycle the COSMIC desktop compositor is using is a cycle my game isn't. The fix should be simple: ditch the desktop entirely, drop to a raw TTY, and launch Steam directly into Xorg with nothing else running.

It took four hours to make that "simple" idea actually work. Here's everything that broke and why, plus the scripts that came out the other side.

## The Goal

Play games from a raw Linux TTY — no GNOME, no KDE, no COSMIC, no compositor, no desktop session manager. Just:

```
TTY login → startx → Steam → game → exit → clean terminal
```

Full GPU to the game. No shared memory with a desktop. Works alongside long-running inference sessions on the CPU side.

## Dead End #1: cage (Wayland Compositor)

My first attempt used `cage`, a minimal single-application Wayland compositor. The appeal is obvious — Wayland is the future, NVIDIA supports it now, and cage is purpose-built for kiosk/bare-metal scenarios.

```bash
$ cage steam -bigpicture
```

```
SDL_VIDEODRIVER=wayland
[cage] starting compositor
libEGL warning: MESA-LOADER: failed to open nouveau
[cage] EGL initialization failed
SDL_Init failed: No available video device
```

The problem: NVIDIA's proprietary driver stack and Wayland have a specific initialization path that requires a running desktop session for the environment setup cage doesn't provide. `cage` works well with Mesa/nouveau or on machines that aren't running NVIDIA proprietary. On a system locked to `nvidia-drm.modeset=1` for CUDA, it falls apart.

Wayland is off the table for now. Back to Xorg.

## Dead End #2: Flatpak Steam from a TTY

Pop!_OS ships Steam as a Flatpak by default. Running it from a bare TTY produces:

```bash
$ startx /usr/bin/flatpak run com.valvesoftware.Steam
```

```
bwrap: loopback: Failed to create new loopback for /run/user/1000: 
  Permission denied
error: app/com.valvesoftware.Steam not installed for the user
xdg-desktop-portal: D-Bus session bus not available
```

Flatpak sandboxing depends on several system services that only exist inside a proper desktop session: `xdg-desktop-portal`, a running D-Bus session bus (`DBUS_SESSION_BUS_ADDRESS`), and `systemd --user` socket activation. On a bare TTY, none of those are present.

The solution is native (non-Flatpak) Steam. On Pop!_OS:

```bash
sudo apt install steam
```

This installs Steam to `/usr/games/steam`. No sandbox, no portal dependency, launches fine from a bare Xorg session.

## Dead End #3: Missing `video` Group

With native Steam installed, `startx` itself failed before Steam ever launched:

```bash
$ startx ./xinitrc-test -- vt2
```

```
Fatal server error:
(EE) Cannot open /dev/fb0 (Permission denied)
(EE) 
(EE) 
Please consult the The X.Org Foundation support 
        at http://wiki.x.org
 for help. 
(EE) Please also check the log file at "/var/log/Xorg.0.log" for additional information.
(EE) Server terminated with error (1). Closing log file.
```

Xorg needs access to `/dev/fb0` and `/dev/dri/card*` for direct rendering. These devices belong to the `video` and `render` groups:

```bash
$ ls -la /dev/fb0 /dev/dri/card0
crw-rw---- 1 root video  29, 0 May  2 14:33 /dev/fb0
crw-rw---- 1 root video 226, 0 May  2 14:33 /dev/dri/card0
```

My user wasn't in either group:

```bash
$ groups
danko adm cdrom sudo dip plugdev lpadmin sambashare
```

Fix:

```bash
sudo usermod -aG video,render danko
# Log out and back in (or use newgrp video for the current session)
```

After re-login, Xorg could open the devices and `startx` succeeded.

## Dead End #4: Keyboard Not Working In-Game

Xorg started, Steam launched, Noita opened — and then I couldn't move. Mouse worked, keyboard was dead. No WASD, no escape, no anything.

The minimal `xinitrc` I'd written had nothing in it except the Steam launch command. Xorg provides no keyboard layout by default; without an explicit `setxkbmap` call, the X server initializes with an empty keymap.

```bash
# What I had:
exec /usr/games/steam -silent steam://rungameid/881100

# What I needed:
setxkbmap -layout us -model pc105
exec /usr/games/steam -silent steam://rungameid/881100
```

One line. Four hours of debugging to get there.

## Dead End #5: Steam Can't Update (IPv6 Hotspot)

During testing I was on a mobile hotspot — IPv6 only. Steam's updater is 32-bit and uses IPv4 exclusively. The result:

```
Updating Steam...
[----                    ]
Error: http error 0
```

"http error 0" is Steam's way of saying it couldn't establish a TCP connection at all. The 32-bit Steam bootstrap binary doesn't understand IPv6 addresses, so it never even tried.

The workaround for testing was to use `steam -noverifyfiles` to skip the update check. On a proper dual-stack or IPv4 connection this isn't an issue, but it's worth knowing if you're ever debugging Steam from a TTY and it just hangs at update.

## What Works: startx + Native Steam + Minimal xinitrc

The working stack:

1. **Native Steam** (`/usr/games/steam`) — no Flatpak sandbox, no portal dependency
2. **`startx`** with an explicit VT number — ties the X session to your current TTY
3. **Minimal xinitrc** — keyboard layout, screen blanking disabled, then Steam
4. **`-- vt${N}`** argument to `startx` — ensures X doesn't steal a VT at random

The full launcher script I settled on is at `~/tools/noita-tty.sh`.

## The Launcher Script

```bash
#!/bin/bash
# Launch Noita (or Steam) from a TTY using a minimal X11 session.
# No desktop environment needed — just GPU + Xorg + native Steam.
#
# Usage from any TTY:
#   noita          # Launch Noita directly
#   steam          # Launch Steam Big Picture
#
# Switch VTs: Ctrl+Alt+F1/F2/F3 etc.

set -euo pipefail

NOITA_APPID=881100
STEAM_BIN=/usr/games/steam

if [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ]; then
    echo "ERROR: You're already in a graphical session."
    echo "Kill COSMIC first (gpu-mode), then run from a TTY."
    exit 1
fi

if [ ! -x "$STEAM_BIN" ]; then
    echo "ERROR: Native Steam not found at $STEAM_BIN"
    exit 1
fi

touch "$HOME/.Xauthority"

MODE="${1:-noita}"

case "$MODE" in
    steam)
        STEAM_ARGS="-bigpicture"
        echo "Launching Steam Big Picture..."
        ;;
    noita)
        STEAM_ARGS="steam://rungameid/$NOITA_APPID"
        echo "Launching Noita..."
        ;;
    [0-9]*)
        STEAM_ARGS="steam://rungameid/$MODE"
        echo "Launching Steam app $MODE..."
        ;;
    *)
        echo "Usage: $0 [noita|steam|<appid>]"
        exit 1
        ;;
esac

XINITRC=$(mktemp /tmp/xinitrc-game.XXXXXX)
cat > "$XINITRC" << XEOF
#!/bin/sh
sleep 1
/usr/bin/setxkbmap -layout us -model pc105
xset s off -dpms
xset r rate 250 30
$STEAM_BIN -silent -no-browser $STEAM_ARGS
XEOF
chmod +x "$XINITRC"

trap "rm -f '$XINITRC'" EXIT

VTNUM=$(tty | grep -o '[0-9]*$')
startx "$XINITRC" -- -quiet "vt${VTNUM}" -xkblayout us -xkbmodel pc105
```

A few decisions worth noting:

**The temporary xinitrc.** The script creates a new `xinitrc` on each run via `mktemp`. This means the Steam launch command is baked into the file at runtime, which lets the case statement cleanly pick between Noita, Big Picture, or an arbitrary App ID without needing multiple scripts.

**`xset s off -dpms`.** Disables the screen blanker and DPMS power management. Without this, your monitor goes to sleep mid-game.

**`xset r rate 250 30`.** Sets keyboard repeat: 250ms delay before repeat starts, 30 repeats per second. Without this, held keys in a game feel sluggish.

**`-no-browser`.** Suppresses Steam's built-in browser window on startup. Fewer resources, cleaner session.

**`vt${VTNUM}`.** Xorg starts on the same VT you're logged into. This is important — if you omit it, X grabs a new VT and Ctrl+Alt+F{N} switching gets confusing.

Aliases that wire it up:

```bash
# ~/.bashrc
alias noita='~/tools/noita-tty.sh noita'
alias steam='~/tools/noita-tty.sh steam'
alias steam-kill='pkill -f "steam|steamwebhelper|reaper" 2>/dev/null; pkill Xorg 2>/dev/null; true'
```

## TTY Recovery Tools

When something crashes mid-game, you can end up with a frozen TTY, a stale X lock file, and Steam processes still holding GPU memory. The recovery script handles all of it.

```bash
#!/bin/bash
# Reset a frozen TTY by killing all processes on it.
# agetty respawns automatically, giving a fresh login prompt.
#
# Usage:
#   tty-reset 5        # Reset tty5
#   tty-reset 5 6      # Reset tty5 and tty6

if [ $# -eq 0 ]; then
    echo "Usage: tty-reset <tty#> [tty# ...]"
    echo "Example: tty-reset 5 6"
    echo ""
    echo "Current TTY usage:"
    who
    exit 1
fi

for N in "$@"; do
    DEV="/dev/tty${N}"
    if [ ! -e "$DEV" ]; then
        echo "tty${N}: device not found"
        continue
    fi

    PIDS=$(sudo fuser "$DEV" 2>/dev/null | tr -s ' ')
    if [ -z "$PIDS" ]; then
        echo "tty${N}: already free"
        continue
    fi

    echo "tty${N}: killing PIDs${PIDS}"
    for PID in $PIDS; do
        COMM=$(ps -p "$PID" -o comm= 2>/dev/null)
        # Don't kill systemd-logind or agetty
        if [ "$COMM" = "systemd-logind" ] || [ "$COMM" = "agetty" ]; then
            continue
        fi
        sudo kill "$PID" 2>/dev/null
    done

    sleep 1

    # Force-kill anything still hanging
    REMAINING=$(sudo fuser "$DEV" 2>/dev/null | tr -s ' ')
    for PID in $REMAINING; do
        COMM=$(ps -p "$PID" -o comm= 2>/dev/null)
        if [ "$COMM" = "systemd-logind" ] || [ "$COMM" = "agetty" ]; then
            continue
        fi
        sudo kill -9 "$PID" 2>/dev/null
    done

    sleep 1
    echo "tty${N}: reset"
done

# Clean stale X locks while we're at it
sudo rm -f /tmp/.X*-lock /tmp/xinitrc-game.* /tmp/serverauth.* 2>/dev/null
```

`fuser` finds all PIDs with an open file handle on `/dev/tty{N}`. The script skips `systemd-logind` and `agetty` — killing either of those would break your login infrastructure and require a reboot. Everything else gets SIGTERM, then SIGKILL if it's still alive after one second.

The cleanup at the end removes stale X lock files (`/tmp/.X*-lock`). These are what cause the `startx: error for display :0` error you get if you try to launch X again after a hard crash without cleaning up first.

## The Full Workflow

With everything wired up, the workflow is clean:

```bash
# 1. Switch to a free TTY — Ctrl+Alt+F3 (or F4, F5, whatever's open)
# 2. Log in
# 3. Launch the game
$ noita

Launching Noita...
# X starts, Steam launches silently, Noita opens fullscreen

# Play until done, then quit Noita normally
# Steam exits, X shuts down, you're back at the TTY prompt

# 4. If Steam doesn't clean itself up:
$ steam-kill

# 5. If the TTY is frozen and you need to recover from a different TTY:
$ tty-reset 3
tty3: killing PIDs 48291 48334 48891
tty3: reset
```

Switching back to COSMIC is just Ctrl+Alt+F1 (or wherever your desktop session lives).

## The GPU Difference

This is the part worth quantifying. With COSMIC running, `nvidia-smi` shows:

```
+-----------------------------------------------------------------------------+
| Processes:                                                                  |
|  GPU   GI   CI        PID   Type   Process name              GPU Memory    |
|        ID   ID                                                 Usage        |
|=============================================================================|
|    0   N/A  N/A      2341    G   /usr/lib/xorg/Xorg              312MiB    |
|    0   N/A  N/A      2487    G   ...sktop/cosmic-comp             89MiB    |
+-----------------------------------------------------------------------------+
```

About 400MB of VRAM committed to the desktop stack before the game even starts. On a 12GB card that's not catastrophic, but it's VRAM that isn't available for game assets, and compositor scheduling introduces frame timing jitter that pure fullscreen doesn't have.

From the TTY, that block is empty. The game gets the full card.

## What You Learned

- `cage` (minimal Wayland compositor) fails with NVIDIA proprietary drivers on bare TTY — the initialization path requires a desktop session that cage doesn't set up
- Flatpak apps depend on `xdg-desktop-portal` and a D-Bus session bus; neither exists on a bare TTY, so native packages are required
- Xorg needs the `video` and `render` groups for `/dev/dri/card*` access — missing groups produce confusing "permission denied" errors that look like Xorg config problems
- X starts with no keyboard layout unless you explicitly call `setxkbmap` in your xinitrc
- Pass `-- vt${N}` to `startx` where `N` is your current TTY number — otherwise X grabs a random VT and recovery gets complicated
- `fuser /dev/tty{N}` lists all PIDs on a given terminal; skip `systemd-logind` and `agetty` when killing them or you'll need a reboot
