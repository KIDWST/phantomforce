# PhantomForce Apify Integration

Apify gives PhantomForce a marketplace of specialized Actors for public web research, local lead discovery, social/content intelligence, reputation monitoring, e-commerce research, and dataset cleanup.

## Safety Contract

- No `APIFY_TOKEN` in browser code, localStorage, committed files, or Obsidian notes.
- Browser dashboard is catalog/review only.
- Actor runs require server-side `APIFY_TOKEN`.
- Runner is dry-run by default.
- Live execution requires `--execute`, owner approval, scoped inputs, and a budget guard.
- Actor outputs become Phantom review cards before any CRM update, send, post, export, payment, or public action.

## Files

- `app/js/apify-tools.js` - public Actor catalog and dashboard registry.
- `ops/apify/phantomforce-apify-toolbox.json` - backend handoff map.
- `ops/apify/task-templates.json` - owner-enabled automation templates, all off by default.
- `ops/apify/apify-runner.mjs` - minimal server-side dry-run/live runner.

## Capability Packs

PhantomForce should sell and operate outcomes, not scraper names. The dashboard exposes these packs:

- `local-growth-miner` - public local prospect discovery and website gap proof.
- `reputation-radar` - reviews, mentions, SERPs, and testimonial/risk themes.
- `social-trend-lab` - short-form hooks, captions, creator references, and content angles.
- `competitor-offer-mirror` - offers, pricing, ads, pages, and product/catalog comps.
- `content-memory-builder` - approved websites/docs into clean Phantom/Hermes memory.
- `hiring-signal-radar` - companies showing demand through public job and stack signals.
- `protect-surface-sweep` - passive public exposure and brand-risk review cards.
- `dataset-clean-room` - dedupe, normalize, redact, and summarize Actor outputs.
- `retail-treasure-scan` - retail/resale pricing comps, visibility, and campaign intelligence.

Each pack is staged in the UI only. Execution still requires server token, budget cap, scoped inputs, owner approval, and output review.

## Dry Run

```powershell
node ops/apify/apify-runner.mjs --dry-run --actor apify/google-search-scraper --input .\ops\apify\example-input.json
```

## Live Run

```powershell
$env:APIFY_TOKEN="set-this-in-the-server-env-only"
node ops/apify/apify-runner.mjs --execute --actor apify/google-search-scraper --input .\ops\apify\example-input.json --wait
```

## Phantom Workflow

1. Choose Actor in Apify Vault.
2. Review input schema and budget.
3. Approve run.
4. Pull dataset.
5. Summarize and dedupe.
6. Create Phantom review cards.
7. Owner approves any outward action.
