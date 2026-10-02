# Occasionally Odd commerce channel architecture

Research date: 2026-09-27. Scope: official API capabilities and implementation contract for the existing organization-isolated business workspace candidate. This document proposes integration behavior; it does not certify any deployed adapter, authorized shop, live printer, or completed synchronization.

## Capability matrix

The UI must distinguish a provider's documented capabilities from capabilities actually implemented and authorized for a specific connection.

| Channel | Orders and customers | Catalog and stock | Fulfillment and events | Setup/limits and truthful initial state |
| --- | --- | --- | --- | --- |
| TikTok Shop | Shop APIs support order workflows; retain buyer data only as returned for that seller/market. | Product and inventory APIs. | Fulfillment APIs and shop event notifications; determine shipping mode, SLA and permitted actions from the connected shop/order. | Separate Shop app, seller authorization, granted scopes and shop mapping. Connector apps can require review even when privately distributed. Market/seller type matter. Start **Setup required**, never reuse TikTok social login as Shop access. [Official app guide](https://partner.us.tiktokshop.com/docv2/page/create-your-app). |
| Etsy | Receipts/transactions expose shop orders; link customers using provider IDs and permitted fields. Some address fields depend on regional partnership eligibility. | Listing inventory read/write, preserving offering/variation structure. | Receipt shipment endpoint submits tracking and can notify buyers. | Registered app plus OAuth authorization. Show unavailable fields explicitly. Start **Setup required**. [API reference](https://developer.etsy.com/documentation/reference), [OAuth and PKCE](https://developer.etsy.com/documentation/essentials/authentication/). |
| Etsy events | Fetch current receipt after verified notification. | Reconcile inventory separately. | Official events currently include paid, canceled, shipped and delivered orders, for personal and commercial apps. Verify signature over raw request bytes and reject stale replays. | Public callback and signing secret required. A saved URL alone is not a working subscription. [Official webhooks](https://developer.etsy.com/documentation/essentials/webhooks/). |
| eBay | Sell Fulfillment order records support shipment workflows; preserve line items and provider order IDs. | Inventory items/offers and quantity updates; seller inventory locations and business policies are prerequisites. | Create shipping fulfillment with actual line items, carrier and tracking; use scheduled order reconciliation unless a verified notification topic is available to this app. | Developer app and seller authorization. Do not assume existing listings already use the Inventory API model. Start **Setup required**. [Inventory overview](https://developer.ebay.com/api-docs/sell/inventory/overview.html), [order fulfillment](https://developer.ebay.com/api-docs/sell/static/orders/order-fulfillment.html), [shipping fulfillment](https://developer.ebay.com/api-docs/sell/static/orders/handling-unfulfilled-lineitems.html). |
| Shopify | Admin GraphQL orders join customer, line item and payment/fulfillment information; ordinary order access defaults to 60 days, with additional permission for older orders. | Admin inventory quantities by item/location. | Fulfillment-order based tracking writes and order/inventory/fulfillment webhooks. | Store installation/authorization and required data/scopes. Start **Setup required**. [Orders](https://shopify.dev/docs/api/admin-graphql/latest/objects/Order), [fulfillmentCreate](https://shopify.dev/docs/api/admin-graphql/latest/mutations/fulfillmentCreate), [webhook topics](https://shopify.dev/docs/api/admin-graphql/latest/enums/WebhookSubscriptionTopic). |
| Facebook/Instagram Shops through a storefront | For Shopify's official Meta channel, checkout redirects to the seller's online store; ingest the resulting storefront order once and retain Meta attribution. | Catalog availability is separate from personal Marketplace listings. | Use the checkout storefront's fulfillment contract. | Do not generate a second Meta order or promise legacy native checkout behavior. Start **Storefront setup required**. [Official Shopify Meta setup](https://help.shopify.com/en/manual/online-sales-channels/social-commerce/facebook-instagram-by-meta/setup). |
| Facebook Marketplace | No universal personal Marketplace order/customer API was verified in this research. | Do not equate a Meta catalog connection with Marketplace listing access. | Do not promise background listing, message, order or tracking automation without an approved capability for the actual account. | Start **Access verification required** with a supported import/assisted workflow if needed. Meta describes Marketplace and business listing exploration separately. [Meta Marketplace update](https://about.fb.com/news/2026/07/connecting-real-people-on-facebook/). Meta developer commerce/catalog pages returned 429 or were unavailable during research, so precise current access eligibility remains unverified. |
| WooCommerce / other storefronts | WooCommerce REST v3 supports orders and customers. A custom storefront needs its own explicit adapter contract. | WooCommerce products/variations; map variants and stock locations deliberately. | Webhook API available; fulfillment/tracking semantics depend on the store and installed extensions. | Store authorization and installed capability discovery. Start **Setup required**; never imply that entering a website URL creates a connector. [REST v3](https://developer.woocommerce.com/docs/apis/rest-api/v3/), [webhooks](https://developer.woocommerce.com/docs/apis/rest-api/v3/webhooks/). |

Shopify-specific implementation requirement: authoritative absolute inventory writes use compare-and-set. The current reference says the idempotency directive is required from API version 2026-04 onward. Pin a supported API version and test its exact mutation contract. [Inventory mutation contract](https://shopify.dev/docs/api/admin-graphql/latest/payloads/InventorySetQuantitiesPayload).

## Organization boundary and connection truth

Reuse `x-phantomforce-business` and the server-validated tenant from `server/BUSINESS_WORKSPACES.md`. Never accept ownership from a UI display name, request body, webhook tenant field or shop name. Every record, SKU mapping, token reference, inbox event, outbox command, cursor, job and audit receipt carries the validated tenant ID.

Use `(tenant_id, provider, connection_id, external_id)` as external-record identity. A provider account is bound to its authorized tenant by the server. Store credentials in the existing encrypted tenant vault; shared application credentials remain server infrastructure. A connection to Occasionally Odd cannot authorize ChicagoShots queries, AI retrieval, files or automations.

Separate connection state (`not_configured`, `authorization_required`, `validating`, `connected`, `degraded`, `revoked`, `unsupported`) from execution mode (`not_implemented`, `sandbox`, `live`, `import_only`). Only a real authenticated provider probe sets `connected`; only a completed provider operation advances its last-success receipt. Expose last attempt, last success, lag, granted capabilities and actionable error without secrets. A locally saved preference is **Configuration saved**, not **Connected**.

## Adapter, inbox and outbox contract

Proposed adapter surface:

```text
describeCapabilities(connection) -> per-operation availability/reason
beginAuthorization(tenant, user) -> one-time state bound to both
validateConnection(connection) -> verified external account and scopes
verifyWebhook(rawBody, headers, connection) -> trusted event identity
pullChanges(connection, cursor) -> normalized changes and next cursor
fetchOrder(connection, externalOrderId) -> current normalized order
publishInventory(connection, skuMapping, quantity, revision) -> receipt
publishFulfillment(connection, shipment, idempotencyKey) -> receipt
```

1. Validate signed webhook or authenticated import; resolve account to its server-owned connection and tenant. Allowlist provider fetch hosts rather than fetching arbitrary webhook resource URLs.
2. Durably write an inbox item keyed by provider delivery ID. Acknowledge only after persistence. Process at least once, with idempotent effects; duplicates must not create another order, customer, material reservation or production job.
3. Fetch current provider state when notifications are partial or unordered. Normalize money in minor units plus currency, UTC timestamps, source status, stable line IDs, SKU/variant mapping, personalization, payment state and ship-by deadline. Keep unknown fields/statuses visible rather than guessing.
4. Commit normalized order, reservations, production demand, audit events and outbox intents atomically. Unmapped SKUs, missing required details, material shortages or insufficient capacity enter an exception queue.
5. Claim outbox work with a lease, revalidate tenant connection/capabilities, execute, and save the provider receipt. Retry transient errors with bounded exponential backoff/jitter; honor provider rate limits. Expired authorization pauses only that connection. Permanent errors and uncertain duplicate-sensitive results require reconciliation.
6. Periodic cursor-based reconciliation closes webhook gaps. Keep replay/dead-letter tooling within the same tenant. The UI reads internal snapshots and receipts rather than directly calling providers.

For the current single-writer document store, order effects and outbox intents must share one atomic tenant snapshot. Separate file writes are not a transaction. Before enabling multiple writers, move this unit to organization-keyed database transactions and unique constraints. No external send may precede its durable intent.

## Global channel inventory and manufacturing

“Global” means shared across Occasionally Odd's channels only. Maintain one stock ledger for finished goods, work in progress, raw materials and components, with physical, reserved, quarantined and available balances. Track changes by order/line/job and reverse them explicitly on cancellation; never decrement again when replaying an imported order.

Made-to-order capacity is a separate ledger measured in compatible printer-hours over dated production windows. A SKU recipe records component quantities, material grams, expected print/setup hours, post-processing, packing time and printer compatibility. Reserve materials and capacity together, including uncertainty buffers. Shared materials and machines mean per-SKU availability cannot be independently summed.

```text
Finished-goods ATS = max(0, physical - reserved - quarantined - safety stock)
MTO promise = units feasible from BOTH unreserved materials AND compatible
              printer capacity before ship-by minus finishing/packing buffer
Channel offer = allowed allocation of ATS + eligible MTO promise
```

Publishing the entire shared quantity independently to every channel can oversell during synchronization lag. Use channel allocations/safety buffers with total allocated promises bounded by the shared pool, version inventory publications, and reconcile external changes. Preserve one authoritative order origin if Shopify also imports TikTok/Etsy orders; mark mirror references to prevent duplicates and update loops.

Workflow: authorized order -> SKU mapping/payment gate -> reserve -> production job -> queue -> printing -> QC -> packing -> ready to ship -> shipment receipt -> provider acknowledgment. Printer telemetry must display its actual source and last observation; manually entered status remains explicitly manual. A QC failure consumes actual materials, logs waste, and schedules a reprint without silently restoring stock. A label is not proof of carrier handoff or delivery.

Show projected lateness when reserved demand exceeds compatible capacity before deadlines, and mark missing recipe, runtime, material or deadline as unknown. A disconnected printer is not idle capacity. No marketplace capability alone authorizes unattended physical printer starts.

## Economics and implementation verification

Per-SKU contribution = item revenue less discounts, channel/payment fees, materials/components, expected failure waste, labor, packaging, shipping subsidy and machine/energy allocation. Store each assumption and distinguish estimate from settled provider fees. Contribution per printer-hour divides contribution by expected occupied printer-hours; zero or missing runtime is unknown, not infinite. Aggregate currencies separately unless an explicit dated conversion is supplied.

Required tests before live operations: cross-tenant reads/writes/events/tokens; forged and stale webhook rejection; duplicate/unordered events; simultaneous last-unit orders; shared BOM/capacity contention; cancellation/reprint ledger effects; crashes between inbox/transaction/outbox stages; expired tokens; rate limits; duplicate-sensitive fulfillment retries; catalog mirror loops; stale UI response after organization switch. Provider sandbox/authorization evidence and an actual successful probe are required before presenting any channel as live.
