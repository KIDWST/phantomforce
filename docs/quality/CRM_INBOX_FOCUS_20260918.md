# CRM inbox focus — 2026-09-18

## Outcome

The Relationships workspace now hands an account owner into a focused inbox-
automation setup instead of the full platform connection catalog. The focused
path keeps the product's graphite shell and bright-green action accent, removes
the unrelated settings rail, and shows only the setup needed to make CRM email
automation real.

## Audited journey

1. Sign in to the local authenticated development fixture.
2. Open **Relationships**.
3. Select **Connection settings** from the email-automation readiness card.
4. Confirm the focused setup remains active after asynchronous settings
   refreshes.
5. Confirm all four truth gates remain visible: inbox account, secure sending,
   delivery tracking, and reply sync.
6. Open **Email setup** and confirm only inbox providers are shown.
7. Select **Show all connections** and confirm the complete settings catalog is
   restored intentionally.

## Findings and resolution

- **Resolved — scope overload:** the CRM handoff previously opened the entire
  settings catalog, mixing AI routes, social channels, and other unrelated
  configuration with the Gmail task. Focus mode now filters the catalog to the
  Email group and hides the global settings rail.
- **Resolved — unstable handoff:** a one-time focus flag was consumed before an
  internal rerender, causing the full catalog to return. Focus state now remains
  active until the owner expands the catalog, changes the settings tab, or
  leaves Settings.
- **Resolved — misleading connected action:** a connected inbox now offers
  **Reconnect**, accurately describing the action that restarts authorization.
- **Preserved — provider truth:** the UI does not claim an inbox, sender,
  delivery webhook, reply webhook, email, or reply exists until the relevant
  provider evidence is verified.
- **Preserved — public-account isolation:** the focused state and provider
  configuration stay attached to the active authenticated account rather than
  to a ChicagoShots-branded global workspace.

## Visual verification

Accepted screenshots are stored outside the repository under:

`work/artifacts/phantomforce-crm-audit-20260918/`

- `05-focused-inbox-top.png`
- `06-focused-email-providers.png`

The screenshots were reviewed at the active desktop viewport. No clipped
primary actions, horizontal overflow, duplicated navigation, or unreadable
green-on-green content was observed.

## Automated verification

- `npm run test:customer-connections`
- `npm run test:crm-pipeline`
- `npm run test:autopilot-attention`
- `npm run test:nexus-hardening`
- `npm run test:release-critical`
- `git diff --check`

The release-critical result is recorded by the ship workflow immediately before
deployment.
