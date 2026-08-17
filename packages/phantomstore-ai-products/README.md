# PHANTOMStore Domain Intelligence Lab

This isolated workspace package implements the Milestone 2 shared foundation and one complete, deterministic core loop for each of ten prescribed AI products. It remains separate from the served PhantomStore. The truthful ledger marks 281 of 5,400 engineering tickets implemented and 5,119 deferred; it does not describe this package as production-ready.

## Run

Requires Node.js 22 or newer.

```powershell
npm run migrate --workspace @phantomforce/phantomstore-ai-products
npm run dev:phantomstore-ai-products
```

Open `http://127.0.0.1:4182`.

Fixed non-secret local sessions:

- `ai-demo-owner-token`
- `ai-demo-reviewer-token`
- `ai-demo-outsider-token` (isolation fixture)

The browser client uses the owner session. Data defaults to `.local/phantomstore-ai-products.json`; override with `PHANTOMSTORE_AI_PRODUCTS_DATA`.

## Verify

```powershell
npm run test:phantomstore-ai-products
npm run build:phantomstore-ai-products
```

The package has no third-party runtime dependency. Every calculation is deterministic, exposes its formula and inputs, records zero provider cost, links claims to provenance, and requires human review. It does not call an external model or data provider. Milestone 2 also adds workspace-scoped repository contracts, a relational-ready but disabled boundary, identity adapters, centralized entitlements and kill switches, consent/source dependency records, durable local job states, privacy-safe traces, portable exports, exact deletion confirmation, and recovery records.

See `docs/phantomstore-ai-products/REQUIREMENT_LEDGER.json` for all 5,400 ticket IDs and `MILESTONE_2_COMPLETION_LEDGER.json` for the truthful milestone state.
