/* PhantomForce website publishing pipeline.
   Draft (in-browser builder) → registered build (validated static HTML on
   disk + DB row) → approval-gated publish (via the ONE agent-run engine) →
   verified deployment with a receipt → rollback to any prior version.

   Nothing here pretends: a site is "published" only when a validated build
   was promoted by an approved run, the deployment row exists, and the served
   content hash matches the build on disk. Domains are never "connected"
   because someone typed them — the DNS adapter has to verify ownership. */

import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { PrismaClient } from "@prisma/client";

import { getOrgEntitlements, orgHasFeature } from "../access/entitlements.js";
import { prisma } from "../access/prisma-runtime.js";
import { recordOrgAuditEvent } from "../access/user-accounts.js";
import { registerAgentRunExecutor } from "../phantom-ai/agent-runs.js";
import { getDnsAdapter, isPlausibleDomain } from "./dns-adapter.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const BUILDS_DIR = resolve(repoRoot, ".phantom", "site-builds");
const MAX_BUILD_BYTES = 512 * 1024;

function requirePrisma(): PrismaClient {
  if (!prisma) throw new Error("Site publishing requires DATABASE_URL (Prisma repository mode).");
  return prisma;
}

const esc = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
const money = (value: number, currency = "USD") => new Intl.NumberFormat("en-US", {
  style: "currency",
  currency,
  maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
}).format(value);

export type SiteSnapshot = {
  siteId?: string;
  title: string;
  sections: string[];
  design: {
    brand?: string;
    headline?: string;
    subhead?: string;
    offer?: string;
    cta?: string;
    theme?: string;
    style?: string;
  };
  /* optional real section content keyed by lowercased section name */
  copy?: Record<string, string>;
  products?: Array<{
    id: string;
    name: string;
    price: number;
    cadence: "one_time" | "monthly" | "yearly";
    /* digital products skip shipping and carry delivery details for the
       receipt; absent type means physical (every pre-existing product). */
    type?: "physical" | "digital";
    delivery_url?: string;
    delivery_note?: string;
    desc: string;
    visible: boolean;
  }>;
  store?: {
    enabled: boolean;
    currency: string;
    checkoutMode: "test";
    paymentsConnected: false;
  };
};

const isDigital = (product: { type?: string }) => product.type === "digital";
const cadenceSuffix = (cadence?: string) =>
  cadence === "monthly" ? " / month" : cadence === "yearly" ? " / year" : "";

const THEME_COLORS: Record<string, { bg: string; accent: string; ink: string }> = {
  dark: { bg: "#0c1116", accent: "#41ffa1", ink: "#eef4f0" },
  gold: { bg: "#161206", accent: "#ffd166", ink: "#fff6e0" },
  light: { bg: "#f7f8fa", accent: "#0f7b5f", ink: "#15221c" },
  crimson: { bg: "#160a0c", accent: "#ff5964", ink: "#ffeef0" },
  /* parity with the in-app builder themes so a published build matches the preview */
  neon: { bg: "#04120c", accent: "#41ffa1", ink: "#e8fff2" },
  blue: { bg: "#070f1a", accent: "#6cb8ff", ink: "#eaf4ff" },
  red: { bg: "#160a0c", accent: "#ff5964", ink: "#ffeef0" },
  purple: { bg: "#0e0916", accent: "#c9a4ff", ink: "#f4ecff" },
};

/* Deterministic server-side static rendering — self-contained HTML, no
   external requests, everything escaped. */
