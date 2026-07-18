import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const {
  monthlySummary, invoiceLedgerEntry, invoiceTotal, markInvoicePaid, invoiceDisplayStatus,
  receiptDraftFromResponse, isUnreconciledTransaction, unreconciledCount,
} = await import("../app/js/workspaces.js?v=test-accounting");

/* ---------------- monthly summary (reports) ---------------- */
{
  const rows = monthlySummary([
    { date: "2026-06-03", amount: 1200 },
    { date: "2026-06-18", amount: -200.5 },
    { date: "2026-07-02", amount: -49.99 },
    { date: "2026-07-15", amount: 800 },
    { date: "2026-07-20", amount: -50.01 },
    { date: "not-a-date", amount: 999999 }, // must be ignored, never invented into a month
    { date: "2026-08-01", amount: 0 }, // zero rows carry no cash movement
  ]);
  assert.equal(rows.length, 2, "only months with real, dated, non-zero transactions appear");
  assert.deepEqual(rows.map((r) => r.month), ["2026-07", "2026-06"], "months sort newest first");
  const july = rows[0];
  assert.equal(july.income, 800, "July income");
  assert.ok(Math.abs(july.expense - 100) < 1e-9, "July expense sums absolute outflows");
  assert.ok(Math.abs(july.net - 700) < 1e-9, "July net = income - expense");
  const june = rows[1];
  assert.equal(june.income, 1200, "June income");
  assert.equal(june.expense, 200.5, "June expense");
  assert.deepEqual(monthlySummary([]), [], "empty ledger produces an empty report, not fabricated data");
}

/* ---------------- invoices: create -> mark paid -> ledger dedup ---------------- */
{
  const invoice = {
    id: "inv-test1",
    ws: "phantomforce",
    number: "INV-007",
    client: "Chicago Shots",
    items: [
      { description: "Media day", amount: 450 },
      { description: "Edits", amount: 150.25 },
    ],
    issuedDate: "2026-07-01",
    dueDate: "2026-07-15",
    status: "sent",
    paidDate: null,
  };
  assert.equal(invoiceTotal(invoice), 600.25, "invoice total sums line items");

  const transactions = [];
  const first = markInvoicePaid(invoice, transactions, "phantomforce", "2026-07-17");
  assert.equal(first.created, true, "first mark-paid records a ledger entry");
  assert.equal(invoice.status, "paid", "mark-paid transitions the invoice status");
  assert.equal(invoice.paidDate, "2026-07-17", "mark-paid stamps the paid date");
  assert.equal(transactions.length, 1, "exactly one ledger entry after first mark-paid");
  const entry = transactions[0];
  assert.equal(entry.externalId, "invoice:inv-test1", "ledger entry dedups via externalId like CSV import");
  assert.equal(entry.amount, 600.25, "ledger entry is income for the invoice total");
  assert.equal(entry.linkedInvoiceId, "inv-test1", "ledger entry is reconciled to its invoice");
  assert.equal(entry.source, "invoice", "ledger entry carries the invoice source");
  assert.ok(entry.amount > 0, "mark-paid records income, never an expense");

  const second = markInvoicePaid(invoice, transactions, "phantomforce", "2026-07-18");
  assert.equal(second.created, false, "re-marking paid never double-counts");
  assert.equal(transactions.length, 1, "ledger still holds exactly one entry after a repeat mark-paid");

  const standalone = invoiceLedgerEntry(invoice, "phantomforce", "2026-07-17");
  assert.equal(standalone.date, "2026-07-17", "paidDate/today drives the ledger entry date");
  assert.equal(standalone.category, "Service income", "invoice income lands in a real income category");
}

/* ---------------- invoice status transitions ---------------- */
{
  assert.equal(invoiceDisplayStatus({ status: "draft" }, "2026-07-17"), "draft");
  assert.equal(invoiceDisplayStatus({ status: "sent", dueDate: "2026-08-01" }, "2026-07-17"), "sent");
  assert.equal(invoiceDisplayStatus({ status: "sent", dueDate: "2026-07-01" }, "2026-07-17"), "overdue", "past-due sent invoices surface as overdue");
  assert.equal(invoiceDisplayStatus({ status: "paid", dueDate: "2026-07-01" }, "2026-07-17"), "paid", "paid wins over overdue");
}

/* ---------------- receipt extraction draft (never faked) ---------------- */
{
  const withAi = receiptDraftFromResponse({
    ok: true,
    assetId: "asset-123",
    aiAvailable: true,
    draft: { vendor: "Home Depot", amount: 88.4, direction: "expense", date: "2026-07-10", categoryGuess: "Equipment", confidence: "high" },
  }, "receipt.jpg");
  assert.equal(withAi.assetId, "asset-123", "stored asset id survives into the draft");
  assert.equal(withAi.aiAvailable, true);
  assert.equal(withAi.merchant, "Home Depot");
  assert.equal(withAi.amount, 88.4);
  assert.equal(withAi.date, "2026-07-10");
  assert.equal(withAi.category, "Equipment", "known category suggestions pass through");

  const badCategory = receiptDraftFromResponse({
    ok: true, assetId: "asset-124", aiAvailable: true,
    draft: { vendor: "X", amount: 5, direction: "expense", date: "2026-07-10", categoryGuess: "Made Up Category" },
  });
  assert.equal(badCategory.category, "Uncategorized", "unknown category suggestions fall back honestly");

  const noAi = receiptDraftFromResponse({ ok: true, assetId: "asset-125", aiAvailable: false, reason: "AI parsing isn't enabled yet." }, "scan.pdf");
  assert.equal(noAi.aiAvailable, false, "no draft means no extraction claim");
  assert.equal(noAi.amount, "", "no extracted amount is ever invented");
  assert.equal(noAi.merchant, "", "no extracted merchant is ever invented");
  assert.equal(noAi.reason, "AI parsing isn't enabled yet.", "the backend's honest reason is preserved");
}

