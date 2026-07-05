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
- `ops/apify/apify-runner.mjs` - minimal server-side dry-run/live runner.

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

