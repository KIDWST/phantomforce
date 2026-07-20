# @phantomforce/phantomplay-edge-worker

The packaged data-plane worker for the PhantomPlay edge network. See
[`docs/architecture/PHANTOMPLAY_EDGE_NETWORK.md`](../../docs/architecture/PHANTOMPLAY_EDGE_NETWORK.md)
for the full trust model. This package implements exactly the "next data-plane step" that doc
calls out: it downloads chunks the control plane has leased to this desktop, verifies every
SHA-256 digest before the bytes are admitted into the local cache, throttles itself against the
node's own configured limits, and reports completion. **It never executes, imports, or evals
anything it downloads** — `scripts/test-worker.mjs` includes a static scan that fails the build
if an execution primitive (`child_process`, `eval`, `new Function`, dynamic `import()`) is ever
added to `src/worker.mjs`.

## What this is not (yet)

- Not a packaged desktop app. There is no Electron shell here — PhantomPlay today runs entirely
  in-browser (`app/games/*.html`), and a real "packaged" experience means wrapping this worker
  in a desktop shell (see `C:\Users\jorda\Termina`'s `electron-main.cjs` for this repo's existing
  pattern of running Electron unpacked from source). That packaging step is a deliberate
  fast-follow, not part of this pass — the worker logic needed to exist and be tested first.
- Not a peer-to-peer relay. It only ever talks to the PhantomForce control plane's own chunk
  endpoints (`GET .../leases/:id/chunks/:sha256`). Serving cached chunks out to other players
  (the `room_relay`/`match_host` lanes) stays disabled until those transports and their abuse
  controls exist, per the architecture doc.
- Not a long-lived-credential system. Today it authenticates with the same bearer token a
  logged-in browser session uses (`PHANTOMFORCE_EDGE_BEARER_TOKEN`), which expires with that
  session. A dedicated long-lived device credential is a reasonable next step but is out of
  scope here — this pass reuses the existing auth boundary rather than extending it.

## Running it

```sh
export PHANTOMFORCE_EDGE_API_BASE=http://127.0.0.1:5190
export PHANTOMFORCE_EDGE_BEARER_TOKEN=<a real session bearer token>
node bin/worker.mjs
```

Environment variables (all optional except the bearer token):

| Variable | Default | Meaning |
|---|---|---|
| `PHANTOMFORCE_EDGE_API_BASE` | `http://127.0.0.1:5190` | PhantomForce API origin |
| `PHANTOMFORCE_EDGE_BEARER_TOKEN` | *(required)* | Session bearer token; the worker refuses to start without one |
| `PHANTOMFORCE_EDGE_STATE_DIR` | `~/.phantomplay` | Where the node's installation ID and enrolled node ID are persisted |
| `PHANTOMFORCE_EDGE_CACHE_DIR` | `<state dir>/edge-cache` | Where verified chunks are cached, one file per `manifestId/sha256` |
| `PHANTOMFORCE_EDGE_POLL_MS` | `15000` | Heartbeat/lease-check interval |
| `PHANTOMFORCE_EDGE_LABEL` | `<platform>-desktop` | Human-readable node label |
| `PHANTOMFORCE_EDGE_MAX_DISK_GB` | `25` | User's own cap; also reported as `availableDiskGb` |
| `PHANTOMFORCE_EDGE_MAX_MBPS` | `10` | Also used as the interim download-pacing rate — see the code comment on `createThrottle` in `src/worker.mjs` |
| `PHANTOMFORCE_EDGE_MAX_CPU_PCT` / `PHANTOMFORCE_EDGE_MAX_MEMORY_MB` | `20` / `1024` | Reported resource limits |
| `PHANTOMFORCE_EDGE_ALLOW_METERED` | `false` | Set to `true` to allow use on a metered connection |

First run enrolls the node (requires the explicit `phantomplay-edge-v1` consent the control plane
already enforces — running this worker at all *is* that consent) and persists the resulting node
ID; subsequent runs reuse it. `Ctrl+C` stops cleanly after the current cycle.

## Testing

```sh
npm test
```

Runs `scripts/test-worker.mjs`: hash verification, cache admission (including rejecting
tampered bytes), a mocked end-to-end lease-processing cycle (download → verify → cache →
report), a tampered-chunk-on-the-wire case (must not be admitted, lease must not complete), the
already-cached fast path (must not re-download), throttle pacing, and the static
no-execution-primitives scan. It does not require a running server — the HTTP layer is mocked
to match the real routes' documented shape. The real routes themselves are covered separately by
`server/scripts/test-phantomplay-edge-storage.ts`.
