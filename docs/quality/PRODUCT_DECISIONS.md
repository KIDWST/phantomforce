# PhantomForce Product Decisions

Last updated: 2026-07-18

## Active Principles

- PhantomForce is the command center/control plane.
- PhantomPlay is a focused separate experience that PhantomForce can configure,
  publish to, and launch.
- Workspace type is separate from user role.
- Developer is a role/capability/use case, not a default organization identity.
- Customers should select meaningful capability packages, not hundreds of
  micro-options.
- External sends, posts, payments, deploys, deletes, credentials, and production
  changes stay approval-gated with receipts.

## Decisions Made This Cycle

### D-0001 — Safe instant chat may answer locally when providers are unavailable

Harmless, short, low-risk instant chat should not hard-fail just because a local
or cheap model route is down. A bounded local fallback may answer ordinary
small-talk/preferences while marking provider/network execution as false.

This does not apply to business work, current facts, security, money, legal,
medical, production changes, sends, uploads, or anything blocked from instant
mode.

### D-0002 — Quality docs are part of the product surface

`docs/quality` is the durable checkpoint for future website quality runs.
Future cycles should update it rather than starting from memory or chat history.

### D-0003 — Desktop sidebar stays split by job type

The Business Manager desktop sidebar should keep primary business navigation at
the top and operations/settings navigation as a lower group. This makes the app
feel like a command center instead of a flat list of every capability.

Mobile keeps the bottom taskbar shell; the desktop lower group should not be
forced into mobile as a second sidebar.

### D-0004 — Active organization owns all browser context

Database-auth and customer sessions scope memory, temporary chat, request
context, and visible transcript to the active organization id. Organizations
are separate businesses; a legacy global workspace fallback must never expose
one business's context while another business is selected.

The database-auth browser fixture must prove two-way isolation and non-member
rejection. A successful organization switch clears the visible transcript
before the new organization's context is rendered.

### D-0005 — Tenant mismatch is an authorization error

An explicit tenant id is a security boundary, not a routing hint. If a
database-auth user requests an organization outside their memberships, the
server returns 403 instead of silently substituting the active organization.
All accepted records derive their tenant/workspace label from that authorized
server tenant, never from a client-supplied `ws` field.

On hydration, server-backed CRM, proposal, and approval collections are
authoritative for the active organization. Missing server rows stay deleted;
local fallback records may survive only when they are explicitly not
server-backed.

## Decisions Needed Later

- Exact subscription package names and module bundles.
- Public pricing and billing provider timing.
- Whether PhantomPlay gets a separate public URL/brand shell.
- Official supported browsers and device matrix.
- Exact mobile navigation strategy for heavy admin modules.
