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

// Physical products keep shipping at checkout.
assert.match(html, /name="address"/u, "physical store should render shipping fields at checkout.");
assert.match(html, /data-shipping/u, "shipping block should be toggleable for mixed carts.");
assert.match(html, /Test mode — no real charge/u, "checkout must carry the test-mode label.");

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

/* ---- digital product store (Termina) ---- */

const digitalHtml = renderSiteHtml({
  title: "Termina — store",
  sections: ["Hero", "Organize sessions", "AI prompt composer", "Works in every shell", "Pricing", "FAQ", "Store", "Checkout"],
  design: {
    brand: "Termina",
    headline: "Your terminal, organized. Your prompts, on tap.",
    subhead: "Termina keeps every project's shells, tabs, and AI prompts one keystroke away.",
    cta: "Get Termina",
    theme: "neon",
  },
  copy: {
    "organize sessions": "Group tabs by project, not by accident. Termina saves every window, tab, and working directory as a named session.",
    pricing: "Termina Personal — $29, one-time.\nTermina Pro — $79 per year.",
  },
  products: [
    {
      id: "termina-personal",
      name: "Termina Personal",
      price: 29,
      cadence: "one_time",
      type: "digital",
      delivery_url: "https://termina.example.com/download",
      delivery_note: "Your license key and download link are emailed within a few minutes.",
      desc: "One-time license for one person.",
      visible: true,
    },
    {
      id: "termina-pro",
      name: "Termina Pro",
      price: 79,
      cadence: "yearly",
      type: "digital",
      delivery_url: "",
      delivery_note: "Your Termina Pro license key and download link are emailed to your checkout address.",
      desc: "Synced sessions and shared team prompt libraries.",
      visible: true,
    },
  ],
  store: { enabled: true, currency: "USD", checkoutMode: "test", paymentsConnected: false },
});

// Digital checkout must not ask for shipping.
assert.doesNotMatch(digitalHtml, /name="address"/u, "digital-only checkout must not render a shipping address field.");
assert.doesNotMatch(digitalHtml, /name="city"/u, "digital-only checkout must not render a city field.");
assert.doesNotMatch(digitalHtml, /name="postal"/u, "digital-only checkout must not render a postal code field.");
assert.match(digitalHtml, /Digital order — nothing ships/u, "digital-only checkout should explain that nothing ships.");

// Receipt must be able to show the delivery block, honestly labeled.
assert.match(digitalHtml, /Your digital delivery/u, "receipt must include the digital delivery block.");
assert.match(digitalHtml, /license key and download link are emailed/u, "owner delivery note must reach the receipt.");
assert.match(digitalHtml, /https:\/\/termina\.example\.com\/download/u, "owner delivery URL must reach the receipt.");
assert.match(digitalHtml, /Test mode — no real charge/u, "digital checkout must carry the test-mode label.");
assert.match(digitalHtml, /No payment was collected/u, "digital receipt must not imply a real payment.");

// Real template copy and yearly pricing render on the page.
assert.match(digitalHtml, /Group tabs by project, not by accident/u, "template section copy should render.");
assert.match(digitalHtml, /\$79(?:\.00)? \/ year/u, "yearly cadence should render.");
assert.match(digitalHtml, /Digital download — delivered by link or email/u, "digital products must be labeled on the product card.");
assert.doesNotMatch(digitalHtml, /<script[^>]+src=/iu, "digital store must not include external scripts.");

console.log("Site store render checks passed (physical + digital).");
