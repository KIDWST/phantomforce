# Hermes × Higgsfield Creative Engine

The Creative Engine is how Media Lab turns a brief into real media. Its
**primary transport is Hermes/MCP** — the `higgsfield` CLI is an optional
admin/dev fallback that is disabled unless explicitly enabled, and is never
required for normal Media Lab operation.

## Final architecture

```
PhantomForce UI (app/js/medialab.js)
  → PhantomForce backend (ops/admin-live/admin-static-server.mjs, same origin)
      → Hermes agent (server/src/index.ts, default http://127.0.0.1:5190)
          → PhantomCut bridge (PHANTOMCUT_BASE_URL, default http://127.0.0.1:8787)
              → Higgsfield MCP/tools (owner's connected Higgsfield account)
                  → creative output (approved in the Higgsfield studio)
```

- The UI never talks to a provider directly. It calls its own origin.
- The backend never talks to Higgsfield directly. It brokers to Hermes.
- Hermes never spends credits on its own. It creates **drafts** through
  PhantomCut; the paid render is gated behind PhantomCut's explicit
  `RUN_HIGGSFIELD_PAID_JOB` confirmation, which the owner performs in the
  Higgsfield studio.

## Why Hermes/MCP is primary

- The Higgsfield connection (subscription, session, MCP tools) lives in
  Hermes/PhantomCut — one place, owner-controlled, credit-safe by design.
- The CLI required per-machine install + login and encouraged silent
  credit spend from automation. As of this change it is fallback only.

## Transports

`CreativeEngineTransport` (backend): `hermes_mcp` (default) | `cli_fallback` | `disabled`.

Resolution order in `POST /generate`:

1. `disabled` → honest blocked response. Nothing runs.
2. `hermes_mcp` → brief is forwarded to Hermes
   (`POST /phantom-ai/media-lab/higgsfield/draft`). Success returns a
   **queued draft** (`transport: "hermes_mcp"`, no credits spent). Failure
   returns a **blocked** response with the exact reason — it never falls
   back to the CLI silently.
3. CLI lane runs **only** when `HIGGSFIELD_CLI_FALLBACK_ENABLED=true`
   (either as the configured transport or as explicit fallback), **and**
   the request carries `approved: true` — otherwise it answers
   `approval_required`. CLI renders spend credits directly, so approval is
   mandatory.

## Environment variables (backend: `ops/admin-live/admin-static-server.mjs`)

| Variable | Default | Meaning |
| --- | --- | --- |
| `CREATIVE_ENGINE_TRANSPORT` | `hermes_mcp` | `hermes_mcp` \| `cli_fallback` \| `disabled` |
| `HERMES_BASE_URL` | the `--api` origin (`http://127.0.0.1:5190`) | Where Hermes listens |
| `HERMES_API_TOKEN` | *(empty)* | Optional service token; otherwise the caller's `Authorization` header is forwarded |
| `HERMES_HIGGSFIELD_ENABLED` | `true` | Kill-switch for the Higgsfield tools through Hermes |
| `HIGGSFIELD_CLI_FALLBACK_ENABLED` | `false` | Explicit opt-in for the admin/dev CLI lane |

Hermes side: `PHANTOMCUT_BASE_URL` (default `http://127.0.0.1:8787`) points at
the PhantomCut bridge that owns the Higgsfield MCP/tool session.

The defaults are correct with **zero configuration**: Hermes primary, CLI off.

## Status route (safe preflight — never generates, never spends)

`GET /api/creative-engine/status` on the admin origin answers:

- can PhantomForce reach Hermes? (`hermes.reachable`)
- is the session authorized? (`hermes.authOk`)
- can Hermes see the Higgsfield tools? (`hermes.toolsAvailable`,
  `higgsfield.availableThroughHermes` — via PhantomCut reachability)
- which tools exist (`tools[]`, from Hermes
  `GET /phantom-ai/creative-engine/tools` when deployed, synthesized
  otherwise)
- `approvalRequired` (always `true`), `cliFallbackEnabled`, and a
  human `message`.

