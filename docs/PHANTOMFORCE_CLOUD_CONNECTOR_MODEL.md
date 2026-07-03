# PhantomForce Cloud + Local Connector Model

Last updated: 2026-07-01

## Product Decision

PhantomForce should be a cloud-first SaaS operating phantom with an optional customer-owned local connector.

This is the CapCut/Figma/ChatGPT Desktop style model:

- The main product is the hosted PhantomForce app.
- The customer logs into PhantomForce, not GitHub/source files.
- PhantomAI is the only user-facing brain.
- Internal tools, model routing, provider names, source paths, scripts, and credentials stay hidden.
- Local machine power is handled by an optional connector installed on the customer's own computer.

## What Customers Get

Customers should see:

- A clean hosted app.
- Their own business workspace.
- PhantomAI.
- Tasks, proposals, bookings, reviews, scans, media, approvals, and deliverables.
- An optional desktop connector when they need local files, scans, Resolve/Reaper/PhantomCut, or machine-specific workflows.

Customers should not see:

- Codex, Claude, GLM, OpenRouter, n8n, PhantomOps, OpenSpec, Serena, source paths, repo names, or provider keys.
- GitHub/source files.
- Raw server controls.
- Jordan's private admin operating system.

## What Stays Server-Side

The valuable product logic must stay server-side:

- Tenant/account identity.
- Subscription and license checks.
- Access revocation.
- Billing gates.
- Provider routing.
- PhantomAI orchestration.
- Approval/audit policies.
- Agent/workforce routing.
- Public app updates.

This is the copy-resistance layer. A desktop app can be inspected eventually; a server-side product cannot be cloned by copying a folder.

## Desktop Connector Role

The desktop companion is not the full product.

It should be:

- Optional.
- Customer-owned.
- Outbound-only.
- Signed before commercial use.
- Useless without a valid PhantomForce account.
- Scoped to one tenant/device.
- Audited.

It may handle:

- Local files.
- Local scans.
- Private media workflows.
- Resolve/Reaper/PhantomCut bridges.
- Customer-owned folder actions.

It must not ship:

- Source repos.
- Provider keys.
- Full orchestration logic.
- Raw admin tools.

## Jordan PC Role

Jordan's Windows host is acceptable for:

- The internal admin pilot.
- Private operator testing.
- A temporary local connector.

Jordan's Windows host should not be the long-term customer traffic hub.

Commercial customers should route through cloud infrastructure, with their own optional local connector when needed.

## Current Contract

The backend exposes:

```text
GET /phantom-ai/deployment/model/status
```

Admin receives the full cloud/connector/copy-resistance posture.

Client sessions receive a simplified product-safe view.

The status route is read-only:

- no provider call
- no deployment change
- no credential read
- no customer data mutation
- no external send

## Next Build Steps

1. Keep polishing the hosted app as the primary business Phantom.
2. Promote tenant/workspace boundaries over local demo state.
3. Build a signed desktop connector prototype only after the cloud boundary is stable.
4. Add device registration and revocation.
5. Add subscription/license enforcement to connector actions.
6. Keep customer-facing copy in PhantomForce/PhantomAI language only.
