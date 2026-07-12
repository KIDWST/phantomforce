# PhantomForce Customization Platform

Workspace Studio is the supported way for an organization owner to adapt PhantomForce without editing source code or weakening the platform boundary.

## Product boundary

Customers may configure their organization experience: approved theme tokens, business terminology, visible modules, navigation labels, assistant tone, custom business record definitions, forms, dashboards, and approval-gated workflow definitions.

Customers may not edit or upload HTML, CSS, JavaScript, server code, shell commands, provider credentials, authentication rules, audit rules, billing rules, or approval enforcement. PhantomForce attribution remains in configuration metadata even when an entitled account uses a white-label presentation.

## Architecture

- `server/src/customization/schemas.ts` defines the strict configuration contract. It rejects unknown fields and arbitrary executable content.
- `server/src/customization/module-registry.ts` owns canonical module IDs, dependencies, required modules, routes, and role visibility.
- `server/src/customization/customization-service.ts` validates entitlements, protected terminology, module dependencies, custom-object relationships, public-form abuse protection, and outbound/destructive approval gates.
- `server/src/customization/customization-store.ts` provides tenant-scoped durable snapshots, atomic writes, checksums, version history, and audit entries.
- `app/js/customization.js` applies approved design tokens and renders Workspace Studio. The browser only submits schema-shaped configuration patches.

The current store is a single-host durable JSON adapter under `server/.local/customization` (or `PHANTOMFORCE_CUSTOMIZATION_DIR`). It is appropriate for the current owner-hosted deployment. Before running multiple backend replicas, replace this adapter with a Postgres implementation while preserving the service interface and version semantics.

## API

Read routes require an authenticated tenant session. Write routes require an admin session.

- `GET /phantom-ai/customization/modules`
- `GET /phantom-ai/customization/config`
- `GET /phantom-ai/customization/versions`
- `POST /phantom-ai/customization/preview`
- `POST /phantom-ai/customization/publish`
- `POST /phantom-ai/customization/rollback`
- `POST /phantom-ai/customization/reset`
- `POST /phantom-ai/customization/assistant-plan`

Admin tenant selection is resolved server-side. Client sessions cannot override their tenant. Preview never publishes; publish uses an expected version to prevent overwriting a newer edit. Reset restores PhantomForce defaults without deleting organization data.

## Brand modes

- `standard`: PhantomForce-branded workspace.
- `co_branded`: customer identity presented with PhantomForce attribution; entitlement required.
- `white_label`: customer presentation with immutable platform attribution retained in protected metadata; enterprise entitlement required.
- `internal_phantomforce`: reserved for the PhantomForce owner workspace.

## Safe extension rules

New modules must be added to the canonical registry and declare dependencies and role visibility. New configuration fields must be added to the Zod schemas and validated in the service before UI controls are added. External sends, publishes, payments, deletes, provider calls, and destructive actions must remain approval-gated regardless of customer wording or assistant prompts.

## Verification

Run:

```powershell
npm run build
npm run typecheck
npm run test:customization --workspace @phantomforce/server
node --check app/js/customization.js
node --check app/js/main.js
git diff --check
```

The customization test covers tenant isolation, unsafe-style rejection, invalid colors, entitlement gates, required modules, reserved fields, external workflow approvals, publish/version behavior, assistant plans, and rollback.
