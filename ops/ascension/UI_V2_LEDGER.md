# UI v2 Ledger

## Gates (from mission spec §13/§16)
- [ ] Permanent generic sidebar eliminated as organizing principle
- [ ] One recognizable PhantomForce shell (logo-removal test)
- [ ] Semantic design tokens; green-and-grey no longer define identity
- [ ] Widgets are intelligent instruments, not static cards
- [ ] Brain state (Hybrid / degraded / Ghostmode-style modes) visible product-wide
- [ ] Honest empty/loading/error/disconnected states
- [ ] Keyboard, touch, reduced motion, text zoom, responsive
- [ ] No visibly mixed old/new UI on migrated routes
- [ ] Professional density, all-day comfort

## Landed slices
- Slice 1 (`a7d56ff3`): canonical token layer `app/phantom-tokens.css`; removed 3 competing :root blocks in phantom.css (AA contrast fixed, white rebrand shadows dead); build `phantom-live-20260721-1`. Gates: change-memory 202 ✓, release-critical 19/20 (phantomplay failure pre-existing at baseline — verified in live checkout).
- Slice 2 (`6c70bcd3`): honest brain state — `app/js/brain-state.js`, command.js reports real fallback/provider metadata, Brain/Hands/Guard card shows live truth with warn/risk tones; build `phantom-live-20260721-2`. Gates: change-memory, command-surface, dashboard-chat, topbar-media, customization-ui, auth-boundaries ✓.

## Route migration status
Clusters (priority order from synthesis): 1 foundation/dashboard+gate, 2 AI core,
3 governance collapse (settings/clientsetup/customize), 4 CRM, 5 ops+money,
6 creative, 7 sites, 8 insight, 9 store+admin, 10 PhantomPlay, 11 out-of-band.
None migrated yet — shell v2 restyle is the next prerequisite.

## Next work queue
1. Shell v2 restyle on tokens (sidebar/topbar2/cards; keep mandated split sidebar: business modules top, Memory/Settings/Developer/Away Mode bottom).
2. Sweep hardcoded rgba(91,76,255,...) accent literals → var() (file-by-file).
3. ~~Overlay engine a11y~~ DONE — slice 3 (`387df784`): focus trap/restore, inert [data-phantom], skip link, panel initial focus. Build phantom-live-20260721-3.
4. Replace fabricated PhantomWire/agentops telemetry with real activity + brain-state feed.
5. Shared API client to replace 19 duplicated authHeaders()/api() wrappers.
6. Route migrations per cluster order.

## Decisions
- 2026-07-21: All work on branch `ascension/ui-v2` in dedicated worktree; live checkout untouched.
- 2026-07-21: Keep violet #5b4cff as brand accent; porcelain #fbfbfd background ("Apple for business" restraint); semantic --ok green is status-only, not brand.
- 2026-07-21: test:phantomplay fails on main at baseline (game source-assertion, font-size:clamp vw pattern in a game file) — pre-existing, tracked here, not blocking UI slices.

## Known blockers
- Authoritative PhantomForce mission specification was never pasted below the marker
  in the orchestration prompt — proceeding on the orchestration preamble +
  "Apple for business" directive as the binding requirements.
