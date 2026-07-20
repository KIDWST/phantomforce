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
- `POST /api/phantomplay/edge/leases`
- `POST /api/phantomplay/edge/leases/:id/complete`

## Next data-plane step

The packaged PhantomPlay desktop runtime must download leased chunks from approved game storage, verify each SHA-256 digest before moving it into the local cache, enforce the configured throttles, and report completion. It must never execute a cached file merely because it was leased.