export function renderSiteHtml(snapshot: SiteSnapshot): string {
  const theme = THEME_COLORS[snapshot.design.theme ?? "dark"] ?? THEME_COLORS.dark;
  const products = (snapshot.products ?? []).filter((product) => product.visible !== false);
  const storeEnabled = Boolean(snapshot.store?.enabled || products.length);
  const currency = snapshot.store?.currency || "USD";
  /* a catalog of only digital products never needs shipping fields at all;
     any physical product renders them (the cart script hides them again for
     digital-only carts) */
  const hasPhysicalProducts = products.some((product) => !isDigital(product));
  const productCards = products.length
    ? products.map((product) => `<article class="product">
        <div class="product-art" aria-hidden="true">${esc(product.name.slice(0, 1).toUpperCase())}</div>
        <div><h3>${esc(product.name)}</h3><p>${esc(product.desc)}</p>${isDigital(product) ? `<small class="digital-tag">Digital download — delivered by link or email, nothing ships</small>` : ""}</div>
        <footer><b>${esc(money(product.price, currency))}${cadenceSuffix(product.cadence)}</b><button type="button" data-add="${esc(product.id)}">Add to cart</button></footer>
      </article>`).join("")
    : `<div class="empty-store"><b>Store inventory is being prepared.</b><p>Check back after the next approved catalog update.</p></div>`;
  const copyFor = (section: string) => {
    const text = snapshot.copy?.[section.toLowerCase()];
    return typeof text === "string" && text.trim() ? text : null;
  };
  const sections = snapshot.sections
    .map((section) => {
      const key = section.toLowerCase();
      if (key === "store" || key === "products") {
        return `<section id="${esc(key)}" class="store-section"><div class="section-heading"><div><small>STORE</small><h2>${esc(section)}</h2></div>${storeEnabled ? `<button type="button" class="open-cart">Cart <span data-cart-count>0</span></button>` : ""}</div><div class="products">${productCards}</div></section>`;
      }
      if (key === "checkout") {
        return `<section id="checkout"><h2>Checkout</h2><p>${storeEnabled ? "Choose an offer above, then review your cart. This preview checkout records no payment." : "Checkout becomes available when the store has an approved offer."}</p>${storeEnabled ? `<button type="button" class="open-cart secondary">Review cart</button>` : ""}</section>`;
      }
      /* real section content (templates fill this) beats the generic fallback */
      const custom = copyFor(section);
      const body = custom
        ? custom.split(/\n+/).map((line) => `<p>${esc(line)}</p>`).join("")
        : key === "contact"
          ? `<p>Reach ${esc(snapshot.design.brand || snapshot.title)} — contact details go live once connected.</p>`
          : key === "offer" && snapshot.design.offer
            ? `<p>${esc(snapshot.design.offer)}</p>`
            : `<p>${esc(snapshot.design.subhead || "")}</p>`;
      return `<section id="${esc(key.replace(/\s+/g, "-"))}"><h2>${esc(section)}</h2>${body}</section>`;
    })
    .join("\n");
  const storeUi = storeEnabled ? `
<button type="button" class="floating-cart open-cart" aria-label="Open cart">Cart <span data-cart-count>0</span></button>
<div class="cart-backdrop" hidden>
  <aside class="cart" role="dialog" aria-modal="true" aria-labelledby="cart-title">
    <header><div><small>YOUR ORDER</small><h2 id="cart-title">Cart</h2></div><button type="button" class="close-cart" aria-label="Close cart">×</button></header>
    <div class="cart-items"></div>
    <div class="cart-total"><span>Total</span><b>$0</b></div>
    <form class="test-checkout" hidden>
      <label>Name<input name="name" autocomplete="name" required></label>
      <label>Email<input name="email" type="email" autocomplete="email" required></label>
      ${hasPhysicalProducts ? `<div class="shipping" data-shipping>
        <small>SHIPPING</small>
        <label>Address<input name="address" autocomplete="street-address" required></label>
        <label>City<input name="city" autocomplete="address-level2" required></label>
        <label>Postal code<input name="postal" autocomplete="postal-code" required></label>
      </div>` : `<p class="digital-note">Digital order — nothing ships. Delivery details appear on your receipt and go to the email above.</p>`}
      <p class="test-mode">Test mode — no real charge</p>
      <button type="submit">Place test order</button>
      <small>Test checkout only. No payment is collected and nothing is sent externally.</small>
    </form>
    <button type="button" class="start-checkout">Continue to test checkout</button>
    <div class="receipt" role="status"></div>
  </aside>
</div>` : "";
  const storeScript = storeEnabled ? `
<script>
(() => {
  const products = ${scriptJson(products.map(({ id, name, price, cadence, type, delivery_url, delivery_note }) => ({
    id,
    name,
    price,
    cadence,
    type: type === "digital" ? "digital" : "physical",
    delivery_url: type === "digital" && typeof delivery_url === "string" && /^https?:\/\//i.test(delivery_url) ? delivery_url : "",
    delivery_note: type === "digital" && typeof delivery_note === "string" ? delivery_note : "",
  })))};
  const currency = ${scriptJson(currency)};
  const cart = new Map();
  const backdrop = document.querySelector('.cart-backdrop');
  const items = document.querySelector('.cart-items');
  const checkout = document.querySelector('.test-checkout');
  const start = document.querySelector('.start-checkout');
  const receipt = document.querySelector('.receipt');
  const fmt = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
  const html = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const shipping = document.querySelector('[data-shipping]');
  function syncShipping(rows) {
    if (!shipping) return;
    /* digital-only carts skip shipping — email is the delivery address */
    const needs = rows.some((row) => row.product.type !== 'digital');
    shipping.hidden = !needs;
    shipping.querySelectorAll('input').forEach((input) => { input.disabled = !needs; input.required = needs; });
  }
  function cartRows() {
    return [...cart].map(([id, qty]) => ({ product: products.find((item) => item.id === id), qty })).filter((row) => row.product);
  }
  function render() {
    const rows = cartRows();
    items.innerHTML = rows.length ? rows.map(({ product, qty }) => {
      const id = html(product.id);
      return '<article><div><b>' + html(product.name) + (product.type === 'digital' ? ' <i class="digital-flag">digital</i>' : '') + '</b><span>' + fmt(product.price * qty) + '</span></div><div class="qty"><button type="button" data-qty="' + id + '" data-delta="-1">−</button><span>' + qty + '</span><button type="button" data-qty="' + id + '" data-delta="1">+</button><button type="button" data-remove="' + id + '">Remove</button></div></article>';
    }).join('') : '<p class="cart-empty">Your cart is empty.</p>';
    const count = rows.reduce((sum, row) => sum + row.qty, 0);
    const total = rows.reduce((sum, row) => sum + row.product.price * row.qty, 0);
    document.querySelectorAll('[data-cart-count]').forEach((node) => { node.textContent = String(count); });
    document.querySelector('.cart-total b').textContent = fmt(total);
    start.disabled = !rows.length;
    if (!rows.length) { checkout.hidden = true; start.hidden = false; }
    syncShipping(rows);
  }
  document.addEventListener('click', (event) => {
    const add = event.target.closest('[data-add]');
    if (add) { const id = add.dataset.add; cart.set(id, (cart.get(id) || 0) + 1); render(); backdrop.hidden = false; return; }
    if (event.target.closest('.open-cart')) { backdrop.hidden = false; return; }
    if (event.target.closest('.close-cart') || event.target === backdrop) { backdrop.hidden = true; return; }
    const qty = event.target.closest('[data-qty]');
    if (qty) { const next = Math.min(99, (cart.get(qty.dataset.qty) || 0) + Number(qty.dataset.delta)); next > 0 ? cart.set(qty.dataset.qty, next) : cart.delete(qty.dataset.qty); render(); return; }
    const remove = event.target.closest('[data-remove]');
    if (remove) { cart.delete(remove.dataset.remove); render(); }
  });
  start.addEventListener('click', () => { start.hidden = true; checkout.hidden = false; checkout.querySelector('input').focus(); });
  checkout.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(checkout);
    const rows = cartRows();
    const orderId = 'PF-TEST-' + Date.now().toString(36).toUpperCase();
    const digital = rows.filter((row) => row.product.type === 'digital');
    const delivery = digital.length
      ? '<span class="delivery"><b>Your digital delivery</b>' + digital.map(({ product }) =>
          '<span>' + html(product.name)
          + (product.delivery_url ? ' — <a href="' + html(product.delivery_url) + '" rel="noopener">access link</a>' : '')
          + (product.delivery_note ? ' — ' + html(product.delivery_note) : (product.delivery_url ? '' : ' — the store owner will email your access details'))
          + '</span>').join('') + '</span>'
      : '';
    receipt.innerHTML = '<b>Test order ' + orderId + ' confirmed for ' + html(data.get('name')) + '.</b>'
      + '<span class="test-mode-chip">Test mode — no real charge</span>'
      + '<span>No payment was collected.</span>' + delivery;
    cart.clear(); checkout.reset(); checkout.hidden = true; start.hidden = false; render();
  });
  render();
})();
</script>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(snapshot.title)}</title>
<style>
  :root { color-scheme: dark light; }
  * { box-sizing: border-box; margin: 0; }
  body { font: 16px/1.6 system-ui, sans-serif; background: ${theme.bg}; color: ${theme.ink}; }
  button, input { font: inherit; }
  header { padding: 72px 24px; text-align: center; }
  header h1 { font-size: clamp(28px, 6vw, 52px); }
  header p { margin-top: 12px; opacity: .8; }
  .cta { display: inline-block; margin-top: 24px; padding: 12px 28px; border-radius: 999px; background: ${theme.accent}; color: ${theme.bg}; font-weight: 700; text-decoration: none; }
  section { max-width: 860px; margin: 0 auto; padding: 40px 24px; border-top: 1px solid ${theme.accent}33; }
  section h2 { color: ${theme.accent}; margin-bottom: 10px; }
  .section-heading, .product footer, .cart header, .cart-total, .qty { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .section-heading small, .cart small { color: ${theme.accent}; font-weight: 800; letter-spacing: .16em; }
  .products { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; margin-top: 18px; }
  .product, .empty-store { display: grid; gap: 16px; padding: 18px; border: 1px solid ${theme.accent}35; border-radius: 16px; background: ${theme.accent}08; }
  .product-art { display: grid; place-items: center; width: 48px; height: 48px; border-radius: 12px; background: ${theme.accent}; color: ${theme.bg}; font-size: 22px; font-weight: 900; }
  .product p, .empty-store p { opacity: .72; }
  .product button, .open-cart, .start-checkout, .test-checkout button { border: 0; border-radius: 999px; padding: 10px 15px; background: ${theme.accent}; color: ${theme.bg}; font-weight: 800; cursor: pointer; }
  .secondary { margin-top: 16px; }
  .floating-cart { position: fixed; z-index: 5; right: 18px; bottom: 18px; box-shadow: 0 12px 40px #0008; }
  .cart-backdrop { position: fixed; z-index: 10; inset: 0; padding: 18px; background: #000b; backdrop-filter: blur(9px); }
  .cart-backdrop[hidden], .test-checkout[hidden], .start-checkout[hidden] { display: none; }
  .cart { width: min(440px, 100%); max-height: calc(100dvh - 36px); overflow: auto; margin-left: auto; padding: 22px; border: 1px solid ${theme.accent}55; border-radius: 20px; background: ${theme.bg}; box-shadow: 0 24px 90px #000b; }
  .close-cart { width: 38px; height: 38px; border: 1px solid ${theme.accent}44; border-radius: 50%; background: transparent; color: ${theme.ink}; font-size: 24px; cursor: pointer; }
  .cart-items { display: grid; gap: 10px; margin: 18px 0; }
  .cart-items article { display: grid; gap: 10px; padding: 12px; border: 1px solid ${theme.accent}30; border-radius: 12px; }
  .qty { justify-content: flex-start; }
  .qty button { min-width: 34px; min-height: 34px; border: 1px solid ${theme.accent}35; border-radius: 8px; background: transparent; color: ${theme.ink}; cursor: pointer; }
  .qty button:last-child { margin-left: auto; }
  .cart-total { padding: 15px 0; border-top: 1px solid ${theme.accent}35; font-size: 20px; }
  .test-checkout { display: grid; gap: 12px; }
  .test-checkout label { display: grid; gap: 5px; }
  .test-checkout input { width: 100%; padding: 11px; border: 1px solid ${theme.accent}45; border-radius: 10px; background: transparent; color: ${theme.ink}; }
  .digital-tag { display: block; margin-top: 6px; color: ${theme.accent}; font-weight: 700; font-size: 12px; }
  .digital-flag { font-style: normal; margin-left: 6px; padding: 1px 7px; border: 1px solid ${theme.accent}55; border-radius: 999px; font-size: 10px; color: ${theme.accent}; }
  .shipping { display: grid; gap: 12px; padding: 12px; border: 1px solid ${theme.accent}30; border-radius: 12px; }
  .shipping small { color: ${theme.accent}; font-weight: 800; letter-spacing: .16em; }
  .shipping[hidden] { display: none; }
  .digital-note { padding: 10px 12px; border: 1px dashed ${theme.accent}55; border-radius: 10px; opacity: .82; font-size: 13px; }
  .test-mode { padding: 6px 10px; border: 1px solid #ffd16666; border-radius: 999px; text-align: center; color: #ffd166; font-weight: 800; font-size: 12px; letter-spacing: .05em; text-transform: uppercase; }
  .receipt { display: grid; gap: 8px; margin-top: 14px; color: ${theme.accent}; font-weight: 700; }
  .receipt:empty { display: none; }
  .test-mode-chip { justify-self: start; padding: 3px 9px; border: 1px solid #ffd16666; border-radius: 999px; color: #ffd166; font-size: 11px; letter-spacing: .05em; text-transform: uppercase; }
  .receipt .delivery { display: grid; gap: 5px; padding: 10px 12px; border: 1px solid ${theme.accent}40; border-radius: 12px; color: ${theme.ink}; font-weight: 500; font-size: 13px; }
  .receipt .delivery b, .receipt .delivery a { color: ${theme.accent}; }
  footer { padding: 40px 24px; text-align: center; opacity: .6; font-size: 13px; }
  @media (max-width: 600px) { header { padding: 54px 20px; } section { padding: 32px 20px; } .cart-backdrop { padding: 8px; } .cart { max-height: calc(100dvh - 16px); } }
</style>
</head>
<body>
<header>
  <h1>${esc(snapshot.design.headline || snapshot.title)}</h1>
  ${snapshot.design.subhead ? `<p>${esc(snapshot.design.subhead)}</p>` : ""}
  ${snapshot.design.cta ? `<a class="cta" href="#contact">${esc(snapshot.design.cta)}</a>` : ""}
</header>
${sections}
${storeUi}
<footer>${esc(snapshot.design.brand || snapshot.title)} · Published with PhantomForce</footer>
${storeScript}
</body>
</html>`;
}

