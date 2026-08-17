# Milestone 2 Security and Privacy Review

Date: 2026-08-17
Scope: `packages/phantomstore-ai-products` plus repository dependency and secret gates
Deployment: isolated local preview only

## Controls exercised

- Workspace predicates are mandatory in every Milestone 2 repository call. A known foreign artifact ID and a random ID return the same non-enumerating response.
- Local identity fixtures implement the production-shaped assertion contract; the production identity adapter is disabled instead of simulating OAuth.
- Roles, product entitlements, plan limits, product flags, analysis/job switches, expensive-operation switch and external-provider switch fail closed server-side.
- Product consent is represented by durable consent records linked to source objects. Withdrawal restricts sources/artifacts and stales analyses; restoration makes recomputation available; source deletion removes inaccessible content from export; reviewers cannot override consent policy.
- Mutations use collision-aware idempotency. Optimistic revisions reject stale writes.
- Analysis jobs persist queued state before work, expose explicit phases, preserve input digests, survive a simulated worker interruption, retry, cancel, await human review, and complete only after review.
- Audit and trace records omit source bodies. Traces contain request/correlation/job identifiers, hash-safe tenant identity, product, operation, duration, result, stable error, retry count, local model route and zero cost.
- Destructive paths require exact confirmation and are repeat-safe. Deleted source content is omitted from portable exports while lifecycle/audit metadata remains.
- The HTTP layer exercises the one-megabyte body limit, CSP, safe headers, path traversal defense, rate-safe error envelopes, and no stack/provider/private-object leakage.

Automated evidence:

- `tests/milestone2-foundation.test.mjs`
- `tests/milestone2-api-security.test.mjs`
- `tests/platform.test.mjs`
- `tests/api.test.mjs`

## Secret scan

The repository mechanism is `scripts/secret-scan.mjs`. It expects either `.tools/trufflehog/trufflehog.exe` or `TRUFFLEHOG_BIN`, runs without a shell, disables tool self-update, excludes `.git`, dependencies, build/local/private-data directories and archives, and writes only sanitized evidence.

A repository-local ignored copy of TruffleHog 3.96.0 was downloaded from the official GitHub release. The Windows AMD64 archive SHA-256 matched the official checksum:

`fbf918c52a1f29be96344e1c4696fe019cfc34fb1184fab31cf3e8347917b43a`

Command:

`npm run security:secrets:strict`

Result: exit 0; 2,189 chunks and 22,309,812 bytes scanned; 0 verified secrets; 0 unverified/unknown secrets. The sanitized run-evidence directory and local scanner binary are ignored and excluded from deliverables.

## fast-uri advisory

Initial production audit exposed GHSA-7p8r-x3mc-p8w7 through the existing Fastify schema stack:

- `fastify@5.10.0` → `@fastify/ajv-compiler@4.0.5` / `ajv@8.20.0` / `fast-json-stringify@6.4.0` → `fast-uri@3.1.4`
- `fastify@5.10.0` → `fast-json-stringify@7.0.1` → `fast-uri@4.1.1`

The advisory concerns URI-host interpretation differences for backslash authority introducers and requires an upgrade; no workaround is listed. The Milestone 2 local preview itself uses Node's loopback `http` server and has no third-party runtime dependency, so it did not directly reach the vulnerable parser. The repository server dependency chain did.

Compatible non-forced remediation was applied with `npm audit fix --omit=dev`:

- `fast-uri` 3.1.4 → 3.1.5
- nested `fast-uri` 4.1.1 → 4.1.2

`npm audit --omit=dev --json` now exits 0 with zero known production vulnerabilities. Focused, root build/typecheck, Prisma and existing PHANTOMStore regression gates must still pass after the lockfile change.

## Full dependency audit

The full audit, including development tooling, still reports 25 inherited findings: 3 low, 21 high and 1 critical. They are concentrated in the existing Electron Forge packaging toolchain (`@electron-forge/*`, `@electron/rebuild`, `@electron/packager`, `tar`, `extract-zip`, `tmp`, and related build dependencies). npm's offered path includes semver-major/downgrade changes, so it was not forced inside this product milestone.

These development-tool findings remain a repository release blocker for workflows that consume untrusted archives or execute the affected packaging chain. The new AI-products package adds no third-party dependency and does not invoke that toolchain.

## Remaining manual gates

- Independent security and privacy review
- Abuse-case review with production identity, object storage, database, queue and provider adapters once implemented
- Retention purge and backup/restore verification against production storage
- Multi-browser/network timing and download-permission testing
- Re-run strict secret scan and both dependency audits immediately before any release candidate
