import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyVerifiedCommerceEvent,
  commerceOrderSummary,
  createCommerceOrder,
  getCommerceOrders,
  updateCommerceFulfillment,
} from "../src/commerce/commerce-order-store.js";

const root = await mkdtemp(join(tmpdir(), "phantomforce-commerce-"));

try {
  const digital = await createCommerceOrder({
    tenantId: "seller-a",
    actor: "buyer@example.test",
    idempotencyKey: "checkout:digital:1",
    root,
    order: {
      mode: "test",
      currency: "USD",
      buyerEmail: "buyer@example.test",
      shippingMinor: 2500,
      items: [
        { productId: "download", name: "Digital Studio", type: "digital", unitAmountMinor: 2901, quantity: 2 },
      ],
    },
  });
  assert.equal(digital.result.order.subtotalMinor, 5802);
  assert.equal(digital.result.order.shippingRequired, false);
  assert.equal(digital.result.order.shippingAddress, null);
  assert.equal(digital.result.order.shippingMinor, 0, "digital-only orders must omit shipping even when a caller supplies a value");
  assert.equal(digital.result.order.totalMinor, 5802);

  const retried = await createCommerceOrder({
    tenantId: "seller-a",
    actor: "buyer@example.test",
    idempotencyKey: "checkout:digital:1",
    root,
    order: {
      mode: "test",
      currency: "USD",
      buyerEmail: "changed@example.test",
      items: [{ name: "Must not replace snapshot", type: "digital", unitAmountMinor: 1, quantity: 1 }],
    },
  });
  assert.equal(retried.result.created, false);
  assert.equal(retried.result.order.id, digital.result.order.id);
  assert.equal(retried.result.order.totalMinor, 5802, "order snapshots must remain immutable across retries");

  const live = await createCommerceOrder({
    tenantId: "seller-a",
    actor: "buyer@example.test",
    idempotencyKey: "checkout:physical:1",
    root,
    order: {
      mode: "live",
      currency: "USD",
      buyerEmail: "buyer@example.test",
      shippingMinor: 599,
      taxMinor: 300,
      shippingAddress: {
        line1: "1 Market Street",
        city: "Montréal",
        region: "QC",
        postalCode: "H2Y 1C6",
        country: "CA",
      },
      items: [
        { productId: "shirt", name: "Phantom Shirt", type: "physical", unitAmountMinor: 2500, quantity: 2 },
      ],
    },
  });
  assert.equal(live.result.order.shippingRequired, true);
  assert.equal(live.result.order.totalMinor, 5899);

  await assert.rejects(
    applyVerifiedCommerceEvent({
      tenantId: "seller-a",
      provider: "stripe-connect",
      providerEventId: "evt-unverified",
      signatureVerified: false,
      orderId: live.result.order.id,
      eventType: "payment_succeeded",
      amountMinor: 5899,
      root,
    }),
    /commerce_provider_signature_required/u,
  );

  await assert.rejects(
    applyVerifiedCommerceEvent({
      tenantId: "seller-a",
      provider: "stripe-connect",
      providerEventId: "evt-wrong-total",
      signatureVerified: true,
      orderId: live.result.order.id,
      eventType: "payment_succeeded",
      amountMinor: 5800,
      root,
    }),
    /commerce_payment_total_mismatch/u,
  );

  const payment = await applyVerifiedCommerceEvent({
    tenantId: "seller-a",
    provider: "stripe-connect",
    providerEventId: "evt-paid-1",
    signatureVerified: true,
    orderId: live.result.order.id,
    eventType: "payment_succeeded",
    amountMinor: 5899,
    providerPaymentId: "pi_verified",
    root,
  });
  assert.equal(payment.result.order.status, "fulfillment_pending");

  const duplicatePayment = await applyVerifiedCommerceEvent({
    tenantId: "seller-a",
    provider: "stripe-connect",
    providerEventId: "evt-paid-1",
    signatureVerified: true,
    orderId: live.result.order.id,
    eventType: "payment_succeeded",
    amountMinor: 5899,
    providerPaymentId: "pi_verified",
    root,
  });
  assert.equal(duplicatePayment.result.duplicate, true);
  assert.equal(duplicatePayment.result.receipt.id, payment.result.receipt.id);

  const fulfilled = await updateCommerceFulfillment({
    tenantId: "seller-a",
    actor: "owner@example.test",
    orderId: live.result.order.id,
    fulfilled: true,
    note: "Carrier receipt verified.",
    root,
  });
  assert.equal(fulfilled.result.status, "fulfilled");

  const partialRefund = await applyVerifiedCommerceEvent({
    tenantId: "seller-a",
    provider: "stripe-connect",
    providerEventId: "evt-refund-1",
    signatureVerified: true,
    orderId: live.result.order.id,
    eventType: "refund_succeeded",
    amountMinor: 899,
    root,
  });
  assert.equal(partialRefund.result.order.status, "partially_refunded");
  assert.equal(partialRefund.result.order.refundedMinor, 899);

  const fullRefund = await applyVerifiedCommerceEvent({
    tenantId: "seller-a",
    provider: "stripe-connect",
    providerEventId: "evt-refund-2",
    signatureVerified: true,
    orderId: live.result.order.id,
    eventType: "refund_succeeded",
    amountMinor: 5000,
    root,
  });
  assert.equal(fullRefund.result.order.status, "refunded");
  await assert.rejects(
    applyVerifiedCommerceEvent({
      tenantId: "seller-a",
      provider: "stripe-connect",
      providerEventId: "evt-refund-too-much",
      signatureVerified: true,
      orderId: live.result.order.id,
      eventType: "refund_succeeded",
      amountMinor: 1,
      root,
    }),
    /commerce_refund_exceeds_payment/u,
  );

  const summary = commerceOrderSummary(await getCommerceOrders("seller-a", "owner", root));
  assert.equal(summary.testOrderCount, 1);
  assert.equal(summary.liveOrderCount, 1);
  assert.equal(summary.grossPaidMinor, 5899, "test order money must not enter actual revenue");
  assert.equal(summary.refundedMinor, 5899);
  assert.equal(summary.netPaidMinor, 0);

  const otherTenant = commerceOrderSummary(await getCommerceOrders("seller-b", "owner", root));
  assert.equal(otherTenant.liveOrderCount, 0);
  assert.equal(otherTenant.grossPaidMinor, null);

  console.log(JSON.stringify({
    ok: true,
    product: "Commerce order lifecycle",
    immutableSnapshots: true,
    minorUnitMath: true,
    digitalShippingOmission: true,
    verifiedEventsOnly: true,
    webhookIdempotency: true,
    testRevenueExcluded: true,
    fulfillmentTransitions: true,
    refundTransitions: true,
    tenantIsolation: true,
  }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