function validateBuild(html: string, snapshot: SiteSnapshot): { ok: boolean; log: string[] } {
  const log: string[] = [];
  let ok = true;
  const bytes = Buffer.byteLength(html, "utf8");
  log.push(`size: ${bytes} bytes (limit ${MAX_BUILD_BYTES})`);
  if (bytes > MAX_BUILD_BYTES) { ok = false; log.push("FAIL: build exceeds size limit"); }
  if (!html.includes("<title>")) { ok = false; log.push("FAIL: missing <title>"); } else log.push("ok: <title> present");
  for (const section of snapshot.sections) {
    const id = section.toLowerCase().replace(/\s+/g, "-");
    if (html.includes(`id="${id}"`)) log.push(`ok: section "${section}" rendered`);
    else { ok = false; log.push(`FAIL: section "${section}" missing from output`); }
  }
  if (/<script[^>]+src=/i.test(html)) { ok = false; log.push("FAIL: external scripts are not allowed in published builds"); }
  else log.push("ok: no external scripts");
  if ((snapshot.products ?? []).some((product) => product.visible !== false)) {
    for (const product of snapshot.products ?? []) {
      if (product.visible === false) continue;
      if (html.includes(esc(product.name))) log.push(`ok: product "${product.name}" rendered`);
      else { ok = false; log.push(`FAIL: product "${product.name}" missing from output`); }
    }
    if (html.includes("Test checkout only. No payment is collected")) log.push("ok: safe test checkout rendered");
    else { ok = false; log.push("FAIL: safe test checkout missing"); }
    if (html.includes("Test mode — no real charge")) log.push("ok: test-mode label rendered at payment");
    else { ok = false; log.push("FAIL: test-mode label missing from checkout"); }
    const visibleProducts = (snapshot.products ?? []).filter((product) => product.visible !== false);
    if (visibleProducts.every((product) => product.type === "digital")) {
      if (!/name="address"/.test(html)) log.push("ok: digital-only store renders no shipping fields");
      else { ok = false; log.push("FAIL: digital-only store must not ask for shipping"); }
    } else if (/name="address"/.test(html)) log.push("ok: shipping fields rendered for physical products");
    else { ok = false; log.push("FAIL: physical products need shipping fields at checkout"); }
  }
  log.push(ok ? "RESULT: validated" : "RESULT: failed");
  return { ok, log };
}

