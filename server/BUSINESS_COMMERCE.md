# Organization commerce and studio workspaces

Implemented September 27, 2026 on the existing local business-workspaces candidate.
Build: `phantom-live-20260927-235`. Deployed October 2, 2026 from application
commit `59386f09d7`; canonical UI/API and both public app hosts verified.

## Business boundary

The Organizations / Businesses selector owns the entire experience. Occasionally
Odd and ChicagoShots are independent profiles with their own navigation; the
shared shell never combines their operational datasets. The existing membership,
selected-business header, AI, credential, file and notification boundaries remain
in force. A switch reloads the document to discard old caches and requests.

The commerce routes require the `occasionallyodd` profile, including explicitly
mapped tenant IDs. ChicagoShots cannot read or mutate them. Administrators may
write; other authorized members may read. The ordinary application paywall and
authentication hooks still apply. Header, body and query scope must agree.

## API

- `GET /api/business-workspaces/commerce` returns `ok`, `tenant_id`, `canManage`,
  `state`, and calculated `summary`.
- `POST /api/business-workspaces/commerce/commands` accepts
  `{type, payload, expectedRevision}` and returns the same envelope plus
  `duplicate`. Send the authenticated bearer and `x-phantomforce-business`.
- Supported commands: create/update product, material and printer; create order;
  advance or fail a job; cancel or ship an order; adjust stock; configure channel.
  The discriminated schema in `commerce-store.ts` is authoritative.
- UI writes supply the revision read. A stale edit fails instead of overwriting
  newer work. A normalized repeat channel/order ID returns the original state;
  conflicting details fail. This API is normalized intake, not a public webhook.

## Inventory and production

One organization owns a single pool of finished goods, materials and components.
Order intake reserves finished goods first, then creates jobs for the remainder
and reserves their BOM quantities and printer hours. Materials are deducted once
at print start. Failed prints retain material waste and reserve a new attempt.
Jobs move through printing, quality check, packing, ready and recorded shipment.
Stock-only jobs still require quality check and packing. Cancellation releases
unspent reservations and returns only QC-passed manufactured output to stock.

Printer status and daily capacity are manually recorded. There is no device
control or live telemetry. Capacity and SLA warnings use full outstanding print
hours and configured daily hours; QC, packing and shipping time are excluded.
Per-SKU made-to-order estimates share the same capacity pool and cannot be summed.
Inbound orders can exceed material/capacity availability so a paid order is not
silently lost; warnings identify shortages and print start requires actual stock.

SKU contribution subtracts modeled channel fees, labor, overhead and BOM costs.
The fallback material cost applies only when no BOM is entered. Contribution per
printer-hour is an estimate, not settled profit. Current views use USD; tax,
payout reconciliation, returns, shipping-label purchase and refunds are not added.

Customer identities are tenant- and channel-scoped. An external customer ID is
authoritative. ID-less orders may reuse an ID-less customer with the same trimmed,
case-insensitive email in that channel. Names alone never merge customers; order
customer snapshots remain unchanged.

## Channels

TikTok Shop, Etsy, eBay, Shopify, WooCommerce and generic storefront cards expose
setup preferences. Facebook Marketplace explicitly requires separate capability
verification; Meta catalog access is not evidence of personal Marketplace API access.
No card can claim connected status. No credentials are accepted into these records.

Inventory and fulfillment obligations persist in an outbox as blocked. Inventory
offers conservatively divide globally available finished units among enabled
channels; total offers cannot exceed the pool. Disabled channels retain a zero
withdrawal intent. No MTO quantity is published and no external request is made.
Provider OAuth, encrypted account credentials, signed webhook adapters, cursor
reconciliation, retries, multi-shop identities and verified execution receipts
must be implemented before enabling live synchronization. See the sourced channel
architecture document for current official capabilities and the proposed contract.

## ChicagoShots

Media services navigation includes Leads, CRM, Bookings, Calendar, Projects,
Deliverables, Invoices, Gear, Marketing and Analytics. Existing CRM, accounting,
creative and campaign systems are reused under their selected organization.
New media projects and gear are durable scoped business records. Gear supports
asset tags, assignment, location and available/reserved/checked-out/maintenance
states. Calendar is an agenda of dated studio plans; external calendar sync is
not claimed. Dates do not create provider bookings or send customer messages.

## Storage and deployment constraints

The commerce store follows the existing single-process durable document pattern:
tenant-hashed filenames, strict schema/reference validation, serialized mutations,
atomic replacement, revision checks, and a command audit. Corrupt data fails closed.
`PHANTOMFORCE_BUSINESS_COMMERCE_DIR` selects the private storage root. Multiple
server writers require a transactional tenant-keyed database before deployment.
Existing draft order/product tracker records are preserved; no ambiguous data is
automatically converted into inventory, financial balances or operational orders.

## Verification

`npm run test:business-commerce` exercises navigation, renderer boundaries, actual
domain mutations, actual application HTTP authentication and scoped studio records.
`npm run test:business-workspaces` retains the prior platform isolation suite.
All fixtures are disposable; no production data, real customer, provider, carrier,
printer or marketplace is touched. Browser QA additionally exercises actual forms,
the complete order-to-shipment path, reload persistence and responsive switching.
