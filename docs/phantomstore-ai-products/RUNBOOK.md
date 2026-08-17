# Local Preview Runbook

## Scope

This runbook operates one loopback-only Node.js process and one local JSON document. It is not a production runbook.

## Start

```powershell
npm ci --ignore-scripts
npm run prisma:generate
npm run migrate --workspace @phantomforce/phantomstore-ai-products
npm run dev:phantomstore-ai-products
```

Expected URL: `http://127.0.0.1:4182`
Health: `http://127.0.0.1:4182/api/v1/health`

The package itself does not require Prisma. `prisma:generate` is needed only before repository-wide server build/typecheck gates in a clean checkout.

## Data

Default: `packages/phantomstore-ai-products/.local/phantomstore-ai-products.json`.

Set `PHANTOMSTORE_AI_PRODUCTS_DATA` to use a dedicated file. Migration creates schema v2 when the file is absent, migrates v1 data by backfilling source and consent records, preserves recognized collections, and rejects future schemas. Writes use a temporary file and atomic rename. Only one process may write a file.

## Synthetic operational check

1. Confirm health reports ten products, `local_preview`, external models off, and zero spend.
2. Open a product and grant consent.
3. Load its reversible demo; confirm nothing persists until Create.
4. Create the domain artifact and run its complete core loop.
5. Inspect metric unit, formula, inputs, rounding, method, warnings, provenance, product-specific core records, provider path, and cost.
6. Correct and accept; confirm source revision and fields remain unchanged.
7. Edit a source, confirm the prior analysis becomes stale, recompute, and review the new version.
8. Reload and confirm persistence.
9. Export portable JSON or exercise duplicate/archive/delete/recovery through the API.

Automated equivalent: `npm run test:phantomstore-ai-products`.

## Controls

- Workspace membership, role, entitlement, product, analysis, and job flags fail closed.
- Retryable create/update/duplicate/analyze/review mutations require idempotency keys.
- Updates require the expected revision and stale prior analysis.
- Local request bodies are capped at 1 MB and text fields are bounded.
- Local rate limit is 120 API requests per minute per token.
- Product, analysis, job, expensive-operation, and provider switches live under workspace flags.
- Durable local jobs can be queued, running, awaiting review, succeeded, failed, canceled, dead-lettered, or stale; retry is bounded.
- Consent withdrawal restricts dependent artifacts and stales their analyses. Source deletion is explicit and dependency-aware.
- Privacy-safe traces record identifiers, timing, and status without raw source or artifact content.
- Audit events contain identifiers and action metadata, never raw artifact/evidence content.
- Metrics and idempotency records are bounded to 1,000 each.

## Recovery

Deletion requires `X-Confirm-Delete: DELETE <artifact-id>`, removes the artifact from active state, and retains a recoverable record for 30 days. The recovery endpoint is owner-only. Archive is reversible separately. For file corruption, stop the process and restore a known-good copy. Never lower `schemaVersion` by hand after `SCHEMA_TOO_NEW`.

## Release verification

```powershell
npm run test:phantomstore-ai-products
npm run build:phantomstore-ai-products
npm run build
npm run typecheck
npm run test:phantomstore
git diff --check
```

Before shared or network use, replace fixed tokens, local file storage, and synchronous jobs with approved identity, relational storage, encryption, secrets, queue/workers, object storage, file scanning, backup/purge, observability, and incident operations.