export function contentHash(html: string) {
  return createHash("sha256").update(html).digest("hex");
}

/* ---------------- builds ---------------- */

export async function createSiteBuild(input: {
  orgId: string;
  actorUserId: string | null;
  actorEmail: string;
  snapshot: SiteSnapshot;
}) {
  const db = requirePrisma();
  const feature = await orgHasFeature(input.orgId, "websites");
  if (!feature.allowed) return { ok: false as const, error: "feature_not_available", reason: feature.reason };

  let site = input.snapshot.siteId
    ? await db.site.findFirst({ where: { id: input.snapshot.siteId, orgId: input.orgId } })
    : null;
  if (input.snapshot.siteId && !site) return { ok: false as const, error: "site_not_found_in_org" };
  if (!site) {
    const entitlements = await getOrgEntitlements(input.orgId);
    const siteCount = await db.site.count({ where: { orgId: input.orgId } });
    if (siteCount >= entitlements.limits.sitesPerOrg) {
      return { ok: false as const, error: "site_limit_reached", limit: entitlements.limits.sitesPerOrg };
    }
    site = await db.site.create({ data: { orgId: input.orgId, title: input.snapshot.title.slice(0, 160) } });
  } else if (site.title !== input.snapshot.title) {
    site = await db.site.update({ where: { id: site.id }, data: { title: input.snapshot.title.slice(0, 160) } });
  }

  const html = renderSiteHtml(input.snapshot);
  const validation = validateBuild(html, input.snapshot);
  const latest = await db.siteBuild.findFirst({ where: { siteId: site.id }, orderBy: { version: "desc" } });
  const version = (latest?.version ?? 0) + 1;
  const contentPath = resolve(BUILDS_DIR, site.id, `v${version}`, "index.html");
  await mkdir(dirname(contentPath), { recursive: true });
  await writeFile(contentPath, html, "utf8");

  const build = await db.siteBuild.create({
    data: {
      siteId: site.id,
      orgId: input.orgId,
      version,
      status: validation.ok ? "validated" : "failed",
      contentPath,
      buildLog: validation.log.join("\n"),
      createdByUserId: input.actorUserId,
    },
  });
  return { ok: true as const, site, build, validated: validation.ok, buildLog: validation.log };
}

