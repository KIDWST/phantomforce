# Accounting Smart Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Accounting tab's bank-linking-first onboarding with two low-friction entry paths — drag-and-drop receipt photos and free-text lines like "$500 every week since April" — that land in the existing client-side ledger through the same confirmed-transaction path manual entry already uses.

**Architecture:** Two new stateless server endpoints (deterministic text parsing, AI receipt-image parsing) return editable "drafts"; a shared confirm-card UI in the client posts confirmed drafts through the existing `financeNow().transactions.unshift(...)` write path (or a new, parallel `recurringRules[]` write for recurring drafts). A pure, unit-tested `generateDueOccurrences` function backfills/tops-up recurring transactions on each Accounting-tab load — no background cron.

**Tech Stack:** TypeScript (Fastify server, `server/src/`), vanilla JS client (`app/js/`, ES modules, template-string rendering, no framework), Node test scripts (`tsx` for server, plain `.mjs` for client-side pure-function tests), direct `fetch` to `https://openrouter.ai/api/v1/chat/completions`.

## Global Constraints

- Money on the books must be a confirmed transaction — AI-parsed drafts (from either photo or text) always render through a confirm card and are only written on explicit user confirmation, never auto-posted silently.
- Once a recurring rule is confirmed, future occurrences DO auto-post without a per-occurrence confirm (per approved design) — the confirm gate is at rule-creation time, not per-occurrence.
- No changes to `server/src/phantom-ai/model-router.ts` or `providers/openrouter-adapter.ts` (separate, unfinished subsystem — see spec Non-goals).
- No changes to the Plaid bank/card connector backend (`server/src/connectors/finance-connector.ts` stays as-is).
- Client-side finance state (`transactions`, `accounts`, `connectors`, new `recurringRules`) stays entirely in `localStorage` via `app/js/store.js` — no new server-side database.
- Receipt images are stored server-side (binary doesn't belong in `localStorage`) with **no expiry** (contrast with `content-asset-storage.ts`'s 30-day rule — receipts are financial records).
- `parseReceiptImage` must be gated on `PHANTOM_LIVE_PROVIDERS_ENABLED === "true"` AND `PHANTOM_OPENROUTER_TRANSPORT_ENABLED === "true"`; if either is off, return success-with-no-draft (never a hard failure — the photo is still stored and usable manually).
- Direction is stored as `"income" | "expense"` (matching the existing manual-entry form's `<select name="direction">` values exactly) — not `"in"/"out"`.
- Full spec: `docs/superpowers/specs/2026-07-15-accounting-smart-entry-design.md`.

---

## File Structure

**New files:**
- `app/js/finance-recurring.js` — `generateDueOccurrences`, `addInterval`, recurring-rule normalization. Split out from `store.js` (which is already large) since this is a self-contained, independently-testable pure-function module with one clear job: given a rule and "today," compute due occurrences.
- `server/src/connectors/receipt-asset-storage.ts` — local-disk receipt image storage, no expiry, mirrors `content-asset-storage.ts`'s provider interface.
- `server/src/connectors/finance-smart-entry.ts` — `parseExpenseText` (deterministic) and `parseReceiptImage` (direct OpenRouter call).
- `scripts/test-finance-recurring.mjs` — unit tests for `generateDueOccurrences`.
- `server/scripts/test-receipt-asset-storage.ts` — store/read/delete round-trip tests.
- `server/scripts/test-finance-smart-entry.ts` — parse function tests (mocked fetch for the AI path).
- `server/scripts/test-finance-smart-entry-routes.ts` — route-level tests via `app.inject` (auth boundaries + happy path).

**Modified files:**
- `app/js/store.js` — `financeSeed()`/`normalizeFinance()` gain `recurringRules`; transaction normalization gains `receiptAssetId`/`recurringRuleId`/`aiAssisted`; `moneyView()` passes `recurringRules` through.
- `app/js/workspaces.js` — `renderMoney` gets the drop-zone + text-entry hero, confirm-card rendering, recurring-rules panel, and the demoted "Advanced: connect a bank or card" section; imports `generateDueOccurrences` from the new `finance-recurring.js`.
- `server/src/index.ts` — three new routes: `POST /phantom-ai/ops/finance/parse-expense-text`, `POST /phantom-ai/ops/finance/parse-receipt`, `GET /phantom-ai/ops/finance/receipt/:assetId`.
- `server/.env.example` — no new vars needed (reuses `OPENROUTER_API_KEY`, `PHANTOM_LIVE_PROVIDERS_ENABLED`, `PHANTOM_OPENROUTER_TRANSPORT_ENABLED`, all already documented).

---

### Task 1: Recurring occurrence generation engine

**Files:**
- Create: `app/js/finance-recurring.js`
- Test: `scripts/test-finance-recurring.mjs`

**Interfaces:**
- Produces: `export function generateDueOccurrences(rule, asOfISODate)` → `{ occurrences: Array<{ date: string }>, nextLastGeneratedDate: string | null, capped: boolean }`. `rule` shape: `{ frequency: "weekly"|"biweekly"|"monthly"|"custom-days", intervalDays: number|null, startDate: string, endDate: string|null, lastGeneratedDate: string|null, status: "active"|"paused" }`.
- Produces: `export const RECURRING_OCCURRENCE_CAP = 500`.
- Consumes: nothing (pure function, no imports).

- [ ] **Step 1: Write the failing tests**

```js
// scripts/test-finance-recurring.mjs
import assert from "node:assert/strict";
import { generateDueOccurrences, RECURRING_OCCURRENCE_CAP } from "../app/js/finance-recurring.js";

// Weekly: 4 clean occurrences inclusive of start and end
{
  const rule = { frequency: "weekly", intervalDays: null, startDate: "2026-01-01", endDate: null, lastGeneratedDate: null, status: "active" };
  const result = generateDueOccurrences(rule, "2026-01-22");
  assert.deepEqual(result.occurrences.map((o) => o.date), ["2026-01-01", "2026-01-08", "2026-01-15", "2026-01-22"]);
  assert.equal(result.nextLastGeneratedDate, "2026-01-22");
  assert.equal(result.capped, false);
}

// Monthly with day-of-month clamping: 31st anchor through Jan-Apr, Feb has 28 days in 2026
{
  const rule = { frequency: "monthly", intervalDays: null, startDate: "2026-01-31", endDate: null, lastGeneratedDate: null, status: "active" };
  const result = generateDueOccurrences(rule, "2026-04-30");
  assert.deepEqual(result.occurrences.map((o) => o.date), ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  assert.equal(result.nextLastGeneratedDate, "2026-04-30");
}

// Resuming from a lastGeneratedDate should not repeat past occurrences
{
  const rule = { frequency: "weekly", intervalDays: null, startDate: "2026-01-01", endDate: null, lastGeneratedDate: "2026-01-08", status: "active" };
  const result = generateDueOccurrences(rule, "2026-01-22");
  assert.deepEqual(result.occurrences.map((o) => o.date), ["2026-01-15", "2026-01-22"]);
}

// endDate stops generation even if asOfISODate is later
{
  const rule = { frequency: "weekly", intervalDays: null, startDate: "2026-01-01", endDate: "2026-02-01", lastGeneratedDate: null, status: "active" };
  const result = generateDueOccurrences(rule, "2026-04-01");
  assert.deepEqual(result.occurrences.map((o) => o.date), ["2026-01-01", "2026-01-08", "2026-01-15", "2026-01-22", "2026-01-29"]);
  assert.equal(result.nextLastGeneratedDate, "2026-01-29");
}

// Paused rule generates nothing
{
  const rule = { frequency: "weekly", intervalDays: null, startDate: "2026-01-01", endDate: null, lastGeneratedDate: null, status: "paused" };
  const result = generateDueOccurrences(rule, "2026-06-01");
  assert.deepEqual(result.occurrences, []);
  assert.equal(result.nextLastGeneratedDate, null);
}

// Custom-days (e.g. "every other day") respects intervalDays and the cap
{
  const rule = { frequency: "custom-days", intervalDays: 1, startDate: "2020-01-01", endDate: null, lastGeneratedDate: null, status: "active" };
  const result = generateDueOccurrences(rule, "2026-01-01");
  assert.equal(result.occurrences.length, RECURRING_OCCURRENCE_CAP);
  assert.equal(result.capped, true);
}

console.log(JSON.stringify({ ok: true, suite: "finance-recurring" }));
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/test-finance-recurring.mjs`
Expected: FAIL — `Cannot find module '../app/js/finance-recurring.js'`

- [ ] **Step 3: Write the implementation**

```js
// app/js/finance-recurring.js
export const RECURRING_OCCURRENCE_CAP = 500;

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function daysInMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function addInterval(dateISO, rule) {
  const d = new Date(`${dateISO}T00:00:00Z`);
  if (rule.frequency === "weekly") {
    d.setUTCDate(d.getUTCDate() + 7);
    return isoDate(d);
  }
  if (rule.frequency === "biweekly") {
    d.setUTCDate(d.getUTCDate() + 14);
    return isoDate(d);
  }
  if (rule.frequency === "monthly") {
    const anchorDay = new Date(`${rule.startDate}T00:00:00Z`).getUTCDate();
    const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    next.setUTCDate(Math.min(anchorDay, daysInMonth(next.getUTCFullYear(), next.getUTCMonth())));
    return isoDate(next);
  }
  d.setUTCDate(d.getUTCDate() + Math.max(1, Number(rule.intervalDays) || 1));
  return isoDate(d);
}

export function generateDueOccurrences(rule, asOfISODate) {
  if (rule.status !== "active") {
    return { occurrences: [], nextLastGeneratedDate: rule.lastGeneratedDate ?? null, capped: false };
  }
  const occurrences = [];
  let cursor = rule.lastGeneratedDate ? addInterval(rule.lastGeneratedDate, rule) : rule.startDate;
  let capped = false;
  while (cursor <= asOfISODate) {
    if (rule.endDate && cursor > rule.endDate) break;
    occurrences.push({ date: cursor });
    if (occurrences.length >= RECURRING_OCCURRENCE_CAP) {
      capped = true;
      break;
    }
    cursor = addInterval(cursor, rule);
  }
  const nextLastGeneratedDate = occurrences.length
    ? occurrences[occurrences.length - 1].date
    : (rule.lastGeneratedDate ?? null);
  return { occurrences, nextLastGeneratedDate, capped };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/test-finance-recurring.mjs`
Expected: `{"ok":true,"suite":"finance-recurring"}`

- [ ] **Step 5: Add the npm script and commit**

Add to root `package.json` `"scripts"` block (alphabetically near the other `test:` entries):
```json
"test:finance-recurring": "node scripts/test-finance-recurring.mjs",
```

```bash
git add app/js/finance-recurring.js scripts/test-finance-recurring.mjs package.json
git commit -m "feat(accounting): add recurring occurrence generation engine"
```

---

### Task 2: Finance data model additions in store.js

**Files:**
- Modify: `app/js/store.js` (`FINANCE_CATEGORIES`/`FINANCE_CONNECTORS` block around line 52-73; `financeSeed()` around line 452; `normalizeFinance()` around line 603; `moneyView()` around line 1343 — re-check exact line numbers with Grep before editing, this file is shared and may have shifted)
- Test: `scripts/test-finance-recurring-store.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `financeSeed()` includes `recurringRules: []`. `normalizeFinance(finance)` returns `{ accounts, transactions, connectors, recurringRules }` where each transaction may carry `receiptAssetId: string|null`, `recurringRuleId: string|null`, `aiAssisted: boolean`, and each recurring rule is normalized to `{ id, ws, description, amount, direction: "income"|"expense", category, account, frequency, intervalDays, startDate, endDate, status, lastGeneratedDate, createdAt, source: "ai-parsed"|"manual" }`. `moneyView()` return value gains `recurringRules: finance.recurringRules`.

- [ ] **Step 1: Write the failing test**

```js
// scripts/test-finance-recurring-store.mjs
import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { store, moneyView } = await import("../app/js/store.js");

// A freshly-seeded store has an empty recurringRules array
assert.deepEqual(store.state.finance.recurringRules, []);

// normalizeFinance backfills defaults for a rule missing optional fields
store.state.finance.recurringRules.push({
  id: "rule-1",
  ws: "phantomforce",
  description: "Contractor payment",
  amount: 500,
  direction: "expense",
  category: "Contractors",
  account: "Manual ledger",
  frequency: "weekly",
  startDate: "2026-04-01",
});
store.save();
store.state.finance = null; // force a reload through normalizeFinance
const rule = store.state.finance ? null : null; // placeholder removed below

// Re-read through moneyView, which forces ensureFinance()/normalizeFinance()
const view = moneyView();
const normalized = view.recurringRules.find((r) => r.id === "rule-1");
assert.ok(normalized, "recurring rule should survive normalization");
assert.equal(normalized.status, "active", "status should default to active");
assert.equal(normalized.lastGeneratedDate, null, "lastGeneratedDate should default to null");
assert.equal(normalized.source, "manual", "source should default to manual");
assert.equal(normalized.intervalDays, null, "intervalDays should default to null for non-custom-days frequency");

// Transaction normalization backfills the new optional fields
store.state.finance.transactions.push({ id: "txn-1", ws: "phantomforce", date: "2026-04-01", description: "Contractor", amount: -500, category: "Contractors", account: "Manual ledger", source: "ai-parsed" });
store.save();
const txView = moneyView();
const tx = txView.transactions.find((t) => t.id === "txn-1");
assert.equal(tx.receiptAssetId, null);
assert.equal(tx.recurringRuleId, null);
assert.equal(tx.aiAssisted, false);

console.log(JSON.stringify({ ok: true, suite: "finance-recurring-store" }));
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/test-finance-recurring-store.mjs`
Expected: FAIL — `assert.deepEqual(store.state.finance.recurringRules, [])` throws because `recurringRules` is `undefined`.

- [ ] **Step 3: Implement the store.js changes**

In `app/js/store.js`, first re-locate the exact current line numbers (they may have moved since this plan was written):
```bash
grep -n "function financeSeed\|function normalizeFinance\|export function moneyView\|const FINANCE_CONNECTORS" app/js/store.js
```

Add a frequency constant near `FINANCE_CONNECTORS` (around line 69-73):
```js
export const FINANCE_RECURRENCE_FREQUENCIES = ["weekly", "biweekly", "monthly", "custom-days"];
```

In `financeSeed()`, add the new array:
```js
function financeSeed() {
  return {
    accounts: [],
    transactions: [],
    connectors: FINANCE_CONNECTORS,
    recurringRules: [],
  };
}
```

In `normalizeFinance()`, add rule normalization and extend the transaction map. The existing transaction map (inside `normalizeFinance`) gets three new fields appended to its returned object:
```js
      receiptAssetId: tx.receiptAssetId || null,
      recurringRuleId: tx.recurringRuleId || null,
      aiAssisted: Boolean(tx.aiAssisted),
```
(add these lines directly inside the existing `return { id: tx.id || uid("txn"), ... }` object in the `transactions` map, before the closing brace — do not otherwise change the existing fields).

Add a new block for rules, and include it in `normalizeFinance`'s return value:
```js
  const recurringRules = Array.isArray(input.recurringRules) ? input.recurringRules.map((rule) => ({
    id: rule.id || uid("rule"),
    ws: rule.ws || "phantomforce",
    description: String(rule.description || "Recurring transaction").slice(0, 160),
    amount: Math.abs(Number(rule.amount) || 0),
    direction: rule.direction === "income" ? "income" : "expense",
    category: FINANCE_CATEGORIES.includes(rule.category) ? rule.category : "Uncategorized",
    account: String(rule.account || "Manual ledger").slice(0, 80),
    frequency: FINANCE_RECURRENCE_FREQUENCIES.includes(rule.frequency) ? rule.frequency : "monthly",
    intervalDays: rule.frequency === "custom-days" ? Math.max(1, Number(rule.intervalDays) || 1) : null,
    startDate: rule.startDate || new Date().toISOString().slice(0, 10),
    endDate: rule.endDate || null,
    status: rule.status === "paused" ? "paused" : "active",
    lastGeneratedDate: rule.lastGeneratedDate || null,
    createdAt: rule.createdAt || new Date().toISOString(),
    source: rule.source === "ai-parsed" ? "ai-parsed" : "manual",
  })) : [];
```
and change the function's final `return { accounts, transactions, connectors };` to `return { accounts, transactions, connectors, recurringRules };`.

In `moneyView()`, add `recurringRules: finance.recurringRules,` to the returned object (alongside the existing `connectors: finance.connectors,` line).

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/test-finance-recurring-store.mjs`
Expected: `{"ok":true,"suite":"finance-recurring-store"}`

- [ ] **Step 5: Run the existing store-dependent test suites to check for regressions**

Run: `node scripts/test-memory-retention.mjs && node scripts/test-crm-pipeline.mjs`
Expected: both exit 0 with no assertion errors (these import `store.js` too and must still pass unchanged).

- [ ] **Step 6: Commit**

```bash
git add app/js/store.js scripts/test-finance-recurring-store.mjs
git commit -m "feat(accounting): add recurring-rule schema and receipt/AI transaction fields"
```

---

### Task 3: Receipt asset storage (server, no expiry)

**Files:**
- Create: `server/src/connectors/receipt-asset-storage.ts`
- Test: `server/scripts/test-receipt-asset-storage.ts`

**Interfaces:**
- Produces: `export interface ReceiptAssetRecord { id: string; owner_scope: string; original_name: string; mime_type: string; size_bytes: number; created_at: string; }` (no `expires_at` — contrast with `ContentAssetRecord`). `export interface ReceiptAssetStorageProvider { putAsset(input: { ownerScope: string; dataUrl: string; originalName?: string }): Promise<{ ok: true; asset: ReceiptAssetRecord } | { ok: false; error: string }>; getAssetFile(id: string, ownerScope: string): Promise<{ ok: true; dataUrl: string; asset: ReceiptAssetRecord } | { ok: false; error: string }>; deleteAsset(id: string, ownerScope: string): Promise<boolean>; }`. `export function getReceiptAssetStorageProvider(): ReceiptAssetStorageProvider`.

- [ ] **Step 1: Write the failing test**

```ts
// server/scripts/test-receipt-asset-storage.ts
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const tempDir = mkdtempSync(join(tmpdir(), "phantom-receipt-test-"));
const originalDir = process.env.PHANTOMFORCE_RECEIPT_ASSET_DIR;
process.env.PHANTOMFORCE_RECEIPT_ASSET_DIR = tempDir;

try {
  const { getReceiptAssetStorageProvider } = await import("../src/connectors/receipt-asset-storage.js");
  const provider = getReceiptAssetStorageProvider();

  const tinyPngDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const stored = await provider.putAsset({ ownerScope: "owner-jordan", dataUrl: tinyPngDataUrl, originalName: "receipt.png" });
  assert(stored.ok, "storing a valid receipt image must succeed");
  if (!stored.ok) throw new Error("unreachable");
  assert(stored.asset.mime_type === "image/png", "stored asset must record the correct mime type");
  assert(!("expires_at" in stored.asset), "receipt assets must not carry an expiry field");

  const wrongScope = await provider.getAssetFile(stored.asset.id, "someone-else");
  assert(wrongScope.ok === false, "a different owner scope must not be able to read the receipt");

  const read = await provider.getAssetFile(stored.asset.id, "owner-jordan");
  assert(read.ok === true, "the owning scope must be able to read the receipt back");
  if (read.ok) assert(read.dataUrl.startsWith("data:image/png;base64,"), "read-back data URL must round-trip the mime type");

  const oversized = "data:image/png;base64," + "A".repeat(20_000_000);
  const rejected = await provider.putAsset({ ownerScope: "owner-jordan", dataUrl: oversized });
  assert(rejected.ok === false, "an oversized upload must be rejected");

  const deleted = await provider.deleteAsset(stored.asset.id, "owner-jordan");
  assert(deleted === true, "delete must succeed for the owning scope");
  const afterDelete = await provider.getAssetFile(stored.asset.id, "owner-jordan");
  assert(afterDelete.ok === false, "a deleted receipt must no longer be readable");

  console.log(JSON.stringify({ ok: true, suite: "receipt-asset-storage" }));
} finally {
  if (originalDir === undefined) delete process.env.PHANTOMFORCE_RECEIPT_ASSET_DIR;
  else process.env.PHANTOMFORCE_RECEIPT_ASSET_DIR = originalDir;
  rmSync(tempDir, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx tsx scripts/test-receipt-asset-storage.ts`
Expected: FAIL — cannot find module `../src/connectors/receipt-asset-storage.js`

- [ ] **Step 3: Implement receipt-asset-storage.ts**

```ts
/* PhantomForce — receipt asset storage.
   Local-disk storage for photos dropped into the Accounting tab's smart
   entry flow. Unlike content-asset-storage.ts (a 30-day sync/archive
   cache for Content Hub media), receipts are financial records the owner
   may need at tax time, so they carry no automatic expiry — they persist
   until their transaction is deleted and the caller explicitly removes
   them. */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";

const DEFAULT_STATE_DIR = path.join(process.cwd(), ".local", "receipt-assets");
const STATE_DIR = process.env.PHANTOMFORCE_RECEIPT_ASSET_DIR ?? DEFAULT_STATE_DIR;
const FILES_DIR = path.join(STATE_DIR, "files");
const INDEX_FILE = path.join(STATE_DIR, "index.json");
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

export type ReceiptAssetRecord = {
  id: string;
  owner_scope: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
};

type AssetIndex = { records: ReceiptAssetRecord[] };

async function readIndex(): Promise<AssetIndex> {
  try {
    const raw = await readFile(INDEX_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<AssetIndex>;
    return { records: Array.isArray(parsed.records) ? parsed.records : [] };
  } catch {
    return { records: [] };
  }
}

async function writeIndex(index: AssetIndex) {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(INDEX_FILE, `${JSON.stringify(index, null, 2)}\n`, "utf8");
}

function parseDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } | null {
  const match = /^data:([\w./+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  try {
    return { mimeType: match[1], buffer: Buffer.from(match[2], "base64") };
  } catch {
    return null;
  }
}

export interface ReceiptAssetStorageProvider {
  putAsset(input: {
    ownerScope: string;
    dataUrl: string;
    originalName?: string;
  }): Promise<{ ok: true; asset: ReceiptAssetRecord } | { ok: false; error: string }>;
  getAssetFile(
    id: string,
    ownerScope: string,
  ): Promise<{ ok: true; dataUrl: string; asset: ReceiptAssetRecord } | { ok: false; error: string }>;
  deleteAsset(id: string, ownerScope: string): Promise<boolean>;
}

class LocalDiskReceiptAssetProvider implements ReceiptAssetStorageProvider {
  async putAsset({ ownerScope, dataUrl, originalName }: { ownerScope: string; dataUrl: string; originalName?: string }) {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) return { ok: false as const, error: "invalid_data_url" };
    if (parsed.buffer.byteLength > MAX_UPLOAD_BYTES) return { ok: false as const, error: "file_too_large" };

    const id = randomUUID();
    const record: ReceiptAssetRecord = {
      id,
      owner_scope: ownerScope,
      original_name: (originalName || "receipt").slice(0, 160),
      mime_type: parsed.mimeType,
      size_bytes: parsed.buffer.byteLength,
      created_at: new Date().toISOString(),
    };

    await mkdir(FILES_DIR, { recursive: true });
    await writeFile(path.join(FILES_DIR, id), parsed.buffer);
    const index = await readIndex();
    index.records.push(record);
    await writeIndex(index);

    return { ok: true as const, asset: record };
  }

  async getAssetFile(id: string, ownerScope: string) {
    const index = await readIndex();
    const record = index.records.find((item) => item.id === id && item.owner_scope === ownerScope);
    if (!record) return { ok: false as const, error: "not_found" };
    try {
      const buffer = await readFile(path.join(FILES_DIR, id));
      return { ok: true as const, dataUrl: `data:${record.mime_type};base64,${buffer.toString("base64")}`, asset: record };
    } catch {
      return { ok: false as const, error: "file_missing" };
    }
  }

  async deleteAsset(id: string, ownerScope: string) {
    const index = await readIndex();
    const record = index.records.find((item) => item.id === id && item.owner_scope === ownerScope);
    if (!record) return false;
    index.records = index.records.filter((item) => item.id !== id);
    await writeIndex(index);
    await unlink(path.join(FILES_DIR, id)).catch(() => {});
    return true;
  }
}

const localDiskProvider = new LocalDiskReceiptAssetProvider();

export function getReceiptAssetStorageProvider(): ReceiptAssetStorageProvider {
  return localDiskProvider;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && npx tsx scripts/test-receipt-asset-storage.ts`
Expected: `{"ok":true,"suite":"receipt-asset-storage"}`

- [ ] **Step 5: Typecheck and commit**

Run: `cd server && npm run typecheck`
Expected: no errors.

```bash
git add server/src/connectors/receipt-asset-storage.ts server/scripts/test-receipt-asset-storage.ts
git commit -m "feat(accounting): add non-expiring receipt asset storage"
```

---

### Task 4: Deterministic expense-text parsing

**Files:**
- Create: `server/src/connectors/finance-smart-entry.ts`
- Test: `server/scripts/test-finance-smart-entry.ts`

**Interfaces:**
- Produces: `export type ExpenseTextDraft = { kind: "transaction"; description: string; amount: number; direction: "income"|"expense"; categoryGuess: string; date: string; confidence: "high"|"medium"|"low" } | { kind: "recurring_rule"; description: string; amount: number; direction: "income"|"expense"; categoryGuess: string; frequency: "weekly"|"biweekly"|"monthly"|"custom-days"; intervalDays: number|null; startDate: string; confidence: "high"|"medium"|"low" };`
- Produces: `export function parseExpenseText(text: string, options?: { now?: Date }): { ok: true; draft: ExpenseTextDraft } | { ok: false; error: string }`.
- Consumes: nothing (pure, deterministic — no network, no AI).

- [ ] **Step 1: Write the failing test**

```ts
// server/scripts/test-finance-smart-entry.ts
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const { parseExpenseText } = await import("../src/connectors/finance-smart-entry.js");

// No dollar amount at all
{
  const result = parseExpenseText("just a note with no money in it");
  assert(result.ok === false, "text with no dollar amount must fail to parse");
}

// Simple one-off expense with a relative date
{
  const now = new Date("2026-07-15T12:00:00Z");
  const result = parseExpenseText("$45 lunch with client yesterday", { now });
  assert(result.ok === true, "a simple one-off line must parse");
  if (result.ok) {
    assert(result.draft.kind === "transaction", "a non-recurring line must produce a transaction draft");
    assert(result.draft.amount === 45, "amount must be extracted correctly");
    assert(result.draft.direction === "expense", "direction must default to expense");
    if (result.draft.kind === "transaction") assert(result.draft.date === "2026-07-14", "\"yesterday\" must resolve relative to now");
  }
}

// Income keyword flips direction
{
  const result = parseExpenseText("received $1200 from a client");
  assert(result.ok === true);
  if (result.ok && result.draft.kind === "transaction") assert(result.draft.direction === "income", "an income keyword must set direction to income");
}

// Weekly recurrence with an explicit "since <month>" backfill start
{
  const now = new Date("2026-07-15T12:00:00Z");
  const result = parseExpenseText("$500 every week since April", { now });
  assert(result.ok === true, "a recurring line must parse");
  if (result.ok) {
    assert(result.draft.kind === "recurring_rule", "\"every week\" must produce a recurring rule draft");
    if (result.draft.kind === "recurring_rule") {
      assert(result.draft.frequency === "weekly");
      assert(result.draft.amount === 500);
      assert(result.draft.startDate === "2026-04-01", "\"since April\" must resolve to the most recent April 1st");
    }
  }
}

// Monthly recurrence with no explicit start defaults to today (no invented history)
{
  const now = new Date("2026-07-15T12:00:00Z");
  const result = parseExpenseText("$1200 rent every month", { now });
  assert(result.ok === true);
  if (result.ok && result.draft.kind === "recurring_rule") {
    assert(result.draft.frequency === "monthly");
    assert(result.draft.startDate === "2026-07-15", "with no \"since\", startDate must default to today, not an invented history");
  }
}

// "every other week" maps to biweekly
{
  const result = parseExpenseText("$80 every other week for cleaning");
  assert(result.ok === true);
  if (result.ok && result.draft.kind === "recurring_rule") assert(result.draft.frequency === "biweekly");
}

console.log(JSON.stringify({ ok: true, suite: "finance-smart-entry-text" }));
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx tsx scripts/test-finance-smart-entry.ts`
Expected: FAIL — cannot find module `../src/connectors/finance-smart-entry.js`

- [ ] **Step 3: Implement parseExpenseText**

```ts
// server/src/connectors/finance-smart-entry.ts (first half — text parsing)
const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const INCOME_PATTERN = /\b(received|paid me|client paid|customer paid|income|deposit|got paid|payment from)\b/i;
const RECURRENCE_PATTERN = /\bevery\s+(day|other day|week|other week|two weeks|month|other month)\b|\b(biweekly|weekly|monthly|daily)\b/i;
const SINCE_MONTH_PATTERN = new RegExp(`\\bsince\\s+(${MONTH_NAMES.join("|")})\\b`, "i");
const RELATIVE_DAY_PATTERN = /\b(today|yesterday|tomorrow)\b/i;
const AMOUNT_PATTERN = /\$\s?([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)|([0-9]+(?:\.[0-9]{1,2})?)\s?(?:dollars|dollar|bucks)\b/i;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function relativeDate(word: string, now: Date): string {
  const d = new Date(now);
  if (word === "yesterday") d.setUTCDate(d.getUTCDate() - 1);
  if (word === "tomorrow") d.setUTCDate(d.getUTCDate() + 1);
  return isoDate(d);
}

function mostRecentMonthStart(monthName: string, now: Date): string {
  const monthIndex = MONTH_NAMES.indexOf(monthName.toLowerCase());
  const year = now.getUTCFullYear();
  const candidate = new Date(Date.UTC(year, monthIndex, 1));
  if (candidate.getTime() > now.getTime()) candidate.setUTCFullYear(year - 1);
  return isoDate(candidate);
}

function frequencyFromToken(token: string): { frequency: "weekly" | "biweekly" | "monthly" | "custom-days"; intervalDays: number | null } {
  const t = token.toLowerCase();
  if (t === "week" || t === "weekly") return { frequency: "weekly", intervalDays: null };
  if (t === "other week" || t === "two weeks" || t === "biweekly") return { frequency: "biweekly", intervalDays: null };
  if (t === "month" || t === "monthly") return { frequency: "monthly", intervalDays: null };
  if (t === "other month") return { frequency: "custom-days", intervalDays: 60 };
  if (t === "other day") return { frequency: "custom-days", intervalDays: 2 };
  return { frequency: "custom-days", intervalDays: 1 }; // "day" / "daily"
}

export type ExpenseTextDraft =
  | {
      kind: "transaction";
      description: string;
      amount: number;
      direction: "income" | "expense";
      categoryGuess: string;
      date: string;
      confidence: "high" | "medium" | "low";
    }
  | {
      kind: "recurring_rule";
      description: string;
      amount: number;
      direction: "income" | "expense";
      categoryGuess: string;
      frequency: "weekly" | "biweekly" | "monthly" | "custom-days";
      intervalDays: number | null;
      startDate: string;
      confidence: "high" | "medium" | "low";
    };

export function parseExpenseText(
  text: string,
  options: { now?: Date } = {},
): { ok: true; draft: ExpenseTextDraft } | { ok: false; error: string } {
  const now = options.now ?? new Date();
  const raw = String(text || "").trim();
  if (!raw) {
    return { ok: false, error: 'Enter a line like "$45 lunch with client yesterday" or "$500 every week since April."' };
  }

  const amountMatch = AMOUNT_PATTERN.exec(raw);
  if (!amountMatch) {
    return { ok: false, error: "Couldn't find a dollar amount in that line." };
  }
  const amountText = (amountMatch[1] || amountMatch[2] || "").replace(/,/g, "");
  const amount = Number(amountText);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Couldn't read a valid amount from that line." };
  }

  const direction: "income" | "expense" = INCOME_PATTERN.test(raw) ? "income" : "expense";

  const description = raw
    .replace(amountMatch[0], "")
    .replace(RECURRENCE_PATTERN, "")
    .replace(SINCE_MONTH_PATTERN, "")
    .replace(RELATIVE_DAY_PATTERN, "")
    .replace(/\s{2,}/g, " ")
    .trim() || "Expense";

  const recurrenceMatch = RECURRENCE_PATTERN.exec(raw);
  if (recurrenceMatch) {
    const token = (recurrenceMatch[1] || recurrenceMatch[2] || "").toLowerCase();
    const { frequency, intervalDays } = frequencyFromToken(token);
    const sinceMatch = SINCE_MONTH_PATTERN.exec(raw);
    const startDate = sinceMatch ? mostRecentMonthStart(sinceMatch[1], now) : isoDate(now);
    return {
      ok: true,
      draft: {
        kind: "recurring_rule",
        description,
        amount,
        direction,
        categoryGuess: "Uncategorized",
        frequency,
        intervalDays,
        startDate,
        confidence: "high",
      },
    };
  }

  const dateMatch = RELATIVE_DAY_PATTERN.exec(raw);
  const date = dateMatch ? relativeDate(dateMatch[1].toLowerCase(), now) : isoDate(now);

  return {
    ok: true,
    draft: {
      kind: "transaction",
      description,
      amount,
      direction,
      categoryGuess: "Uncategorized",
      date,
      confidence: "medium",
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && npx tsx scripts/test-finance-smart-entry.ts`
Expected: `{"ok":true,"suite":"finance-smart-entry-text"}`

- [ ] **Step 5: Typecheck and commit**

Run: `cd server && npm run typecheck`

```bash
git add server/src/connectors/finance-smart-entry.ts server/scripts/test-finance-smart-entry.ts
git commit -m "feat(accounting): add deterministic natural-language expense parsing"
```

---

### Task 5: AI receipt-image parsing

**Files:**
- Modify: `server/src/connectors/finance-smart-entry.ts` (append to the file created in Task 4)
- Modify: `server/scripts/test-finance-smart-entry.ts` (append receipt-parsing tests)

**Interfaces:**
- Consumes: nothing external at import time; calls `fetch` at runtime (injectable for tests, matching the pattern already used in `social-analytics-connector.ts`'s `syncSocialAnalytics(platform, fetcher = fetch)`).
- Produces: `export type ReceiptDraft = { vendor: string; amount: number; direction: "income"|"expense"; date: string; categoryGuess: string; confidence: "high"|"medium"|"low" };` and `export async function parseReceiptImage(dataUrl: string, options?: { fetcher?: typeof fetch; env?: NodeJS.ProcessEnv }): Promise<{ available: true; draft: ReceiptDraft } | { available: false; reason: string }>`.

- [ ] **Step 1: Write the failing test (append to the existing file)**

```ts
// append to server/scripts/test-finance-smart-entry.ts, before the final console.log
const { parseReceiptImage } = await import("../src/connectors/finance-smart-entry.js");

// AI parsing disabled (flags off) must degrade gracefully, not throw
{
  const result = await parseReceiptImage("data:image/png;base64,AAAA", {
    env: { PHANTOM_LIVE_PROVIDERS_ENABLED: "false", PHANTOM_OPENROUTER_TRANSPORT_ENABLED: "true", OPENROUTER_API_KEY: "test-key" } as NodeJS.ProcessEnv,
  });
  assert(result.available === false, "receipt parsing must report unavailable when live providers are disabled");
}

// AI parsing enabled: a mocked OpenRouter response must produce a structured draft
{
  const mockFetch = (async (input: string | URL | Request) => {
    const url = String(input);
    assert(url === "https://openrouter.ai/api/v1/chat/completions", "must call the OpenRouter chat completions endpoint");
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ vendor: "Home Depot", amount: 84.12, direction: "expense", date: "2026-07-14", categoryGuess: "Equipment", confidence: "high" }) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  const result = await parseReceiptImage("data:image/png;base64,AAAA", {
    fetcher: mockFetch,
    env: { PHANTOM_LIVE_PROVIDERS_ENABLED: "true", PHANTOM_OPENROUTER_TRANSPORT_ENABLED: "true", OPENROUTER_API_KEY: "test-key" } as NodeJS.ProcessEnv,
  });
  assert(result.available === true, "receipt parsing must succeed with providers enabled and a valid mock response");
  if (result.available) {
    assert(result.draft.vendor === "Home Depot");
    assert(result.draft.amount === 84.12);
  }
}

// A malformed provider response must degrade to unavailable, not throw
{
  const brokenFetch = (async () => new Response("not json", { status: 200 })) as typeof fetch;
  const result = await parseReceiptImage("data:image/png;base64,AAAA", {
    fetcher: brokenFetch,
    env: { PHANTOM_LIVE_PROVIDERS_ENABLED: "true", PHANTOM_OPENROUTER_TRANSPORT_ENABLED: "true", OPENROUTER_API_KEY: "test-key" } as NodeJS.ProcessEnv,
  });
  assert(result.available === false, "a malformed provider response must degrade to unavailable rather than throw");
}
```

Change the file's final line from `console.log(JSON.stringify({ ok: true, suite: "finance-smart-entry-text" }));` to `console.log(JSON.stringify({ ok: true, suite: "finance-smart-entry" }));` (this test file now covers both text and receipt parsing).

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx tsx scripts/test-finance-smart-entry.ts`
Expected: FAIL — `parseReceiptImage` is not exported.

- [ ] **Step 3: Implement parseReceiptImage (append to finance-smart-entry.ts)**

```ts
// append to server/src/connectors/finance-smart-entry.ts

export type ReceiptDraft = {
  vendor: string;
  amount: number;
  direction: "income" | "expense";
  date: string;
  categoryGuess: string;
  confidence: "high" | "medium" | "low";
};

const RECEIPT_MODEL_ID = "z-ai/glm-5.2";
const RECEIPT_EXTRACTION_PROMPT =
  'Read this receipt image and return ONLY a JSON object (no prose, no markdown fences) with exactly these keys: ' +
  '{"vendor": string, "amount": number, "direction": "income" or "expense", "date": "YYYY-MM-DD", "categoryGuess": string, "confidence": "high" or "medium" or "low"}. ' +
  'Use "expense" unless the receipt is clearly a refund or payment received. If you cannot read a field confidently, make your best guess and set confidence to "low".';

function liveProvidersEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.PHANTOM_LIVE_PROVIDERS_ENABLED === "true" && env.PHANTOM_OPENROUTER_TRANSPORT_ENABLED === "true";
}

function parseReceiptModelOutput(content: string): ReceiptDraft | null {
  try {
    const parsed = JSON.parse(content.trim().replace(/^```json\s*|```$/g, ""));
    const amount = Number(parsed.amount);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return {
      vendor: String(parsed.vendor || "Unknown vendor").slice(0, 160),
      amount,
      direction: parsed.direction === "income" ? "income" : "expense",
      date: /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : new Date().toISOString().slice(0, 10),
      categoryGuess: String(parsed.categoryGuess || "Uncategorized").slice(0, 80),
      confidence: parsed.confidence === "high" || parsed.confidence === "low" ? parsed.confidence : "medium",
    };
  } catch {
    return null;
  }
}

export async function parseReceiptImage(
  dataUrl: string,
  options: { fetcher?: typeof fetch; env?: NodeJS.ProcessEnv } = {},
): Promise<{ available: true; draft: ReceiptDraft } | { available: false; reason: string }> {
  const env = options.env ?? process.env;
  if (!liveProvidersEnabled(env)) {
    return { available: false, reason: "AI parsing isn't enabled yet. Fill in the details manually below." };
  }
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return { available: false, reason: "AI parsing isn't configured yet. Fill in the details manually below." };
  }

  const fetcher = options.fetcher ?? fetch;
  try {
    const response = await fetcher("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: RECEIPT_MODEL_ID,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: RECEIPT_EXTRACTION_PROMPT },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        max_tokens: 300,
        temperature: 0,
      }),
    });
    if (!response.ok) {
      return { available: false, reason: `The AI provider returned an error (HTTP ${response.status}). Fill in the details manually below.` };
    }
    const payload = await response.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }> } | null;
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) {
      return { available: false, reason: "The AI provider returned an empty response. Fill in the details manually below." };
    }
    const draft = parseReceiptModelOutput(content);
    if (!draft) {
      return { available: false, reason: "Couldn't read structured data from that receipt. Fill in the details manually below." };
    }
    return { available: true, draft };
  } catch {
    return { available: false, reason: "Couldn't reach the AI provider. Fill in the details manually below." };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && npx tsx scripts/test-finance-smart-entry.ts`
Expected: `{"ok":true,"suite":"finance-smart-entry"}`

- [ ] **Step 5: Typecheck and commit**

Run: `cd server && npm run typecheck`

```bash
git add server/src/connectors/finance-smart-entry.ts server/scripts/test-finance-smart-entry.ts
git commit -m "feat(accounting): add AI receipt-image parsing via direct OpenRouter call"
```

---

### Task 6: Server routes

**Files:**
- Modify: `server/src/index.ts` (add imports near line 181's `getFinanceConnectorStatus` import, and add routes directly after the existing `/phantom-ai/ops/finance-connector/status` route — re-check the exact line with Grep before editing since this file is large and shared)
- Test: `server/scripts/test-finance-smart-entry-routes.ts`

**Interfaces:**
- Consumes: `getFinanceConnectorStatus` (existing import, unchanged), `parseExpenseText`, `parseReceiptImage` (from Task 4/5), `getReceiptAssetStorageProvider` (from Task 3), `requireAdminAccessSession` (existing).
- Produces: three routes described below. No new exports — routes are registered directly on the existing `app` instance.

- [ ] **Step 1: Write the failing test**

```ts
// server/scripts/test-finance-smart-entry-routes.ts
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}
function parseJson<T>(payload: string): T {
  return JSON.parse(payload) as T;
}

