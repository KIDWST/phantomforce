/* PhantomBot invoices — parse a natural-language billing request into a
   structured invoice, persist it through the server invoice store, render a
   clean printable invoice, and build the rich chat card PhantomBot shows back.
   Nothing here emails a client or charges a card; it only creates records. */

import { createInvoiceOnServer } from "./financeledger.js?v=phantom-live-20260723-60";
import { esc } from "./workspaces.js?v=phantom-live-20260723-60";

export function fmtMoneyMinor(minor, currency = "USD") {
  const value = (Number(minor) || 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

/* ---- natural-language parsing -------------------------------------------- */
const MONEY_RE = /(?:\$|usd\s*|€|£)?\s*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*(?:dollars|usd|bucks)?/gi;

function toNumber(str) {
  return Number(String(str).replace(/[,$\s]/g, "")) || 0;
}

export function parseInvoiceRequest(text = "") {
  const raw = String(text).trim();
  const lower = raw.toLowerCase();

  // client: "for CLIENT", "to CLIENT", "invoice CLIENT", "client: CLIENT"
  let clientName = "";
  const clientPatterns = [
    /\bclient\s*[:=]\s*([a-z0-9][a-z0-9 &'.,-]{1,60})/i,
    /\b(?:invoice|bill)\s+([a-z0-9][a-z0-9 &'.,-]{1,60}?)\s+(?:\$|\d|for\b|to\b|—|-)/i,
    /\b(?:for|to)\s+([a-z0-9][a-z0-9 &'.,-]{1,60}?)(?=\s+(?:\$|\d|for\b|—|-|$))/i,
  ];
  for (const re of clientPatterns) {
    const m = raw.match(re);
    if (m && m[1]) { clientName = m[1].trim().replace(/\s+(for|the)$/i, "").trim(); break; }
  }

  // Strip tax + payment-term clauses so their numbers never become line items.
  // Drop thousands-separator commas first so "1,200" is never split on its comma.
  const forItems = raw
    .replace(/(\d),(?=\d{3}(?:\D|$))/g, "$1")
    .replace(/\b\d+(?:\.\d+)?\s*%\s*(?:tax|vat|gst)\b/gi, " ")
    .replace(/\b(?:tax|vat|gst)\s*(?:of|:)?\s*\d+(?:\.\d+)?\s*%/gi, " ")
    .replace(/,?\s*(?:net|due(?:\s+(?:in|on|within))?|payable)\b[^,;]*/gi, " ")
    .replace(/^\s*(?:create|make|draft|generate|build|write|raise|issue|send me|start)\s+(?:an?\s+|a\s+new\s+)?(?:invoice|bill)\b/i, " ")
    .replace(/^\s*(?:invoice|bill)\b/i, " ")
    .replace(clientName ? new RegExp(clientName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : /\bZZZNOMATCHZZZ\b/, " ");

  const cleanDesc = (s) => s
    .replace(/\b(?:for|of|the|a|an)\b/gi, " ")
    .replace(/\b(?:invoice|bill)\b/gi, " ")
    .replace(/^\W+|\W+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  // line items — split on connectors, then read "N (hrs/units/x/@) $R desc" or "$A desc"
  const lineItems = [];
  const chunks = forItems.split(/\s*(?:\bplus\b|\band\b|[,;]|\+)\s*/i).map((c) => c.trim()).filter(Boolean);
  for (const chunk of chunks) {
    const qtyRate = chunk.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|units?|items?|qty|@|x|×)?\s*(?:at|@|x|×|each|per)\s*\$?\s*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/i);
    if (qtyRate) {
      const qty = Number(qtyRate[1]) || 1;
      const rate = toNumber(qtyRate[2]);
      if (rate) { lineItems.push({ description: cleanDesc(chunk.replace(qtyRate[0], " ")) || "Services", quantity: qty, unitPrice: rate }); continue; }
    }
    const single = chunk.match(/\$\s*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/) || chunk.match(/\b(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{2})\b/);
    if (single) {
      const amount = toNumber(single[1]);
      if (amount) lineItems.push({ description: cleanDesc(chunk.replace(single[0], " ")) || "Services", quantity: 1, unitPrice: amount });
    }
  }

  // If no structured line items, fall back to a single amount + description.
  if (!lineItems.length) {
    const amounts = [];
    MONEY_RE.lastIndex = 0;
    let a;
    while ((a = MONEY_RE.exec(raw))) { const n = toNumber(a[1]); if (n) amounts.push(n); }
    const amount = amounts.length ? Math.max(...amounts) : 0;
    // description: text after "for" (the last one, usually the work) minus the amount
    let description = "";
    const forMatch = raw.match(/\bfor\s+([a-z0-9][a-z0-9 &'./,-]{2,80})$/i);
    if (forMatch) {
      description = forMatch[1]
        .replace(/\$?\s*\d[\d,.]*/g, "")
        .replace(/,?\s*(?:net|due(?:\s+(?:in|on|within))?|payable)\b.*$/i, "")   // drop payment terms
        .replace(/^the\s+/i, "")
        .replace(/[\s,]+$/, "")
        .trim();
    }
    if (amount) lineItems.push({ description: description || "Services rendered", quantity: 1, unitPrice: amount });
  }

  // tax: "8% tax", "tax 8.5%", "plus tax"
  let taxRatePct = 0;
  const taxMatch = lower.match(/(\d+(?:\.\d+)?)\s*%\s*(?:tax|vat|gst)|(?:tax|vat|gst)\s*(?:of|:)?\s*(\d+(?:\.\d+)?)\s*%/);
  if (taxMatch) taxRatePct = Number(taxMatch[1] || taxMatch[2]) || 0;

  // due date: "due in 30 days", "net 30", "due on 2026-08-01"
  let dueDate = "";
  const netMatch = lower.match(/\b(?:net|due in|due within)\s*(\d{1,3})\s*days?\b/) || lower.match(/\bnet\s*(\d{1,3})\b/);
  if (netMatch) dueDate = new Date(Date.now() + (Number(netMatch[1]) || 14) * 86400000).toISOString().slice(0, 10);
  const onMatch = raw.match(/\bdue\s+(?:on\s+)?(\d{4}-\d{2}-\d{2})/i);
  if (onMatch) dueDate = onMatch[1];

  const total = lineItems.reduce((s, li) => s + li.quantity * li.unitPrice, 0) * (1 + taxRatePct / 100);

  return {
    clientName: clientName || "",
    lineItems,
    taxRatePct,
    dueDate,
    estimatedTotal: total,
    hasEnough: lineItems.length > 0 && total > 0,
  };
}

/* ---- create ---- */
export async function createInvoiceFromDraft(draft, source = "phantom_ai") {
  const invoice = {
    clientName: draft.clientName || "Client",
    clientEmail: draft.clientEmail || "",
    clientAddress: draft.clientAddress || "",
    lineItems: (draft.lineItems || []).map((li) => ({
      description: li.description || "Services",
      quantity: li.quantity || 1,
      unitPrice: li.unitPrice != null ? li.unitPrice : (li.unitPriceMinor || 0) / 100,
    })),
    taxRatePct: draft.taxRatePct || 0,
    dueDate: draft.dueDate || "",
    notes: draft.notes || "",
    source,
  };
  const res = await createInvoiceOnServer(invoice);
  return res.invoice;
}

/* ---- printable invoice --------------------------------------------------- */
export function invoicePrintableHtml(inv, businessName = "PhantomForce") {
  const rows = inv.lineItems.map((li) => `
    <tr>
      <td>${esc(li.description)}</td>
      <td class="num">${li.quantity}</td>
      <td class="num">${fmtMoneyMinor(li.unitPriceMinor, inv.currency)}</td>
      <td class="num">${fmtMoneyMinor(li.amountMinor, inv.currency)}</td>
    </tr>`).join("");
  const statusColor = { paid: "#2fbf71", sent: "#3a86ff", draft: "#8a8f98", void: "#c0392b" }[inv.status] || "#8a8f98";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(inv.number)} — ${esc(inv.clientName)}</title>
  <style>
    *{box-sizing:border-box} body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1f27;margin:0;background:#eef1f5;padding:28px}
    .sheet{max-width:820px;margin:0 auto;background:#fff;border-radius:14px;box-shadow:0 10px 40px #0002;padding:44px 48px}
    header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #eef1f5;padding-bottom:22px;margin-bottom:26px}
    .brand{font-size:24px;font-weight:800;letter-spacing:-.5px}
    .brand span{color:#3a86ff}
    h1{font-size:30px;margin:0 0 4px;letter-spacing:1px}
    .muted{color:#6b7280;font-size:13px}
    .status{display:inline-block;padding:5px 12px;border-radius:999px;color:#fff;font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.05em;background:${statusColor}}
    .meta{display:flex;justify-content:space-between;gap:24px;margin:8px 0 26px;flex-wrap:wrap}
    .meta div{font-size:13px}.meta b{display:block;color:#9aa1ab;font-size:11px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px}
    table{width:100%;border-collapse:collapse;margin:10px 0 6px}
    th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#9aa1ab;border-bottom:2px solid #eef1f5;padding:8px 10px}
    td{padding:11px 10px;border-bottom:1px solid #f1f3f6;font-size:14px}
    td.num,th.num{text-align:right}
    .totals{margin-left:auto;width:280px;margin-top:14px}
    .totals div{display:flex;justify-content:space-between;padding:6px 10px;font-size:14px}
    .totals .grand{border-top:2px solid #1a1f27;margin-top:6px;padding-top:12px;font-size:20px;font-weight:800}
    .notes{margin-top:30px;padding-top:18px;border-top:1px solid #f1f3f6;color:#4b5563;font-size:13px;white-space:pre-wrap}
    .actions{max-width:820px;margin:0 auto 16px;text-align:right}
    .actions button{border:0;background:#3a86ff;color:#fff;font-weight:700;padding:11px 22px;border-radius:9px;cursor:pointer;font-size:14px}
    @media print{body{background:#fff;padding:0}.sheet{box-shadow:none;border-radius:0}.actions{display:none}}
  </style></head><body>
  <div class="actions"><button onclick="window.print()">Print / Save PDF</button></div>
  <div class="sheet">
    <header>
      <div><div class="brand">${esc(businessName)}</div><div class="muted">Powered by PhantomForce</div></div>
      <div style="text-align:right"><h1>INVOICE</h1><div class="muted">${esc(inv.number)}</div><div style="margin-top:8px"><span class="status">${esc(inv.status)}</span></div></div>
    </header>
    <div class="meta">
      <div><b>Bill To</b>${esc(inv.clientName)}${inv.clientEmail ? `<br>${esc(inv.clientEmail)}` : ""}${inv.clientAddress ? `<br>${esc(inv.clientAddress).replace(/\n/g, "<br>")}` : ""}</div>
      <div><b>Issued</b>${esc(inv.issueDate)}</div>
      <div><b>Due</b>${esc(inv.dueDate)}</div>
    </div>
    <table>
      <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="totals">
      <div><span>Subtotal</span><span>${fmtMoneyMinor(inv.subtotalMinor, inv.currency)}</span></div>
      ${inv.taxMinor ? `<div><span>Tax (${inv.taxRatePct}%)</span><span>${fmtMoneyMinor(inv.taxMinor, inv.currency)}</span></div>` : ""}
      ${inv.discountMinor ? `<div><span>Discount</span><span>-${fmtMoneyMinor(inv.discountMinor, inv.currency)}</span></div>` : ""}
      <div class="grand"><span>Total</span><span>${fmtMoneyMinor(inv.totalMinor, inv.currency)}</span></div>
    </div>
    ${inv.notes ? `<div class="notes">${esc(inv.notes)}</div>` : ""}
  </div></body></html>`;
}

export function openInvoicePrintable(inv, businessName) {
  const html = invoicePrintableHtml(inv, businessName);
  const w = window.open("", "_blank");
  if (w) { w.document.open(); w.document.write(html); w.document.close(); return true; }
  // popup blocked — fall back to a blob URL the caller can surface as a link
  try {
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    window.open(url, "_blank");
    return true;
  } catch { return false; }
}

/* ---- chat card ----------------------------------------------------------- */
export function invoiceCard(inv) {
  const itemsLine = inv.lineItems.slice(0, 3).map((li) => `${li.quantity}× ${li.description} — ${fmtMoneyMinor(li.amountMinor, inv.currency)}`).join(" · ");
  const more = inv.lineItems.length > 3 ? ` +${inv.lineItems.length - 3} more` : "";
  return {
    kicker: `Invoice ${inv.number} · ${inv.status}`,
    title: `${inv.clientName} — ${fmtMoneyMinor(inv.totalMinor, inv.currency)}`,
    body: `${itemsLine}${more}`,
    meta: `Subtotal ${fmtMoneyMinor(inv.subtotalMinor, inv.currency)}${inv.taxMinor ? ` · Tax ${fmtMoneyMinor(inv.taxMinor, inv.currency)}` : ""} · Due ${inv.dueDate}`,
    actions: [{ label: "Open invoice", invoiceId: inv.id }, { label: "Accounting", open: "money" }],
    invoice: inv,
  };
}