export async function getBuildHtml(orgId: string, siteId: string, buildId: string) {
  const db = requirePrisma();
  const build = await db.siteBuild.findFirst({ where: { id: buildId, siteId, orgId } });
  if (!build) return null;
  try {
    return await readFile(build.contentPath, "utf8");
  } catch {
    return null;
  }
}

/* ---------------- deployments ---------------- */

export async function getCurrentDeployment(siteId: string) {
  const db = requirePrisma();
  return db.siteDeployment.findFirst({
    where: { siteId, status: "published" },
    orderBy: { publishedAt: "desc" },
    include: { build: true },
  });
}

export async function getPublishedHtml(siteId: string) {
  const deployment = await getCurrentDeployment(siteId);
  if (!deployment) return null;
  try {
    const html = await readFile(deployment.build.contentPath, "utf8");
    return { html, deployment };
  } catch {
    return null;
  }
}

async function promoteBuild(input: {
  orgId: string;
  siteId: string;
  buildId: string;
  actor: string;
  approvedBy: string | null;
  runId: string | null;
  rollbackOfDeploymentId?: string;
}) {
  const db = requirePrisma();
  const build = await db.siteBuild.findFirst({ where: { id: input.buildId, siteId: input.siteId, orgId: input.orgId } });
  if (!build) return { ok: false as const, error: "build_not_found" };
  if (build.status !== "validated") return { ok: false as const, error: `build_not_validated:${build.status}` };
  const html = await readFile(build.contentPath, "utf8").catch(() => null);
  if (!html) return { ok: false as const, error: "build_content_missing" };

  await db.siteDeployment.updateMany({
    where: { siteId: input.siteId, status: "published" },
    data: { status: "superseded" },
  });
  const receipt = {
    build_version: build.version,
    build_id: build.id,
    content_sha256: contentHash(html),
    published_by: input.actor,
    approved_by: input.approvedBy,
    run_id: input.runId,
    public_path: `/public/sites/${input.siteId}`,
    ...(input.rollbackOfDeploymentId ? { rollback_of_deployment: input.rollbackOfDeploymentId } : {}),
  };
  const deployment = await db.siteDeployment.create({
    data: {
      siteId: input.siteId,
      orgId: input.orgId,
      buildId: build.id,
      status: "published",
      publishedByUserId: null,
      approvedByUserId: null,
      runId: input.runId,
      receipt: receipt as object,
    },
  });
  return { ok: true as const, deployment, receipt, build };
}

