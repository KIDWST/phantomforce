# PhantomBot

<p align="center">
  <img src="https://img.shields.io/badge/Product-PhantomBot-18F58A?style=for-the-badge" alt="PhantomBot">
  <img src="https://img.shields.io/badge/Platform-macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-111914?style=for-the-badge" alt="macOS, Windows, and Linux">
  <a href="../../THIRD_PARTY_NOTICES.md"><img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License: MIT"></a>
</p>

**PhantomBot is PhantomForce’s private local operator for macOS, Windows, and
Linux.** It provides persistent agent sessions, live tool activity, project and
file context, previews, voice, settings, and native service supervision in a
distinct PhantomForce desktop product.

PhantomBot is powered by the MIT-licensed
[Hermes Agent](https://github.com/NousResearch/hermes-agent) kernel from Nous
Research. That engine attribution and license are preserved in source and in
every packaged distribution; PhantomBot’s product identity and integration
layer are separate.

<table>
<tr><td><b>Chat with the full operator</b></td><td>Streaming responses, live tool activity, structured tool summaries, and persistent PhantomBot task history.</td></tr>
<tr><td><b>Side-by-side previews</b></td><td>Render web pages, files, and tool outputs in a right-hand pane while you keep chatting.</td></tr>
<tr><td><b>File browser</b></td><td>Explore and preview the working directory without leaving the app.</td></tr>
<tr><td><b>Voice</b></td><td>Talk to PhantomBot and hear it back.</td></tr>
<tr><td><b>Settings & onboarding</b></td><td>Manage providers, models, tools, and credentials from a real UI. First-run setup gets you to your first message in seconds.</td></tr>
<tr><td><b>Stays current</b></td><td>Built-in updates pull the latest agent and rebuild the app in place.</td></tr>
</table>

---

## Install

### Local development install

From a compatible Hermes kernel checkout, the internal development launcher is:

```bash
hermes desktop
```

This builds and launches PhantomBot against the local kernel checkout. If the
desktop cannot find a usable runtime or saved remote connection, first launch
can prepare the managed local engine or connect to a compatible gateway.

### Prebuilt installers

Do not distribute installers built from an unpushed local product commit. Run
`npm run phantombot:doctor` from the repository root; a consumer release is
eligible only when the PhantomBot product commit exists on its configured
product remote and the security/package gates pass.

Release builds must name the published PhantomBot fork explicitly. The release
gate rejects Nous’ upstream repository as a product source, so a branded
package can never silently reinstall the upstream desktop:

```powershell
$env:PHANTOMBOT_PRODUCT_REPOSITORY = "https://github.com/OWNER/phantombot.git"
$env:PHANTOMBOT_BUILD_PIN_COMMIT = "<published PhantomBot commit>"
npm run phantombot:package
```

---

## Updating

The app checks for updates in the background and offers a one-click update when one is ready. You can also update any time from the CLI:

```bash
hermes update
```

---

## Requirements

The installer handles everything for you (Python 3.11+, a portable Git, ripgrep).

---

## Development

Want to hack on the app itself? Install workspace deps from the repo root once, then run the dev server from this directory:

```bash
npm install          # from repo root — links apps/desktop, web, apps/shared
cd apps/desktop
npm run dev          # Vite renderer + Electron, which boots the Python backend
```

Point the app at a specific source checkout, or sandbox it away from your real config:

```bash
# throwaway HERMES_HOME, separate Electron userData, distinct app name to avoid the single-instance lock
../scripts/dev-sandbox.sh npm run dev
HERMES_DESKTOP_HERMES_ROOT=/path/to/clone npm run dev
HERMES_HOME=/tmp/throwaway npm run dev
npm run dev:fake-boot   # exercise the startup overlay with deterministic delays
```

### Building installers

```bash
npm run dist:mac     # DMG + zip
npm run dist:win     # NSIS + MSI
npm run dist:linux   # AppImage + deb + rpm
npm run pack         # unpacked app under release/ (no installer)
```

Installers are published only from the PhantomBot product release workflow.
macOS/Windows signing and notarization use the relevant release credentials
(`CSC_LINK` / `CSC_KEY_PASSWORD` / `APPLE_*` for macOS, `WIN_CSC_*` for
Windows).

### How it works

The packaged app ships the Electron shell and a native React chat surface. On
first launch it can install the Hermes Agent runtime into `HERMES_HOME`
(`~/.hermes`, or `%LOCALAPPDATA%\hermes` on Windows), using the same layout as a
CLI install.

The app has three boundaries:

- **Electron** resolves and validates a runnable backend, owns native
  filesystem/git/window capabilities, and exposes a narrow preload bridge.
- **React** owns the Desktop routes, panes, interaction state, and
  `@assistant-ui/react` transcript.
- **Hermes Agent** runs as a headless `hermes serve` process and exposes the
  `tui_gateway` JSON-RPC/WebSocket API. The renderer connects through
  [`apps/shared`](../shared/), which is also used by the browser dashboard.

Backend resolution is an ordered ladder:

1. `HERMES_DESKTOP_HERMES_ROOT`
2. the current source checkout during development
3. a completed managed install
4. `HERMES_DESKTOP_HERMES`, or `hermes` on `PATH`
5. a system Python that can import the Hermes runtime
6. the first-launch bootstrap installer

Candidates are probed before use; an existing shim or interpreter is not enough.
A runtime that predates `serve` falls back to headless
`dashboard --no-open`. This is compatibility for the backend command only and
does not launch or embed the dashboard UI.

The Electron orchestration entry point is `electron/main.ts`; pure resolution,
probe, hardening, and platform policies live in focused modules beside it. The
renderer is under `src/`, with shared atoms in `src/store` and transport/native
adapters in `src/lib`.

Before changing the app, read:

- [`AGENTS.md`](./AGENTS.md): architecture, state ownership, resolver/fallback,
  transport, performance, and testing rules.
- [`DESIGN.md`](./DESIGN.md): visual system, information architecture, motion,
  direct manipulation, and keyboard behavior.

### Connections, projects, and switching

Desktop supports a managed local backend, explicit remote gateways, and Hermes
Cloud connections. Remote and cloud modes use the same remote-capability path;
authentication and discovery differ, not the renderer feature model.

When no usable local runtime or saved remote connection exists, the first-run
screen offers **Connect an existing backend** before starting the local installer.
Desktop probes the gateway to discover token or OAuth authentication, requires a
successful HTTP and WebSocket connection test, and saves the connection using
the same encrypted Desktop configuration used by Settings. A saved remote
connection bypasses this choice on later launches. The regular Desktop build
still includes the local-install option; this is a remote operating mode, not a
separate client-only application.

In remote mode the gateway host is the execution boundary: agent tools,
terminal commands, and file operations run against the remote Hermes host, not
the computer displaying the Desktop UI.

Projects are the workspace abstraction. A project may own multiple folders,
repositories, worktrees, and sessions; a bare new chat remains detached unless
the user enters a project or configures a default project directory. Use the
Projects UI rather than adding a second per-session folder-picker workflow.

Changing profiles or connection modes is a soft workspace switch, not another
cold boot. The shell and current management overlay remain mounted while
gateway-bound nanostores are wiped, query-backed data is invalidated, and the
new connection repopulates skeletons. This prevents rows or transcripts from
the previous gateway bleeding into the next one.

### Verification

Run before opening a PR (lint may surface pre-existing warnings but must exit cleanly):

```bash
npm run fix
npm run typecheck
npm run lint
npm run test:ui
npm run test:desktop:platforms
```

Run `npm run test:desktop:all` for install, boot, update, packaging, or other
release-path changes.

### Troubleshooting

Boot logs land in `HERMES_HOME/logs/desktop.log` (includes backend output and recent Python tracebacks) — check it first if the app reports a boot failure.

**macOS / Linux:**

```bash
# Force a clean first-launch setup
rm "$HOME/.hermes/hermes-agent/.hermes-bootstrap-complete"
# Rebuild a broken Python venv
rm -rf "$HOME/.hermes/hermes-agent/venv"
# Reset a stuck macOS microphone prompt (macOS only)
tccutil reset Microphone com.nousresearch.hermes
```

**Windows (PowerShell):**

```powershell
# Force a clean first-launch setup
Remove-Item "$env:LOCALAPPDATA\hermes\hermes-agent\.hermes-bootstrap-complete"
# Rebuild a broken Python venv
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\hermes\hermes-agent\venv"
```

> The default Hermes home on Windows is `%LOCALAPPDATA%\hermes`. Set the `HERMES_HOME` env var if you've relocated it.

---

## Upstream kernel resources

- [Hermes Agent source](https://github.com/NousResearch/hermes-agent)
- [Hermes Agent documentation](https://hermes-agent.nousresearch.com/docs/)

---

## License

MIT — see [LICENSE](../../LICENSE) and
[THIRD_PARTY_NOTICES](../../THIRD_PARTY_NOTICES.md).

PhantomBot product layer by PhantomForce. Hermes Agent kernel by
[Nous Research](https://nousresearch.com).
