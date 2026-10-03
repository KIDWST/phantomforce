# Social accounts — October 3, 2026

Build: `phantom-live-20261003-237`.

## Behavior

- Social accounts is a direct destination in every business's existing top navigation. No second navigation bar, hero or slogan is added.
- Analytics connection buttons use this same destination; there is no separate multi-popup authorization flow.
- Each request captures the business and signed-in identity. Wrong-business and stale responses are discarded. Provider callbacks trigger a server refresh, never a local claim of authorization.
- Owner-only provider setup supplies the provider's app-console link and exact callback address. Protected input fields send credentials to the server; saved secret values are never returned.
- Meta authorization presents eligible Pages when more than one is available. The selected Page and Instagram identity belong only to the initiating business. Connecting Facebook does not overwrite Instagram, or vice versa.
- Reconnect waits for a new stored connection revision. New authorization attempts and disconnect invalidate older callbacks and pending selections. Disconnect removes only the active business's local provider authorization; it does not delete posts or revoke another business's access.
- Connection and capability status derive from verified identity, actual granted scopes and token expiry. A public profile reference is not a connected account.
- ChicagoShots' default public handles are not inherited by Occasionally Odd, PhantomForce or future businesses.
- Missing identities, unsupported LinkedIn organization ambiguity and ineligible Instagram accounts fail without saving a false connection.

## Verification

The browser-flow fixture exercises blocked popups, explicit Page selection, failed and successful disconnects, tenant headers, wrong-tenant responses, obsolete requests, reconnect revisions, owner setup visibility, callback origin and business validation, and default handle separation. Existing social UI, analytics and customer-connection tests pass. Business navigation, 189 experience checks and 135 commerce checks pass. Runtime bundle budgets pass. The release gate includes the new social-account flow.

The complete release gate passed **47/47**, including build/type checks, the social account flow, publishing checks and the existing critical application checks. The backend OAuth lifecycle fixture passed 20 signed/unsigned HTTP cases plus provider fixtures for explicit selection, replay, expiry, granted scopes, redirect retention and disconnect during an in-flight callback. The change-memory guard passed 510 checks.

Browser visual testing was attempted through the supported Browser plugin. Navigation was blocked because saved browser permissions could not be verified. No screenshot or successful real-provider sign-in is claimed.

## Remaining live prerequisites

The intake audit found no configured OAuth app credentials for any of the seven providers and no stored authorized social accounts. Complete each provider's developer-app configuration using **Social accounts → Set up provider**, then authorize the intended business account. Do not paste secrets into chat or process notes.

Instagram uses a professional account linked to a Facebook Page. TikTok social authorization is separate from TikTok Shop. Marketplace adapters, printer telemetry and the social publishing execution service are separate integrations and remain unconfigured. Permission to publish shown on an account is not evidence that a post was delivered.

TikTok requests only fields covered by granted profile permissions; its account-statistics capability requires the statistics permission. LinkedIn uses the supported September 2026 API version by default, retaining the server override. These changes follow [TikTok's user-info scope requirements](https://developers.tiktok.com/docs/en/tiktok-api-v2-get-user-info) and [LinkedIn's migration schedule](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/migrations?view=li-lms-2026-09).

Provider references: [Meta Instagram with Facebook Login](https://www.postman.com/meta/instagram/folder/9cgqucg/instagram-api-with-facebook-login), [TikTok Login Kit](https://developers.tiktok.com/docs/en/login-kit-web), [YouTube server-side OAuth](https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps).