export async function rollbackSite(input: { orgId: string; siteId: string; actorEmail: string }) {
  const db = requirePrisma();
  const current = await getCurrentDeployment(input.siteId);
  if (!current || current.orgId !== input.orgId) return { ok: false as const, error: "nothing_published" };
  const previous = await db.siteDeployment.findFirst({
    where: { siteId: input.siteId, publishedAt: { lt: current.publishedAt }, NOT: { buildId: current.buildId } },
    orderBy: { publishedAt: "desc" },
  });
  if (!previous) return { ok: false as const, error: "no_prior_version" };
  await db.siteDeployment.update({ where: { id: current.id }, data: { status: "rolled_back" } });
  const promoted = await promoteBuild({
    orgId: input.orgId,
    siteId: input.siteId,
    buildId: previous.buildId,
    actor: input.actorEmail,
    approvedBy: input.actorEmail,
    runId: null,
    rollbackOfDeploymentId: current.id,
  });
  if (!promoted.ok) return promoted;
  await recordOrgAuditEvent({
    orgId: input.orgId,
    actor: input.actorEmail,
    eventType: "site.rolled_back",
    targetType: "site",
    targetId: input.siteId,
    payload: { from_deployment: current.id, to_build: previous.buildId },
  });
  return promoted;
}

export async function listOrgSites(orgId: string) {
  const db = requirePrisma();
  const sites = await db.site.findMany({
    where: { orgId },
    orderBy: { createdAt: "asc" },
    include: {
      builds: { orderBy: { version: "desc" }, take: 10 },
      deployments: { orderBy: { publishedAt: "desc" }, take: 10, include: { build: { select: { version: true } } } },
      domains: true,
    },
  });
  return sites.map((site) => ({
    id: site.id,
    title: site.title,
    createdAt: site.createdAt.toISOString(),
    builds: site.builds.map((build) => ({
      id: build.id,
      version: build.version,
      status: build.status,
      createdAt: build.createdAt.toISOString(),
    })),
    deployments: site.deployments.map((deployment) => ({
      id: deployment.id,
      status: deployment.status,
      buildVersion: deployment.build.version,
      publishedAt: deployment.publishedAt.toISOString(),
      runId: deployment.runId,
      receipt: deployment.receipt,
    })),
    currentDeployment: site.deployments.find((d) => d.status === "published")?.id ?? null,
    publicPath: site.deployments.some((d) => d.status === "published") ? `/public/sites/${site.id}` : null,
    domains: site.domains.map((domain) => ({
      id: domain.id,
      domain: domain.domain,
      state: domain.state,
      sslState: domain.sslState,
      verificationToken: domain.verificationToken,
      checkedAt: domain.checkedAt?.toISOString() ?? null,
      lastError: domain.lastError,
    })),
  }));
}

