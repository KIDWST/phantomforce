# PhantomPlay Edge Network v1

## Purpose

PhantomPlay's downloadable runtime can use explicitly enrolled user-owned desktops to distribute large game asset packs. PhantomForce remains the control plane; it does not cloud-stream games from Jordan's PC.

## Active lane

Version 1 enables only `asset_cache`:

1. A workspace manager registers a game/version manifest.
2. The server normalizes every chunk to a SHA-256 digest and byte count.
3. The control plane signs the complete manifest with `PHANTOMFORCE_EDGE_MANIFEST_SECRET`.
4. An opted-in desktop sends heartbeats with its user-defined resource limits and available cache capacity.
5. The control plane assigns a short lease to an eligible node.
6. The desktop reports the exact cached chunk hashes. Missing or altered chunks fail verification.

Room relay and match hosting remain disabled until their transports and abuse controls are implemented and tested.

## Trust boundaries

- Enrollment requires explicit `phantomplay-edge-v1` consent.
- Nodes are tenant-scoped and actor-owned.
- Installation IDs are stored only as tenant-bound SHA-256 hashes and are never returned by the API.
- No arbitrary remote commands, executable uploads, local paths, credentials, or raw IP addresses are accepted.
- No inbound device ports or direct peer connections are enabled by default.
- Users can pause or fully unenroll; active leases are cancelled on unenrollment.
- Disk, upload bandwidth, CPU, memory, and metered-network use are bounded by the user's settings.
- Production refuses to sign manifests without `PHANTOMFORCE_EDGE_MANIFEST_SECRET`.

## API

- `GET /api/phantomplay/edge`
- `POST /api/phantomplay/edge/nodes`
- `POST /api/phantomplay/edge/nodes/:id/heartbeat`
- `PATCH /api/phantomplay/edge/nodes/:id`
- `POST /api/phantomplay/edge/manifests` (workspace manager)
- `POST /api/phantomplay/edge/manifests/:id/chunks/:sha256` (workspace manager; uploads chunk bytes)
- `POST /api/phantomplay/edge/leases`
- `GET /api/phantomplay/edge/leases/:id/chunks/:sha256` (the lease's own node only)
- `POST /api/phantomplay/edge/leases/:id/complete`

## Approved game storage

Chunk bytes are stored on local disk under `PHANTOMFORCE_EDGE_STORAGE_PATH` (default
`.phantom/phantomplay-edge-storage/<manifestId>/<sha256>`), completely separate from the JSON
control-plane store — the control plane only ever holds hash/size metadata, never bytes. A
manager uploads chunk bytes for a hash that must already exist in a signed manifest; the server
re-hashes the upload and rejects anything that doesn't match, rejects chunks over
`EDGE_CHUNK_MAX_UPLOAD_BYTES` (12 MiB — larger asset packs are re-chunked smaller, not raised),
and only serves bytes back out to the exact node holding an active, non-expired lease naming
that hash, re-verifying the hash again on every read as a defense-in-depth check against on-disk
tampering or bit-rot. See `server/scripts/test-phantomplay-edge-storage.ts` for the full boundary
test (manager-only upload, hash/size verification, tenant isolation, actor isolation, lease
scoping, no serving after a lease completes).

## Data-plane worker

`packages/phantomplay-edge-worker` implements the desktop side: it enrolls (first run only),
heartbeats, downloads any chunks assigned to it via the lease-scoped endpoint above, verifies
each SHA-256 digest a second time client-side before writing it into the local cache (atomic
temp-file-then-rename, so a crash mid-download can never leave a corrupt file at the final
cache path), throttles itself against the node's own configured limits, and reports back only
the hashes it actually verified. Chunks that fail verification are discarded, not retried in
that pass, and a lease is never reported complete unless every one of its chunks verified. The
worker has no code-execution path at all — no subprocess spawning, no `eval`, no dynamic
`import()` of anything it downloads — enforced by a static source scan in its own test suite
(`packages/phantomplay-edge-worker/scripts/test-worker.mjs`), not just a docstring promise.

It ships today as a plain Node module (`node bin/worker.mjs`), not yet wrapped in a packaged
desktop app — see that package's README for why that's a deliberate, separate fast-follow
rather than part of this pass.

## Next data-plane step

Wrap the worker in a real packaged desktop shell (Electron, following this repo's existing
Termina pattern of running unpacked from source) so enrollment/consent happens through a UI
instead of environment variables, and replace the worker's reliance on a browser session's
short-lived bearer token with a dedicated long-lived device credential scoped to the edge
network only.

