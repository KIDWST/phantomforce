# PhantomForce Quality Scorecard

Last updated: 2026-07-16

Scores are 0-5 and require evidence. A low or moderate score is not a failure;
it is an honest map of what is proven today.

| Dimension | Score | Evidence | Current Risk |
|---|---:|---|---|
| Functional correctness | 3 | First real run executed 65 backend calls with 0 failures; 17 app modules mounted in UI sweep; build/typecheck pass; instant fallback and PhantomPlay catalog tests pass. | Many flows still untested in browser, especially auth recovery, billing, redirects, full interaction mobile, and permission denied. |
| Product clarity | 2 | Product principles documented; current UI has PhantomForce/PhantomPlay split in nav. | Public site and onboarding do not yet have a full role/profile/module/subscription clarity audit. |
| Information architecture | 2 | Sidebar split restored and verified in Headless Edge: business sections and operations/settings groups render separately. | PhantomForce vs PhantomPlay responsibilities and Developer-as-role need ongoing cleanup. |
| Visual consistency | 2 | Desktop 1280x720 sweep had 0 horizontal overflow pages; Cycle 1 desktop sidebar screenshot shows the split lower group. | User has reported repeated mobile/scaling problems; no comprehensive visual baseline exists. |
| Responsive behavior | 2 | Cycle 1 added a 375px shell sanity check; the 2026-07-16 responsive matrix passed 42 browser cases across seven app destinations and six viewport widths. | Interaction-level mobile checks, screenshot review, keyboard, dialogs, and game/editor controls still need deeper proof. |
| Accessibility | 1 | Some nav semantics exist (`aria-current`, disabled labels). | No WCAG 2.2 AA pass, keyboard pass, focus trap audit, or screen-reader output audit yet. |
| Performance | 1 | Production build completes. | No bundle, LCP/CLS/INP, long-task, image, or memory measurements yet. |
| Reliability | 3 | Server uses fail-closed preview routes; build and feature tests exist; instant chat fallback is covered by route-level regression. | Broader provider health and slow/failing network states need browser-level testing. |
| Security posture | 3 | Send route is planned-disabled; security scanner blocks synthetic unsafe snippet; tenant documents separated in owner harness. | DB-auth org isolation and secret/log audits need deeper evidence. |
| Content quality | 2 | Some copy has been business-ified; memory/history copy is clearer. | Public copy, pricing, CTA destination text, and product claims need systematic review. |
| Search visibility | 1 | `robots.txt` and `sitemap.xml` exist. | Sitemap likely under-covers public routes; OG/canonical/structured data not audited. |
| Conversion clarity | 1 | Site builder and Business Manager surfaces exist. | Pricing/subscription/module clarity is under-tested and likely incomplete. |
| Test coverage | 3 | Many targeted scripts exist for auth, planner, CRM, proposals, PhantomPlay, automations, memory, responsive viewports, etc. | Browser interaction/E2E, accessibility, and public-site tests are still thin. |
| Maintainability | 2 | Feature modules are split; route inventory exists. | `server/src/index.ts` is very large; quality docs only began this cycle. |
| Observability | 2 | Hermes ledger, automation receipts, run records, and evidence files exist. | No product funnel analytics quality map or production telemetry audit yet. |

## Current Overall Read

PhantomForce has substantial working backend contracts and module surfaces, but
quality confidence is uneven. The strongest evidence is backend/API correctness,
PhantomPlay regressions, responsive shell rendering, and fail-closed safety. The
weakest evidence is accessibility, performance, public conversion clarity, and
DB-auth organization isolation.