/* ---------------- domains ---------------- */

export async function addSiteDomain(input: { orgId: string; siteId: string; domain: string; actorEmail: string }) {
  const db = requirePrisma();
  const feature = await orgHasFeature(input.orgId, "customDomains");
  if (!feature.allowed) return { ok: false as const, error: "feature_not_available", reason: feature.reason };
  const domain = input.domain.trim().toLowerCase();
  if (!isPlausibleDomain(domain)) return { ok: false as const, error: "invalid_domain" };
  const site = await db.site.findFirst({ where: { id: input.siteId, orgId: input.orgId } });
  if (!site) return { ok: false as const, error: "site_not_found_in_org" };
  const record = await db.siteDomain.create({
    data: {
      siteId: input.siteId,
      orgId: input.orgId,
      domain,
      state: "verification_required",
      verificationToken: `pf-verify-${randomBytes(16).toString("hex")}`,
    },
  });
  await recordOrgAuditEvent({
    orgId: input.orgId,
    actor: input.actorEmail,
    eventType: "site.domain_added",
    targetType: "site_domain",
    targetId: record.id,
    payload: { domain },
  });
  return { ok: true as const, domain: record };
}

export async function verifySiteDomain(input: { orgId: string; domainId: string }) {
  const db = requirePrisma();
  const record = await db.siteDomain.findFirst({ where: { id: input.domainId, orgId: input.orgId } });
  if (!record) return { ok: false as const, error: "domain_not_found" };
  const adapter = getDnsAdapter();
  const result = await adapter.checkDomain(record.domain, record.verificationToken);
  const updated = await db.siteDomain.update({
    where: { id: record.id },
    data: {
      state: result.state,
      sslState: result.sslState,
      checkedAt: new Date(result.checkedAt),
      lastError: result.state === "failed" || result.state === "misconfigured" ? result.detail : null,
    },
  });
  return { ok: true as const, domain: updated, check: result };
}