/* ---------------- reconciliation link fields ---------------- */
{
  assert.equal(isUnreconciledTransaction({ source: "csv", linkedReceiptId: null, linkedInvoiceId: null }), true, "CSV imports start unreconciled");
  assert.equal(isUnreconciledTransaction({ source: "csv", linkedInvoiceId: "inv-1" }), false, "an invoice link reconciles a CSV row");
  assert.equal(isUnreconciledTransaction({ source: "receipt", linkedReceiptId: "asset-1" }), false, "a stored receipt reconciles its row");
  assert.equal(isUnreconciledTransaction({ source: "receipt", linkedReceiptId: null, linkedInvoiceId: null }), true, "a receipt row without a stored asset stays unreconciled");
  assert.equal(isUnreconciledTransaction({ source: "manual" }), false, "manual entries are the owner's own word");
  assert.equal(unreconciledCount([
    { source: "csv" }, { source: "csv", linkedReceiptId: "a" }, { source: "manual" }, { source: "receipt" },
  ]), 2, "unreconciled stat counts only unlinked imports/receipts");
}

/* ---------------- static source assertions ---------------- */
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const workspacesSrc = read("app/js/workspaces.js");
const storeSrc = read("app/js/store.js");
const cssSrc = read("app/phantom.css");

// Dropzone markup + wiring
assert.match(workspacesSrc, /data-receipt-drop/, "Accounting must render a receipt dropzone");
assert.match(workspacesSrc, /data-receipt-file/, "the dropzone must include a file-picker fallback");
assert.match(workspacesSrc, /accept="image\/\*,\.pdf,application\/pdf"/, "the picker must accept photos and PDFs");
assert.match(workspacesSrc, /dropzone\.ondrop = \(event\) =>/, "drag-and-drop must be wired");
assert.match(workspacesSrc, /\/phantom-ai\/ops\/finance\/parse-receipt/, "uploads must go to the existing smart-entry backend route");
assert.match(workspacesSrc, /friendlyBackendError\(response\.status/, "backend failures must use the standard messaging helper");
assert.match(workspacesSrc, /Sign in to upload receipts/, "missing session must show the standard sign-in state, not fake extraction");
assert.match(workspacesSrc, /receiptDraftFromResponse\(payload, file\.name\)/, "extraction renders only from the real backend payload");
assert.match(workspacesSrc, /source: "receipt",[\s\S]*?linkedReceiptId: draft\.assetId \|\| null/, "confirmed receipts must carry their stored asset link");
assert.match(workspacesSrc, /externalId = draft\.assetId \? `receipt:\$\{draft\.assetId\}` : null/, "confirmed receipts dedup via externalId like CSV import");

// Invoices
assert.match(workspacesSrc, /data-invoice-form/, "Accounting must render an invoice create form");
assert.match(workspacesSrc, /finance-invoice-clients/, "invoice client field must offer a datalist from CRM contacts");
assert.match(workspacesSrc, /store\.state\.leads \|\| \[\]\)\.flatMap\(\(lead\) => \[lead\.name, lead\.company\]/, "datalist options come from real local CRM records");
assert.match(workspacesSrc, /"invoice-sent": \(id\)/, "invoices must support the sent transition");
assert.match(workspacesSrc, /"invoice-paid": \(id\)/, "invoices must support the paid transition");
assert.match(workspacesSrc, /markInvoicePaid\(invoice, finance\.transactions, ws\)/, "mark-paid must reuse the tested dedup helper");

// Reconciliation UI
assert.match(workspacesSrc, /data-link-invoice/, "ledger rows must offer an invoice link control");
assert.match(workspacesSrc, /data-receipt-attach/, "receipt drafts must offer attach-to-existing reconciliation");
assert.match(workspacesSrc, /toggle-unreconciled/, "the ledger must offer an Unreconciled filter");
assert.match(workspacesSrc, /<span>Unreconciled<\/span><b>\$\{unreconciledTotal\}/, "a stat tile must show the unreconciled count");

// Monthly summary report
assert.match(workspacesSrc, /finance-monthly-table/, "monthly summary must render as a table");
assert.match(workspacesSrc, /<caption class="finance-sr-only">/, "the summary table needs an accessible caption");
assert.match(workspacesSrc, /th scope="row"/, "summary rows need row headers for screen readers");
assert.match(workspacesSrc, /Nothing to summarize yet/, "the report must show an honest empty state");

// Store persistence follows existing finance patterns
assert.match(storeSrc, /invoices: \[\],/, "financeSeed must include the invoices collection");
assert.match(storeSrc, /export const INVOICE_STATUSES = \["draft", "sent", "paid", "overdue"\]/, "invoice statuses are normalized like other finance enums");
assert.match(storeSrc, /linkedReceiptId: tx\.linkedReceiptId \|\| null/, "transactions must persist the receipt link");
assert.match(storeSrc, /linkedInvoiceId: tx\.linkedInvoiceId \|\| null/, "transactions must persist the invoice link");
assert.match(storeSrc, /current\.invoices = normalized\.invoices/, "ensureFinance must keep invoices on the live object identity");

// CSS section exists
assert.match(cssSrc, /\.finance-dropzone \{/, "dropzone needs styling");
assert.match(cssSrc, /\.finance-invoice \{/, "invoice rows need styling");
assert.match(cssSrc, /\.finance-monthly-table \{/, "monthly summary table needs styling");
assert.match(cssSrc, /\.finance-sr-only \{/, "accessible caption needs a visually-hidden utility");

console.log(JSON.stringify({ ok: true, suite: "accounting" }));
