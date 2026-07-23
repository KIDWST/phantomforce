# PhantomForce Creative OS Lifecycles

## Purpose

This document defines the authoritative boundaries introduced for Nexus modules 12–15. It is intentionally narrower than a provider-specific integration: the durable records remain valid when a generation, storage, browser, OAuth, or publishing provider is unavailable.

## Media generation

- Source of truth: tenant-scoped JSON documents owned by `media-generation-store.ts`.
- Stable identity: every job has a server-generated ID and an idempotency key.
- Authoritative states: `queued`, `running`, `completed`, `failed`, and `cancelled`.
- Completion rule: `completed` requires at least one verified output asset reference. A provider acknowledgement, preview, or generated metadata is not completion.
- Recovery: active jobs hydrate after refresh; running requests can be cancelled; failed or cancelled jobs can be retried as a new attempt linked by `retryOf`.
- UI-only state: elapsed timers, mounted AbortControllers, the active tab, and temporary prompt controls.
- Rollback: remove the four `/api/media-generation/jobs` routes and the Media Lab client module. Existing JSON records can remain inert and are not read by older clients.

## Content assets

- Source of truth: a versioned tenant-scoped metadata index plus checksum-addressed blobs.
- Ingest rule: declared MIME must match the file signature. Unknown or spoofed types are rejected.
- Deduplication: identical bytes share a blob; tenant metadata records remain isolated.
- Deletion rule: browser deletion archives the metadata first. Restore is available during retention. A blob is unlinked only after its final metadata reference is purged.
- Read rule: bytes are checksum-verified before being returned.
- UI-only state: object URLs, local thumbnails, selection, filters, and transient upload progress.
- Rollback: revert the provider routes/client calls. The v2 index preserves legacy IDs and can remain on disk.

## PhantomCut

- Source of truth: a schema-versioned, tenant-scoped browser project record.
- Persisted fields: title, aspect, export resolution, clip order, timing, transforms, text, transitions, fit, fades, mute, and volume.
- Local-file boundary: browser object URLs cannot survive refresh. PhantomCut explicitly reports skipped PC-only clips instead of claiming they were persisted.
- Export rule: export can be cancelled; a browser without a supported `MediaRecorder` WebM path receives an explicit unsupported message.
- Rollback: remove the project save/restore calls. Existing browser records are harmless and can be cleared by key prefix.

## Content publication

- Source of truth: tenant-scoped publication records owned by `content-publication-store.ts`.
- Stable identity: every draft or schedule has a server ID and idempotency key.
- Authoritative states: `draft`, `scheduled`, `approval_required`, `publishing`, `published`, `partial`, `failed`, `cancelled`, and `manual_record`.
- External-effect rule: browser draft/save/schedule actions never post externally. A publication enters `publishing` only with an explicit approval ID.
- Verification rule: a channel can be marked published only with a provider receipt. Mixed channel results become `partial`, preserving each channel’s outcome.
- Asset rule: source media and thumbnail are separate stable references.
- Failure rule: if the backend is unavailable, the browser preserves the local draft and clearly labels it local-only.
- Rollback: remove the publication routes/client persistence call. Local drafts continue to work without being mistaken for synchronized records.

## Security and tenancy

- Every route resolves and authorizes the signed-in business tenant on the server.
- IDs from another tenant resolve as not found within the requesting tenant’s document.
- Admin-only provider result recording prevents a browser client from fabricating external success.
- No route in this lifecycle sends, uploads, or publishes to an external service by itself.

## Verification

The release gate covers:

- MIME spoof rejection, checksum deduplication, restore, reference-safe purge, and cross-tenant reads.
- concurrent generation jobs, refresh persistence, idempotency, cancellation, retry lineage, and verified-output completion.
- publication timezone normalization, approval gating, provider receipts, partial success, cancellation, and tenant isolation.
- UI wiring for durable generation, cancellation, retry, asset archive/restore, draft preservation, separate thumbnails, PhantomCut save/restore, export cancellation, and unsupported browsers.