/* ---------------- the approval-gated publish executor ----------------
   Registered on the ONE agent-run engine: risk external_approval means the
   run is created awaiting_approval and only an org manager (or super-admin)
   approval makes it execute. */

export function registerPublishingExecutor() {
  registerAgentRunExecutor("publish_site", {
    title: "Publish website",
    description: "Promotes a validated build to the live PhantomForce-hosted URL for this site. External action: always requires approval.",
    risk: "external_approval",
    requiredRole: "org_manager",
    scope: "one site's public URL",
    expectedEffect: "The site's /public/sites/<siteId> URL starts serving the approved build.",
    rollbackGuidance: "POST /orgs/<orgId>/sites/<siteId>/rollback restores the previous published version.",
    async execute({ run, progress }) {
      const { siteId, buildId } = run.inputs as { siteId?: string; buildId?: string };
      if (!siteId || !buildId) throw new Error("publish_site requires inputs.siteId and inputs.buildId");

      await progress("Checking publishing entitlement…");
      const feature = await orgHasFeature(run.workspace, "websitePublishing");
      if (!feature.allowed) throw new Error(`publishing_not_entitled:${feature.reason}`);

      await progress("Promoting validated build to published…");
      const promoted = await promoteBuild({
        orgId: run.workspace,
        siteId,
        buildId,
        actor: run.requested_by,
        approvedBy: run.approved_by,
        runId: run.id,
      });
      if (!promoted.ok) throw new Error(promoted.error);

      await recordOrgAuditEvent({
        orgId: run.workspace,
        actor: run.approved_by ?? run.requested_by,
        eventType: "site.published",
        targetType: "site",
        targetId: siteId,
        payload: { buildId, deploymentId: promoted.deployment.id, runId: run.id },
      });

      const artifactBody = [
        `# Deployment receipt — ${siteId}`,
        ``,
        `- run: ${run.id}`,
        `- build: v${promoted.build.version} (${buildId})`,
        `- content sha256: ${promoted.receipt.content_sha256}`,
        `- requested by: ${run.requested_by}`,
        `- approved by: ${run.approved_by ?? "(pending record)"}`,
        `- public path: ${promoted.receipt.public_path}`,
        `- rollback: ${`POST /orgs/${run.workspace}/sites/${siteId}/rollback`}`,
      ].join("\n");
      const path = resolve(BUILDS_DIR, siteId, `deployment-${promoted.deployment.id}.md`);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, artifactBody, "utf8");

      return {
        artifacts: [{ kind: "markdown" as const, path, summary: `v${promoted.build.version} live at ${promoted.receipt.public_path}` }],
        summary: `Published build v${promoted.build.version} to ${promoted.receipt.public_path}`,
        actualEffect: `Site ${siteId} now serves build v${promoted.build.version} (sha256 ${promoted.receipt.content_sha256.slice(0, 12)}…)`,
      };
    },
    async verify({ run }) {
      /* real deployment verification: the current published deployment must
         point at the requested build AND the served content must match the
         build on disk byte-for-byte. */
      const { siteId, buildId } = run.inputs as { siteId: string; buildId: string };
      const current = await getCurrentDeployment(siteId);
      if (!current) return { ok: false, detail: "no published deployment found after publish" };
      if (current.buildId !== buildId) return { ok: false, detail: `current deployment serves ${current.buildId}, expected ${buildId}` };
      const served = await getPublishedHtml(siteId);
      if (!served) return { ok: false, detail: "published content unreadable from disk" };
      const receipt = current.receipt as { content_sha256?: string };
      const actual = contentHash(served.html);
      if (receipt.content_sha256 && receipt.content_sha256 !== actual) {
        return { ok: false, detail: "served content hash does not match the deployment receipt" };
      }
      return { ok: true, detail: `deployment verified: build ${buildId} live, content sha256 ${actual.slice(0, 12)}… matches receipt` };
    },
  });
}
