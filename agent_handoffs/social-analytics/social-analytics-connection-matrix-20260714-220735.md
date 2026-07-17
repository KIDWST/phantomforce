# Social Analytics Connection Matrix - 2026-07-14 22:07 CDT

## Execution Scope

Operator task: discover and verify legitimate social analytics connections for PhantomForce / ChicagoShots without posting, uploading, modifying campaigns, exposing credentials, or fabricating metrics.

## Installed Connector Reality

- Codex/ChatGPT social analytics connector tools: none available.
- Google Drive connector: available and searched for analytics/report/export sources.
- PhantomForce local backend: running from `C:\Users\jorda\Documents\Codex\worktrees\phantomforce-live-social-analytics-20260712`.
- Local API ports observed: `127.0.0.1:5190` backend, `127.0.0.1:5191` frontend/static surface.
- Social token store path: `C:\Users\jorda\Documents\Codex\worktrees\phantomforce-live-social-analytics-20260712\server\.phantom\social-connections.json`.
- Stored social tokens found: none.
- Provider OAuth app credentials configured: `0/6`.
- External sends/uploads/posts/deploys: none.

## Safety Correction Applied

Analytics OAuth scopes were corrected to read-only/list/insights scopes only. Removed upload/publish/write scopes from:

- YouTube
- Instagram
- Facebook
- TikTok
- X
- Pinterest

Posting remains approval-gated and no posting path was enabled.

Commit: `c9abcdb fix(analytics): keep social oauth read only`

## Supported Connector Matrix

| Platform | Account hint | Provider | Status | Latest data timestamp | Refresh schedule | Verified metrics | Exact blocker |
|---|---|---|---|---|---|---|---|
| YouTube | `officialchicagoshots` | YouTube Data API | CONNECTION REQUIRED | Not available | Not active | Not verified | Missing Google/YouTube OAuth app credentials and account authorization. |
| Instagram | `officialchicagoshots` | Instagram Graph API | CONNECTION REQUIRED | Not available | Not active | Not verified | Missing Meta OAuth app credentials and Instagram Business account authorization. |
| Facebook | `officialchicagoshots` | Facebook Graph API | CONNECTION REQUIRED | Not available | Not active | Not verified | Missing Meta OAuth app credentials and Facebook Page authorization. |
| TikTok | `officialchicagoshots` | TikTok Display API | CONNECTION REQUIRED | Not available | Not active | Not verified | Missing TikTok OAuth app credentials and account authorization. |
| X | `officialchicagoshots` | X API v2 | CONNECTION REQUIRED | Not available | Not active | Not verified | Missing X OAuth app credentials and account authorization. |
| LinkedIn | `officialchicagoshots` | LinkedIn Marketing API | CONNECTION REQUIRED | Not available | Not active | Not verified | Missing LinkedIn OAuth app credentials and organization authorization. |
| Pinterest | `officialchicagoshots` | Pinterest API v5 | CONNECTION REQUIRED | Not available | Not active | Not verified | Missing Pinterest OAuth app credentials and account authorization. |

## Unsupported / Not Implemented In Current Build

| Platform | Status | Exact reason |
|---|---|---|
| Threads | UNSUPPORTED BY CURRENT BUILD | No PhantomForce connector route or sync implementation exists yet. |
| Snapchat | UNSUPPORTED BY CURRENT BUILD | No PhantomForce connector route or sync implementation exists yet. |
| Reddit | UNSUPPORTED BY CURRENT BUILD | No PhantomForce connector route or sync implementation exists yet. |
| Twitch | UNSUPPORTED BY CURRENT BUILD | No PhantomForce connector route or sync implementation exists yet. |
| Discord insights | UNSUPPORTED BY CURRENT BUILD | No PhantomForce connector route or sync implementation exists yet. |
| Google Business Profile | UNSUPPORTED BY CURRENT BUILD | No PhantomForce connector route or sync implementation exists yet. |

## Google Drive / Sheets Search

Searched connected Google Drive for:

- `ChicagoShots analytics`
- `officialchicagoshots`
- spreadsheet-only `analytics`

Result: no usable spreadsheet/export source containing live social analytics was found. Results were business docs, resume/profile docs, or media folders, not social performance exports.

## Normalized Analytics View Status

Unified live view is not populated because no account passed a provider data read. Missing metrics are not converted to zero. They remain `Not provided by source` / `Not available` until a provider returns authenticated analytics data.

## Required Next Owner Action

First practical owner action: configure the Meta provider app because it can unlock both Instagram and Facebook.

Action:

1. Open `https://admin.phantomforce.online/`.
2. Go to `Settings`.
3. Open the social/OAuth app setup area.
4. Select the Meta / Instagram / Facebook provider row.
5. Add the official Meta app ID and app secret through the PhantomForce settings UI only.
6. Use callback URL: `https://admin.phantomforce.online/phantom-ai/ops/social-oauth/callback`.
7. After saving, click the Meta/Instagram/Facebook authorization button.
8. Approve read/list/insights permissions only.
9. Reply `DONE` so Codex can resume verification from Meta and not repeat completed checks.

Do not paste app secrets, access tokens, passwords, cookies, or MFA codes into chat.

## Verification Already Completed

- `npm --prefix server run test:social-analytics` passed.
- `node scripts\test-social-analytics.mjs` passed.
- `npm run build` passed.
- `git diff --check` passed before commit.
- Added-line secret scan found no new secrets.
