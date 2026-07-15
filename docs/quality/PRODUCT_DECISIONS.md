# PhantomForce Product Decisions

Last updated: 2026-07-14

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

## Decisions Needed Later

- Exact subscription package names and module bundles.
- Public pricing and billing provider timing.
- Whether PhantomPlay gets a separate public URL/brand shell.
- Official supported browsers and device matrix.
- Exact mobile navigation strategy for heavy admin modules.
