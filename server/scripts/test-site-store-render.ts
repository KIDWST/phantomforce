import assert from "node:assert/strict";

import { renderSiteHtml } from "../src/sites/publishing.js";

const html = renderSiteHtml({
  title: "ChicagoShots Store",
  sections: ["Hero", "Products", "Checkout", "Contact"],
  design: {
    brand: "ChicagoShots",
    headline: "Sports media packages",
    subhead: "Book media work without pretending checkout is live.",
    cta: "Review packages",
    theme: "gold",
  },
  products: [
    {
      id: "setup-sprint",
      name: "Setup Sprint",
      price: 1500,
      cadence: "one_time",
      desc: "One clean launch package.",
      visible: true,
    },
    {
      id: "monthly-care",
      name: "Monthly <Care>",
      price: 300,
      cadence: "monthly",
      desc: "Ongoing updates.",
      visible: true,
    },
    {
      id: "hidden-draft",
      name: "Hidden Draft",
      price: 9999,
      cadence: "one_time",
      desc: "Should not publish.",
      visible: false,
    },
  ],
  store: {
    enabled: true,
    currency: "USD",
    checkoutMode: "test",
    paymentsConnected: false,
  },
});

assert.match(html, /Setup Sprint/u, "visible product should render.");
assert.match(html, /Monthly &lt;Care&gt;/u, "monthly visible product should render escaped.");
assert.match(html, /\$1,500/u, "one-time product price should render.");
assert.match(html, /\$300(?:\.00)? \/ month/u, "monthly product cadence should render.");
assert.doesNotMatch(html, /Hidden Draft/u, "hidden products should not publish.");
assert.doesNotMatch(html, /Monthly <Care>/u, "product names must not render as raw HTML.");
assert.match(html, /const html =/u, "cart script should escape client-rendered product names and ids.");
assert.match(html, /Test checkout only\. No payment is collected/u, "published store must be honest about test checkout.");
assert.match(html, /No payment was collected/u, "test order receipt must not imply a real payment.");
assert.doesNotMatch(html, /<script[^>]+src=/iu, "published site must not include external scripts.");

console.log("Site store render checks passed.");
