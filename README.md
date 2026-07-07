# Termina

**Your whole terminal workflow, one wall.**

Termina is a local terminal wall. Open as many terminals as you want — shells,
Codex CLIs, Claude CLIs, builds, REPLs — name each one, and run them all side by
side in one clean window. Every tile is a real, fully-interactive terminal.

- **Unlimited windows.** Hit **+ New terminal** and add as many as you need.
- **Name each window** whatever you like. Your layout is saved between launches.
- **Any terminal type per window:** PowerShell, Codex CLI, Claude CLI, Command
  Prompt, WSL/bash, Python, Node — or your own (see config below).
- **Real terminals.** Full interactivity via a proper PTY (the same tech behind
  VS Code's terminal) rendered with xterm.js. Colors, cursor, everything.
- **Local & private.** Binds to `127.0.0.1` only, guarded by a per-launch token.
  Nothing off your machine — and no web page — can reach your shells.

## Run it

```powershell
cd C:\Users\jorda\Termina
npm install     # first time only
npm start       # open the printed http://127.0.0.1:7420/?token=... URL
```

Or launch it like an app (adds a **Termina** entry to your Start Menu that opens
a chromeless app window):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\Install-Termina-StartMenu.ps1
```

## Using the wall

- **+ New terminal** adds a window. Give it a name, pick a type, and it opens.
- **Restart** relaunches that terminal, **Clear** wipes its view, **Expand**
  opens a large full-screen view (still fully interactive), **×** removes it.
- **2 / 3 / 4** sets how many columns the wall uses.
- Run several of the same type at once — e.g. three independent Codex CLIs.

## Custom terminal types

Copy `termina.config.example.json` to `termina.config.json` (next to
`server.js`) to define your own terminal types — a label, a command, argv, and a
working directory. Commands are predefined server-side and run on your machine
as you.

## Architecture

- `server.js` — Node HTTP server: serves the UI, a small REST API
  (`/api/profiles`, `/api/sessions/:id/start|stop`), and a WebSocket PTY bridge
  (`/pty`) backed by `node-pty`. Sessions are per-window and independent.
- `profiles.js` — terminal-type templates + config loader.
- `public/` — the wall UI (`index.html`, `app.js`, `styles.css`) with vendored
  `xterm.js` (no CDN, fully offline).
- `scripts/` — Windows launcher, icon generator, Start Menu installer.

## Requirements

- Windows, Node.js 20+. Microsoft Edge or Google Chrome for the app-window
  launcher (otherwise it opens in your default browser).