process.env.NODE_ENV = "development";
process.env.PHANTOMFORCE_SERVER_LISTEN = "false";
process.env.PHANTOMFORCE_SERVER_LOGGER = "false";
process.env.PHANTOMFORCE_AUTH_PROVIDER = "demo";
process.env.PHANTOMFORCE_ENABLE_DEMO_AUTH = "true";
process.env.PHANTOMFORCE_SKIP_SERVER_DOTENV = "true";
process.env.PHANTOMFORCE_ALLOW_UNSIGNED_SESSION_HEADER = "false";
process.env.PHANTOM_LIVE_PROVIDERS_ENABLED = "false"; // exercise the graceful-degrade path, no live network call in this test

const { app } = await import("../src/index.js");

type LoginResponse = { ok: boolean; token: string };

try {
  const adminLogin = await app.inject({
    method: "POST",
    url: "/auth/demo-login",
    headers: { "Content-Type": "application/json" },
    payload: JSON.stringify({ sessionId: "admin-jordan" }),
  });
  assert(adminLogin.statusCode === 200, "Admin demo login should succeed.");
  const adminToken = parseJson<LoginResponse>(adminLogin.payload).token;
  const headers = { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" };

  const unauthText = await app.inject({ method: "POST", url: "/phantom-ai/ops/finance/parse-expense-text", payload: JSON.stringify({ text: "$5 coffee" }) });
  assert(unauthText.statusCode === 401, "Unauthenticated text parse must return 401.");

  const textResult = await app.inject({
    method: "POST",
    url: "/phantom-ai/ops/finance/parse-expense-text",
    headers,
    payload: JSON.stringify({ text: "$500 every week since April" }),
  });
  assert(textResult.statusCode === 200, "A valid text parse must return 200.");
  const textBody = parseJson<{ ok: boolean; draft: { kind: string } }>(textResult.payload);
  assert(textBody.ok === true, "Text parse response must be ok.");
  assert(textBody.draft.kind === "recurring_rule", "A recurring phrase must produce a recurring_rule draft.");

  const badTextResult = await app.inject({
    method: "POST",
    url: "/phantom-ai/ops/finance/parse-expense-text",
    headers,
    payload: JSON.stringify({ text: "no money here" }),
  });
  assert(badTextResult.statusCode === 422, "Unparseable text must return 422.");

  const tinyPngDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const receiptResult = await app.inject({
    method: "POST",
    url: "/phantom-ai/ops/finance/parse-receipt",
    headers,
    payload: JSON.stringify({ image: tinyPngDataUrl, filename: "receipt.png" }),
  });
  assert(receiptResult.statusCode === 200, "A receipt upload must return 200 even when AI parsing is disabled.");
  const receiptBody = parseJson<{ ok: boolean; assetId: string | null; aiAvailable: boolean }>(receiptResult.payload);
  assert(receiptBody.ok === true, "Receipt upload response must be ok.");
  assert(typeof receiptBody.assetId === "string" && receiptBody.assetId.length > 0, "A stored receipt must return an assetId.");
  assert(receiptBody.aiAvailable === false, "AI must report unavailable when live providers are disabled.");

  const fetchResult = await app.inject({
    method: "GET",
    url: `/phantom-ai/ops/finance/receipt/${receiptBody.assetId}`,
    headers,
  });
  assert(fetchResult.statusCode === 200, "Fetching a just-stored receipt must return 200.");

  console.log(JSON.stringify({ ok: true, suite: "finance-smart-entry-routes" }));
} finally {
  await app.close();
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx tsx scripts/test-finance-smart-entry-routes.ts`
Expected: FAIL — 404s on the new routes (they don't exist yet).

- [ ] **Step 3: Add the routes to server/src/index.ts**

Add near the top imports, alongside the existing `import { getFinanceConnectorStatus } from "./connectors/finance-connector.js";`:
```ts
import { parseExpenseText, parseReceiptImage } from "./connectors/finance-smart-entry.js";
import { getReceiptAssetStorageProvider } from "./connectors/receipt-asset-storage.js";
```

Add directly after the existing `/phantom-ai/ops/finance-connector/status` route:
```ts
const FinanceExpenseTextSchema = z.object({
  text: z.string().trim().min(1).max(400),
});

app.post("/phantom-ai/ops/finance/parse-expense-text", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);
  if (!session) return reply;

  const parsed = FinanceExpenseTextSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() });

  const result = parseExpenseText(parsed.data.text);
  if (!result.ok) return reply.code(422).send({ ok: false, error: result.error });

  return { ok: true, session, read_only: true, draft: result.draft };
});

