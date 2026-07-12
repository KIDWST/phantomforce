# Competitor Intelligence

Competitor Intelligence is PhantomForce's tenant-scoped workspace for turning lawfully available public evidence into labeled strategic estimates and original response plans.

## Product posture

- Standard mode organizes dated public evidence and prepares bounded analysis.
- Aggressive Intelligence Mode increases weak-signal fusion and response packaging. It does not loosen access, privacy, originality, or approval boundaries.
- Every inference remains an `estimate`, includes supporting signals and dates, lists alternative explanations, states confidence, recommends verification, and offers legitimate response options.
- No route scrapes a site, signs into an account, contacts a person, publishes content, or takes an external competitive action.

## Real capabilities

- Tenant-isolated competitors, signals, inferences, audience themes, creative analyses, interception packages, search/offer/timing opportunities, authorized customer-experience evidence, and audit records.
- HTTPS public-source validation and private-network URL rejection.
- Deterministic weak-signal fusion across pricing, campaigns, hiring, reviews, releases, documentation, social cadence, and other public evidence.
- Aggregated audience-gap mining without individual commenter targeting.
- Abstract creative decomposition plus lexical similarity-risk warnings.
- Rapid response packages with facts, risks, approvals, and measurement plans.
- Server-enforced prohibitions with a recorded reason and closest legitimate alternative.
- Plan entitlements for the base module, aggressive mode, competitor count, and signal count.

## Storage

The current private deployment stores durable state at `.phantom/competitor-intelligence.json`, or at `PHANTOMFORCE_COMPETITOR_INTELLIGENCE_PATH` when configured. Writes are atomic. A cloud deployment should replace the storage adapter with tenant-scoped database tables without changing the API contract.

## API

- `GET /api/competitor-intelligence`
- `PATCH /api/competitor-intelligence/mode`
- `POST /api/competitor-intelligence/competitors`
- `POST /api/competitor-intelligence/signals`
- `POST /api/competitor-intelligence/fuse`
- `POST /api/competitor-intelligence/audience-themes`
- `POST /api/competitor-intelligence/creative-analyses`
- `POST /api/competitor-intelligence/interceptions`
- `POST /api/competitor-intelligence/opportunities`
- `POST /api/competitor-intelligence/mystery-evidence`
- `POST /api/competitor-intelligence/policy-check`

## Explicit non-capabilities

There is no automated web crawler, private data source, login automation, paywall/CAPTCHA bypass, deceptive mystery shopping, individual commenter outreach, asset cloning, posting, or operational interference. Automatic monitoring can be added later only through source-specific lawful adapters with rate limits, provenance, opt-in configuration, and the same server policy gate.

