# Termina

**A CCTV-style wall of live terminals for one local machine.**

Termina is a standalone terminal workflow manager. Instead of losing track of
scattered terminal windows, you see a grid of monitors — each tile is a real,
live terminal you pick from a dropdown: a shell, a REPL, a dev server, an ops
shell, an AI-operator shell, or an authorized lab profile.

It is **local-only** (binds `127.0.0.1`), single-machine, and runs **your own
shells** as you. It is not a remote-control tool and has no accounts or cloud.

## Run it

```powershell
cd C:\Users\jorda\Termina
npm install        # first time only (installs node-pty, ws, xterm)
npm start          # then open the printed http://127.0.0.1:7420/?token=... URL
```

Or launch it like an app:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\Install-Termina-StartMenu.ps1
```

That adds a **Termina** entry to your Start Menu. Clicking it starts the engine
and opens the wall in a chromeless app window; closing the window stops it.

## Using the wall

- Pick a **layout**: 2×2, 3×2, or 3×3.
- Each tile has a **dropdown** to choose which terminal it shows.
- **Start** spawns the session and streams it live (full xterm.js terminal —
  colors, cursor, interactive input). **Stop** kills it. **Clear** wipes the
  view. **Expand** opens the same session full-screen. **Focus** puts the
  cursor in the tile so you can type.
- The same terminal can appear on multiple tiles (mirrored monitors).

## Terminal profiles

Built-in defaults: CONTROL, SHELL A, SHELL B, GIT, NODE, PYTHON, OPS / DOCKER,
CODEX, CLAUDE / FABLE, and a blocked KALI LAB slot.

To define your own, copy `termina.config.example.json` to
`termina.config.json` (next to `server.js`). Your profiles replace the
built-ins. Each is a fixed command + argv with a working directory; commands
are never assembled from anything the browser sends.

## Safety model

- **Local only:** the engine listens on `127.0.0.1`. Nothing off this machine
  can reach it.
- **Per-launch token:** every run mints a random token, injected into the page.
  The REST API and every PTY WebSocket require it, plus a same-origin check, so
  no other local process or web page can drive your shells.
- **No arbitrary commands from the client:** the browser only sends a profile
  id and keystrokes to an already-started session. Profiles are predefined
  server-side.
- **Minimal environment:** spawned terminals do not inherit Termina's own
  process env (which holds the token).
- **Nothing auto-runs:** AI-operator tiles just open a shell. The KALI LAB tile
  is blocked until you explicitly configure an authorized profile. No scans, no
  offensive automation, no persistence, no stealth. Owned/authorized machines
  only.

## Architecture

- `server.js` — Node HTTP server: serves the UI, a small REST API
  (`/api/profiles`, `/api/sessions/:id/start|stop`), and a WebSocket PTY bridge
  (`/pty`) backed by `node-pty`.
- `profiles.js` — the profile registry and config loader.
- `public/` — the wall UI (`index.html`, `app.js`, `styles.css`) with
  vendored `xterm.js` (no CDN).
- `scripts/` — the Windows launcher, icon generator, and Start Menu installer.

If `node-pty` cannot load on a machine, install fails loudly rather than
pretending; on a working machine it uses a real Windows ConPTY.

## Requirements

- Windows (uses PowerShell/ConPTY defaults; profiles are configurable for other
  shells).
- Node.js 20+.
- Microsoft Edge or Google Chrome for the app-window launcher (otherwise it
  opens in your default browser).
