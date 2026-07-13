# Live Social Analytics Connectors

PhantomForce Analytics is connector-first. The dashboard calls official, read-only provider APIs and refreshes configured channels automatically. CSV, TSV, and JSON imports remain available only as a backup.

## Server configuration

Configure credentials in `server/.env`; never place them in frontend code or commit them.

- YouTube: `YOUTUBE_API_KEY` plus `YOUTUBE_CHANNEL_ID` or `YOUTUBE_CHANNEL_HANDLE`
- Instagram: `INSTAGRAM_ACCESS_TOKEN` and `INSTAGRAM_BUSINESS_ACCOUNT_ID`
- Facebook: `FACEBOOK_PAGE_ACCESS_TOKEN` and `FACEBOOK_PAGE_ID`
- TikTok: `TIKTOK_ACCESS_TOKEN`
- Optional Meta API version override: `META_GRAPH_VERSION`

After changing connector configuration, restart Hermes. The authenticated status route is:

`GET /phantom-ai/ops/social-analytics/status`

The authenticated, read-only refresh route is:

`POST /phantom-ai/ops/social-analytics/sync`

with a JSON body containing one supported platform, for example `{ "platform": "youtube" }`.

The status route reports only whether each connector is configured. It never returns credentials. Missing credentials fail closed, and no generated or estimated metrics are substituted for live platform data.

## Current boundary

This adapter supports Jordan's owner-managed server connections. Multi-tenant customer OAuth requires encrypted per-organization token storage and provider callback routes before customer accounts can be called live. Until that exists, client workspaces must remain disconnected or use the clearly labeled report-file backup.
