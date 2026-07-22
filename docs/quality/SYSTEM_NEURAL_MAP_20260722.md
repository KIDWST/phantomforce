# System Neural Map — Developer tab (2026-07-22)

## What shipped

A brain-shaped neural network on the Developer Control Room
(`app/js/systemsmap.js`, mounted by `renderDeveloperPage` → `loadDeveloperData`)
that draws **every internal subsystem and integration PhantomForce carries**,
radiating from the central **Neural Spine** core:

- **Memory**: Hermes (ledger), Neural Spine (vault), Obsidian
- **Execution**: Agent-Run Engine, Automation Engine, n8n, Falcon, Ruflo
- **Models**: Model Router → Codex CLI, Claude CLI, OpenRouter, Local Ollama
- **Agents**: Orca, Serena
- **Connectors**: Calendar, Finance, Sales/CRM, Social
- **Knowledge**: Org Brain Graph, engraph

23 nodes, 22 edges, verified rendering headless with zero errors; clickable
node → detail (state, description, source file, what it needs to go live);
keyboard-focusable; reduced-motion honored (no pulse/flow).

## The honesty rule (why it does NOT say "all connected")

Each node carries a real **state**, never a claim that everything is wired:

| State | Meaning | Examples |
|---|---|---|
| **Live** (green) | Verified live per truth map / live status | Neural Spine, Hermes, Agent-Run Engine, Automation Engine, Model Router, Org Brain Graph |
| **Gated** (amber) | Intentional dry-run by design | n8n |
| **Needs config** (blue) | Real module present; needs credentials/config to go live | Obsidian, Codex/Claude/OpenRouter/Local, Orca, Serena, all Connectors, Falcon, Ruflo |
| **Not linked** (grey) | Not present in the repo yet | engraph |

Live status is overlaid from the real provider/workforce/local-model endpoints
when the server responds; when it doesn't, the honest static default (sourced
from `docs/RELEASE_CANDIDATE_TRUTH_MAP.md`) stays. The map never fabricates a
connection.

## What this does NOT do (and why)

The prompt also asked to *configure* obsidian/hermes/orca/n8n/serena/engraph to
"work together." That is live backend + credential + external-service wiring:
it needs a running server, real keys, and the external repos — none of which
exist in this cloud sandbox (no `node_modules`, no server, no secrets). Wiring
those blind and unverified would violate the repo's own verification gates and
could turn intentionally-gated lanes (n8n, connectors) into unapproved live
execution. So this cycle delivered the **honest map of what is and isn't
wired** — which is the prerequisite for that work — and each not-live node
states exactly what it needs ("OPENROUTER_API_KEY + 2 flags", "OAuth", "vault
path", "approval + live flag"). `engraph` is shown as an explicit
"available to add" node.

To actually connect any of these: set the named credentials/flags in the live
`server/.env`, and for engraph add the repo + a transport module, then the map
will show them flip to Live on the next 30-second refresh.

Build id bumped to `phantom-live-20260722-23`.