const FinanceReceiptSchema = z.object({
  image: z.string().trim().min(1).max(20_000_000),
  filename: z.string().trim().max(160).optional(),
});

app.post("/phantom-ai/ops/finance/parse-receipt", { bodyLimit: 16 * 1024 * 1024 }, async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);
  if (!session) return reply;

  const parsed = FinanceReceiptSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.flatten() });

  const storageProvider = getReceiptAssetStorageProvider();
  const stored = await storageProvider.putAsset({
    ownerScope: session.id,
    dataUrl: parsed.data.image,
    originalName: parsed.data.filename,
  });
  const assetId = stored.ok ? stored.asset.id : null;

  const aiResult = await parseReceiptImage(parsed.data.image);

  return {
    ok: true,
    session,
    read_only: true,
    assetId,
    aiAvailable: aiResult.available,
    draft: aiResult.available ? aiResult.draft : null,
    reason: aiResult.available ? undefined : aiResult.reason,
  };
});

app.get("/phantom-ai/ops/finance/receipt/:assetId", async (request, reply) => {
  const session = requireAdminAccessSession(request, reply);
  if (!session) return reply;

  const { assetId } = request.params as { assetId: string };
  const storageProvider = getReceiptAssetStorageProvider();
  const result = await storageProvider.getAssetFile(assetId, session.id);
  if (!result.ok) return reply.code(404).send({ ok: false, error: result.error });

  return { ok: true, session, image: result.dataUrl, asset: result.asset };
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && npx tsx scripts/test-finance-smart-entry-routes.ts`
Expected: `{"ok":true,"suite":"finance-smart-entry-routes"}`

- [ ] **Step 5: Typecheck, add the npm script, run the full server test regression, and commit**

Run: `cd server && npm run typecheck`

Add to `server/package.json` `"scripts"`:
```json
"test:finance-smart-entry": "tsx scripts/test-finance-smart-entry.ts",
"test:receipt-asset-storage": "tsx scripts/test-receipt-asset-storage.ts",
"test:finance-smart-entry-routes": "tsx scripts/test-finance-smart-entry-routes.ts",
```

Run: `cd server && npm run test:social-analytics && npm run test:finance-smart-entry && npm run test:receipt-asset-storage && npm run test:finance-smart-entry-routes`
Expected: all four suites print their `{"ok":true,...}` line with no errors (confirms this task didn't regress the social-analytics work from earlier in this session).

```bash
git add server/src/index.ts server/scripts/test-finance-smart-entry-routes.ts server/package.json
git commit -m "feat(accounting): wire finance smart-entry routes (parse-expense-text, parse-receipt, receipt fetch)"
```

---

### Task 7: Accounting tab UI — drop zone, text entry, confirm cards, recurring rules panel

**Files:**
- Modify: `app/js/workspaces.js` (`renderMoney` and its surrounding helpers — re-run `grep -n "function renderMoney\|MONEY ===="` first to confirm current line numbers before editing, since this is a shared, actively-edited file)

**Interfaces:**
- Consumes: `generateDueOccurrences` from `app/js/finance-recurring.js` (Task 1); `moneyView()`'s new `recurringRules` field (Task 2); the three new server routes (Task 6) via a small local `financeApi(path, opts)` fetch helper matching the existing `analyticsApi`-style pattern used elsewhere in this codebase (bearer token from `store.session()`/however the existing auth header is sourced in this file — confirm the exact helper name already in scope via `grep -n "Authorization: \`Bearer" app/js/workspaces.js app/js/main.js` before writing this task's code, and reuse it rather than reinventing token lookup).
- Produces: no new exports — this task only changes rendering/wiring inside `renderMoney`.

- [ ] **Step 1: Re-verify current state before editing**

```bash
grep -n "function renderMoney\|const moneySigned\|financeCategoryOptions\|todayInput\|const form = el.querySelector" app/js/workspaces.js
grep -n "Authorization: \`Bearer" app/js/workspaces.js app/js/main.js
```
Confirm the line numbers and the existing bearer-token helper name match what this task assumes below; if the file has shifted or the helper has a different name, adjust the edits accordingly rather than guessing.

- [ ] **Step 2: Add the recurring-rules top-up call at the start of renderMoney**

Add this import at the top of `app/js/workspaces.js` alongside its other imports:
```js
import { generateDueOccurrences } from "./finance-recurring.js";
```

Add a new function directly above `renderMoney`:
```js
function topUpRecurringRules(finance, ws) {
  const today = new Date().toISOString().slice(0, 10);
  let changed = false;
  for (const rule of finance.recurringRules) {
    if (rule.ws !== ws || rule.status !== "active") continue;
    const { occurrences, nextLastGeneratedDate } = generateDueOccurrences(rule, today);
    if (!occurrences.length) continue;
    changed = true;
    for (const occurrence of occurrences) {
      finance.transactions.unshift({
        id: uid("txn"),
        ws,
        date: occurrence.date,
        description: rule.description,
        amount: rule.direction === "expense" ? -rule.amount : rule.amount,
        category: rule.category,
        account: rule.account,
        source: "recurring-rule",
        externalId: `rule:${rule.id}:${occurrence.date}`,
        notes: "",
        receiptAssetId: null,
        recurringRuleId: rule.id,
        aiAssisted: rule.source === "ai-parsed",
        createdAt: new Date().toISOString(),
      });
    }
    rule.lastGeneratedDate = nextLastGeneratedDate;
  }
  return changed;
}
```

At the very start of `renderMoney(el, rerender)`, before `const m = moneyView();`, add:
```js
  const ws0 = currentWs() === "phantomforce" ? "phantomforce" : currentWs();
  if (topUpRecurringRules(store.state.finance, ws0)) store.save();
```
(the existing `const m = moneyView();` line stays immediately after this — `moneyView()` will now pick up any freshly-generated transactions).

- [ ] **Step 3: Add the smart-entry hero (drop zone + text input) and demote the connector panel**

Replace the existing `finance-grid` section (the two `<section class="finance-panel">` blocks for "Accounts & imports" and "Add transaction") with:
```js
      <section class="finance-panel finance-smart-entry">
        <div class="finance-panel-head">
          <h3>Add money in or out</h3>
          <span>photo or plain English</span>
        </div>
        <div class="finance-dropzone" data-finance-dropzone tabindex="0" role="button" aria-label="Drop receipt photos here or click to upload">
          <p><b>Drop receipt photos here</b><br>or click to upload</p>
          <input type="file" accept="image/*" data-finance-photo-input multiple hidden />
        </div>
        <form class="finance-text-entry" data-finance-text-form>
          <input type="text" name="line" placeholder='"$500 every week since April"' maxlength="400" required />
          <button class="btn btn-primary" type="submit">Parse</button>
        </form>
        <div class="finance-draft-queue" data-finance-draft-queue></div>
        <details class="finance-advanced">
          <summary>Advanced: connect a bank or card (optional)</summary>
          <div class="finance-connectors">
            ${m.connectors.map((connector) => `
              <article class="finance-connector finance-${esc(connector.status)}">
                <span class="finance-connector-kind">${esc(connector.type)}</span>
                <b>${esc(connector.name)}</b>
                <p>${connector.id === "manual"
                  ? "Manual entry and CSV import are active right now."
                  : `Live sync uses ${esc(connector.provider)} once backend credentials and secure token storage are configured.`}</p>
                <div class="finance-connector-foot">
                  <i>${esc(connectorLabel(connector))}</i>
                  ${connector.id === "manual"
                    ? `<label class="btn btn-quiet finance-import">Import CSV<input type="file" accept=".csv,text/csv" data-finance-import hidden /></label>`
                    : `<button class="btn btn-quiet" data-act="connector" data-id="${esc(connector.id)}" type="button">${connector.status === "requested" ? "Setup requested" : "Prepare setup"}</button>`}
                </div>
              </article>`).join("")}
          </div>
          <form class="finance-entry" data-finance-form>
            <label><span>Date</span><input type="date" name="date" value="${todayInput()}" required /></label>
            <label><span>Description</span><input type="text" name="description" placeholder="Stripe payout, Adobe, contractor..." required /></label>
            <label><span>Direction</span><select name="direction"><option value="income">Cash in</option><option value="expense">Cash out</option></select></label>
            <label><span>Amount</span><input type="number" name="amount" min="0.01" step="0.01" placeholder="0.00" required /></label>
            <label><span>Category</span><select name="category">${financeCategoryOptions()}</select></label>
            <label><span>Account</span><input type="text" name="account" placeholder="Business checking / card" /></label>
            <button class="btn btn-primary" type="submit">Add transaction</button>
          </form>
        </details>
      </section>

      <section class="finance-panel">
        <div class="finance-panel-head">
          <h3>Recurring rules</h3>
          <span>${m.recurringRules.filter((r) => r.status === "active").length} active</span>
        </div>
        <div class="finance-rules-list">
          ${m.recurringRules.map((rule) => `
            <article class="finance-rule-row ${rule.status === "paused" ? "is-paused" : ""}">
              <div>
                <b>${esc(rule.description)}</b>
                <i>${rule.frequency} · ${moneySigned(rule.direction === "expense" ? -rule.amount : rule.amount)} · since ${esc(fmtDate(rule.startDate))}</i>
              </div>
              <div class="finance-rule-actions">
                <button class="btn btn-quiet" type="button" data-act="rule-toggle" data-id="${esc(rule.id)}">${rule.status === "paused" ? "Resume" : "Pause"}</button>
                <button class="btn btn-quiet" type="button" data-act="rule-delete" data-id="${esc(rule.id)}">Delete</button>
              </div>
            </article>`).join("") || empty("No recurring rules yet. Type something like \"$500 every week since April\" above.")}
        </div>
      </section>
```
(the "Accounting transaction reader" section and "GOALS, NOT ACCOUNTING" section immediately after this stay exactly as they are today — only the two panels above them are being replaced/added).

- [ ] **Step 4: Wire the drop zone, text form, and confirm-card rendering**

Add these functions above `renderMoney` (near `topUpRecurringRules`):
```js
function financeDraftCategoryOptions(guess) {
  const selected = FINANCE_CATEGORIES.includes(guess) ? guess : "Uncategorized";
  return financeCategoryOptions(selected);
}

function renderExpenseTextDraft(draft) {
  if (draft.kind === "recurring_rule") {
    return `
      <article class="finance-draft-card" data-draft-kind="recurring_rule">
        <p class="finance-draft-title">Recurring: ${esc(draft.description)}</p>
        <label><span>Amount</span><input type="number" name="amount" step="0.01" value="${draft.amount}" required /></label>
        <label><span>Direction</span><select name="direction"><option value="income" ${draft.direction === "income" ? "selected" : ""}>Cash in</option><option value="expense" ${draft.direction === "expense" ? "selected" : ""}>Cash out</option></select></label>
        <label><span>Category</span><select name="category">${financeDraftCategoryOptions(draft.categoryGuess)}</select></label>
        <label><span>Frequency</span><select name="frequency">
          <option value="weekly" ${draft.frequency === "weekly" ? "selected" : ""}>Weekly</option>
          <option value="biweekly" ${draft.frequency === "biweekly" ? "selected" : ""}>Every 2 weeks</option>
          <option value="monthly" ${draft.frequency === "monthly" ? "selected" : ""}>Monthly</option>
        </select></label>
        <label><span>Starts</span><input type="date" name="startDate" value="${draft.startDate}" required /></label>
        <div class="finance-draft-actions">
          <button class="btn btn-primary" type="button" data-draft-confirm>Add to books</button>
          <button class="btn btn-ghost" type="button" data-draft-discard>Discard</button>
        </div>
      </article>`;
  }
  return `
    <article class="finance-draft-card" data-draft-kind="transaction">
      <p class="finance-draft-title">${esc(draft.description)}</p>
      <label><span>Amount</span><input type="number" name="amount" step="0.01" value="${draft.amount}" required /></label>
      <label><span>Direction</span><select name="direction"><option value="income" ${draft.direction === "income" ? "selected" : ""}>Cash in</option><option value="expense" ${draft.direction === "expense" ? "selected" : ""}>Cash out</option></select></label>
      <label><span>Category</span><select name="category">${financeDraftCategoryOptions(draft.categoryGuess)}</select></label>
      <label><span>Date</span><input type="date" name="date" value="${draft.date}" required /></label>
      <div class="finance-draft-actions">
        <button class="btn btn-primary" type="button" data-draft-confirm>Add to books</button>
        <button class="btn btn-ghost" type="button" data-draft-discard>Discard</button>
      </div>
    </article>`;
}

function renderReceiptDraft(assetId, draft, aiAvailable, reason) {
  const safeDraft = draft || { vendor: "", amount: "", direction: "expense", date: todayInput(), categoryGuess: "Uncategorized" };
  return `
    <article class="finance-draft-card" data-draft-kind="receipt" data-asset-id="${esc(assetId || "")}">
      <p class="finance-draft-title">${aiAvailable ? `AI read: ${esc(safeDraft.vendor)}` : esc(reason || "Fill in this receipt manually")}</p>
      <label><span>Vendor</span><input type="text" name="vendor" value="${esc(safeDraft.vendor)}" /></label>
      <label><span>Amount</span><input type="number" name="amount" step="0.01" value="${esc(String(safeDraft.amount ?? ""))}" required /></label>
      <label><span>Direction</span><select name="direction"><option value="income" ${safeDraft.direction === "income" ? "selected" : ""}>Cash in</option><option value="expense" ${safeDraft.direction === "expense" ? "selected" : ""}>Cash out</option></select></label>
      <label><span>Category</span><select name="category">${financeDraftCategoryOptions(safeDraft.categoryGuess)}</select></label>
      <label><span>Date</span><input type="date" name="date" value="${safeDraft.date || todayInput()}" required /></label>
      <div class="finance-draft-actions">
        <button class="btn btn-primary" type="button" data-draft-confirm>Add to books</button>
        <button class="btn btn-ghost" type="button" data-draft-discard>Discard</button>
      </div>
    </article>`;
}
```

Add the wiring at the end of `renderMoney`, inside the existing block of `el.querySelector`/`bindActions` calls (after the existing `importInput.onchange` block, before the final `bindActions(el, {...})` call):
```js
  const textForm = el.querySelector("[data-finance-text-form]");
  const draftQueue = el.querySelector("[data-finance-draft-queue]");
  if (textForm && draftQueue) {
    textForm.onsubmit = async (event) => {
      event.preventDefault();
      const line = new FormData(textForm).get("line");
      textForm.reset();
      try {
        const response = await financeApi("/phantom-ai/ops/finance/parse-expense-text", { method: "POST", body: { text: line } });
        const card = document.createElement("div");
        card.innerHTML = renderExpenseTextDraft(response.draft);
        const article = card.firstElementChild;
        draftQueue.prepend(article);
        wireDraftCardActions(article, { kind: response.draft.kind, ws });
      } catch (error) {
        pushActivity("Accounting Ledger", `Couldn't parse "${line}": ${error?.message || "unknown error"}.`, ws);
      }
    };
  }

  const dropzone = el.querySelector("[data-finance-dropzone]");
  const photoInput = el.querySelector("[data-finance-photo-input]");
  if (dropzone && photoInput && draftQueue) {
    dropzone.onclick = () => photoInput.click();
    dropzone.onkeydown = (event) => { if (event.key === "Enter" || event.key === " ") photoInput.click(); };
    dropzone.ondragover = (event) => { event.preventDefault(); dropzone.classList.add("is-dragover"); };
    dropzone.ondragleave = () => dropzone.classList.remove("is-dragover");
    dropzone.ondrop = async (event) => {
      event.preventDefault();
      dropzone.classList.remove("is-dragover");
      await handleReceiptFiles(event.dataTransfer?.files);
    };
    photoInput.onchange = async () => {
      await handleReceiptFiles(photoInput.files);
      photoInput.value = "";
    };
  }
  async function handleReceiptFiles(fileList) {
    const files = Array.from(fileList || []).filter((file) => file.type.startsWith("image/"));
    for (const file of files) {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      try {
        const response = await financeApi("/phantom-ai/ops/finance/parse-receipt", { method: "POST", body: { image: dataUrl, filename: file.name } });
        const card = document.createElement("div");
        card.innerHTML = renderReceiptDraft(response.assetId, response.draft, response.aiAvailable, response.reason);
        const article = card.firstElementChild;
        draftQueue?.prepend(article);
        wireDraftCardActions(article, { kind: "receipt", ws });
      } catch (error) {
        pushActivity("Accounting Ledger", `Couldn't read ${file.name}: ${error?.message || "unknown error"}.`, ws);
      }
    }
  }
  function wireDraftCardActions(article, { kind, ws: draftWs }) {
    article.querySelector("[data-draft-discard]").onclick = () => article.remove();
    article.querySelector("[data-draft-confirm]").onclick = () => {
      const fields = {};
      article.querySelectorAll("input,select").forEach((input) => { fields[input.name] = input.value; });
      const amount = Number(fields.amount);
      if (!Number.isFinite(amount) || amount <= 0) return;
      const signedAmount = fields.direction === "expense" ? -amount : amount;
      const account = ensureAccount("Manual ledger");
      if (kind === "recurring_rule") {
        financeNow().recurringRules.unshift({
          id: uid("rule"),
          ws: draftWs,
          description: fields.description || article.querySelector(".finance-draft-title")?.textContent || "Recurring transaction",
          amount,
          direction: fields.direction === "income" ? "income" : "expense",
          category: fields.category || "Uncategorized",
          account,
          frequency: fields.frequency || "monthly",
          intervalDays: null,
          startDate: fields.startDate || todayInput(),
          endDate: null,
          status: "active",
          lastGeneratedDate: null,
          createdAt: new Date().toISOString(),
          source: "ai-parsed",
        });
        pushActivity("Accounting Ledger", `created a recurring rule: ${fields.description || "recurring transaction"} (${moneySigned(signedAmount)} ${fields.frequency || "monthly"}).`, draftWs);
      } else {
        financeNow().transactions.unshift({
          id: uid("txn"),
          ws: draftWs,
          date: fields.date || todayInput(),
          description: fields.vendor || fields.description || "AI-assisted transaction",
          amount: signedAmount,
          category: fields.category || "Uncategorized",
          account,
          source: kind === "receipt" ? "ai-receipt" : "ai-text",
          externalId: null,
          notes: "",
          receiptAssetId: article.dataset.assetId || null,
          recurringRuleId: null,
          aiAssisted: true,
          createdAt: new Date().toISOString(),
        });
        pushActivity("Accounting Ledger", `added a ${signedAmount > 0 ? "cash-in" : "cash-out"} transaction: ${moneySigned(signedAmount)}.`, draftWs);
      }
      article.remove();
      store.save();
      rerender();
    };
  }

  el.querySelectorAll("[data-act='rule-toggle']").forEach((button) => {
    button.onclick = () => {
      const rule = financeNow().recurringRules.find((item) => item.id === button.dataset.id);
      if (!rule) return;
      rule.status = rule.status === "paused" ? "active" : "paused";
      store.save();
      rerender();
    };
  });
  el.querySelectorAll("[data-act='rule-delete']").forEach((button) => {
    button.onclick = () => {
      const rule = financeNow().recurringRules.find((item) => item.id === button.dataset.id);
      if (rule && !confirm(`Delete the recurring rule "${rule.description}"? Past transactions it already created will stay on the books.`)) return;
      financeNow().recurringRules = financeNow().recurringRules.filter((item) => item.id !== button.dataset.id);
      store.save();
      rerender();
    };
  });
```

Add a small `financeApi` helper near the top of the "MONEY" section (mirroring whatever bearer-token helper Step 1's grep found — if the file already has a shared authenticated-fetch helper used elsewhere, call that instead of writing a new one; only add this if none exists):
```js
async function financeApi(path, { method = "GET", body } = {}) {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${store.session()?.token || ""}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(payload?.error?.message || payload?.error || `Request failed (HTTP ${response.status}).`);
  return payload;
}
```

- [ ] **Step 5: Manual browser verification**

Run the app locally (per this repo's `/run`-style verification norm) and in the Accounting tab:
1. Type `$45 lunch with client yesterday` into the text box, confirm a draft card appears with amount 45, expense, yesterday's date; click "Add to books" and confirm it appears in the transaction reader below.
2. Type `$500 every week since April`, confirm the draft shows `kind: recurring_rule` with frequency weekly and a start date; confirm it appears in the "Recurring rules" panel after confirming, and that backfilled transactions from April to today appear in the transaction reader.
3. Drag a photo of a receipt (or any image file) onto the drop zone; confirm a draft card appears (either AI-filled or a manual fallback with a note, depending on whether `PHANTOM_LIVE_PROVIDERS_ENABLED`/`PHANTOM_OPENROUTER_TRANSPORT_ENABLED` are on in the running server).
4. Pause and delete a recurring rule from the panel; confirm past transactions it created remain untouched.
5. Confirm the "Advanced: connect a bank or card" section is collapsed by default and the existing manual-entry form and CSV import still work exactly as before inside it.

- [ ] **Step 6: Commit**

```bash
git add app/js/workspaces.js
git commit -m "feat(accounting): add drop-zone/NL smart entry UI and recurring rules panel"
```

---

## Self-Review Notes

- **Spec coverage:** photo drop → confirm card (Task 7 Step 3-4) ✓; NL text → confirm card, single or recurring (Task 4, Task 7) ✓; auto-post-forever recurring rules with pause/edit/delete (Task 1, Task 7) ✓; demoted bank/card panel (Task 7 Step 3) ✓; non-expiring receipt storage (Task 3) ✓; AI gated on existing env flags with graceful degrade (Task 5, Task 6) ✓; deterministic text parsing needing no AI (Task 4) ✓.
- **Type consistency checked:** `direction` is `"income"|"expense"` everywhere (matches the pre-existing manual-entry form, not the spec's original `"in"/"out"` — corrected during planning). `frequency` values (`"weekly"|"biweekly"|"monthly"|"custom-days"`) and the `ExpenseTextDraft`/`ReceiptDraft` shapes are identical between the server tasks that produce them (4, 5) and the client task that consumes them (7).
- **Known risk flagged explicitly, not hidden:** Task 7 depends on `app/js/workspaces.js`'s current shape, which moved out of `main.js` mid-session due to concurrent edits from other workers on this shared repo. Step 1 of Task 7 requires re-grepping before editing rather than trusting this document's line-number references, since the file may shift again before that task executes.