`status` values: `connected` | `not_configured` | `error`.

Hermes's own discovery route (`GET /phantom-ai/creative-engine/tools`,
`server/src/index.ts`) reports the PhantomCut broker state and the tool list:
`higgsfield.draft` (available, no credit spend) and `higgsfield.render`
(**not exposed** — intentionally gated behind `RUN_HIGGSFIELD_PAID_JOB`
inside PhantomCut).

## Approval-first render flow

```
brief (Media Lab prompt)
  → approval
      · Hermes lane: the draft itself spends nothing; the paid render is
        approved by the owner inside the Higgsfield studio
      · credit-spending lanes (provider API key, CLI fallback): the UI asks
        "This will use your connected creative engine credits. Approve
        render?" and the backend independently rejects CLI renders that
        don't carry approved:true
  → render/queue
  → review/use (tiles land in Media Lab; captures land in Content Hub)
```

No render on page load. No render during preflight. No video by default
(video requires the user to pick the Video tab). No automatic credit spend.

## Media job model

Backend jobs (`mediaJobs` in the static server) track:
`id, status (queued|running|done|failed|blocked|awaiting_approval), transport
(hermes_mcp|cli_fallback), brief, prompt, type, approvalRequired, approvedAt,
creditWarningShown, errorMessage, artifactRefs, createdAt, updatedAt`.
`GET /generate/job/<id>` includes `transport`.

## UI behavior

- Customer-facing banner: “Creative Engine connected through Hermes.” /
  “Creative Engine needs Hermes connection.” / an honest blocked reason.
  No CLI instructions are ever shown to normal users.
- Admin detail (`Transport: Hermes/MCP · CLI fallback ENABLED`) appears only
  when the fallback flag is on.
- Blocked renders produce an offline sketch clearly labeled with the blocked
  reason — never a fake “success”.

## Troubleshooting

**“Creative Engine needs Hermes connection.”**
PhantomForce could not reach Hermes at `HERMES_BASE_URL`.
Check that the Hermes process is running on the box (`server/`,
`npm run dev` or the deployed service) and that the static server's `--api`
origin / `HERMES_BASE_URL` matches its port (default 5190).

**“Blocked: Hermes is reachable, but Higgsfield MCP tools are not available.”**
Hermes answered but its PhantomCut bridge did not. Check the PhantomCut
process at `PHANTOMCUT_BASE_URL` (default 8787) and, inside PhantomCut, that
the Higgsfield MCP/tool session is signed in.

**“Hermes is reachable but rejected this session.”**
Sign in with an admin account in the console, or set `HERMES_API_TOKEN` on
the static server to a service token Hermes accepts.

**“Blocked: Hermes does not expose a render tool route yet.”**
The running Hermes build predates `POST /phantom-ai/media-lab/higgsfield/draft`.
Update/restart Hermes from this repo.

**What is still intentionally missing:** a paid-render tool route through
Hermes. PhantomCut gates paid jobs behind `RUN_HIGGSFIELD_PAID_JOB`; until a
confirmation contract is wired end-to-end (natural home: Hermes's approval
queue, `/phantom-ai/approvals/queue`), finished paid renders are approved in
the Higgsfield studio, and PhantomForce truthfully reports drafts as
“queued — approve in Higgsfield”.

## Safety invariants

- No automatic render; no render during preflight or on page load.
- No hidden credit spend: drafts are free; every credit-spending lane
  requires an explicit approval both in the UI and at the backend.
- CLI fallback is off by default, admin/dev only, never silent.
- No provider secrets in the frontend; Hermes auth is a forwarded session
  header or a backend-side `HERMES_API_TOKEN`.

## Tests

`node ops/admin-live/test-creative-engine.mjs` — spins the real backend with a
stub Hermes and a canary `higgsfield` CLI shim, and asserts: status prefers
Hermes; default config never touches the CLI; Hermes-down yields blocked (not
fake success); CLI lane demands the env flag AND explicit approval; preflight
performs zero renders.
