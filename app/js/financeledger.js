import { currentTenantId, friendlyBackendError, session } from "./store.js?v=phantom-live-20260723-56";

const authHeaders = (json = false) => {
  const token = session.token();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { "Content-Type": "application/json" } : {}) };
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...authHeaders(Boolean(options.body)), ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(friendlyBackendError(response.status, payload?.error, {
      authMessage: "Sign in to load the authoritative accounting ledger.",
    }));
  }
  return payload;
}

export function financeServerAvailable() {
  return Boolean(session.token());
}

export function financeTenantQuery() {
  return `tenant_id=${encodeURIComponent(currentTenantId())}`;
}

export async function loadFinanceLedger() {
  return api(`/api/finance/ledger?${financeTenantQuery()}`);
}

export async function createFinanceTransaction(transaction) {
  return api("/api/finance/transactions", {
    method: "POST",
    body: JSON.stringify({ tenant_id: currentTenantId(), transaction }),
  });
}

export async function importFinanceLedger({ idempotencyKey, sourceName, transactions }) {
  return api("/api/finance/import", {
    method: "POST",
    body: JSON.stringify({
      tenant_id: currentTenantId(),
      idempotency_key: idempotencyKey,
      source_name: sourceName,
      transactions,
    }),
  });
}

export async function reconcileFinanceLedgerTransaction(transactionId, status = "reconciled") {
  return api(`/api/finance/transactions/${encodeURIComponent(transactionId)}/reconcile`, {
    method: "POST",
    body: JSON.stringify({ tenant_id: currentTenantId(), status }),
  });
}

export async function voidFinanceLedgerTransaction(transactionId) {
  return api(`/api/finance/transactions/${encodeURIComponent(transactionId)}?${financeTenantQuery()}`, {
    method: "DELETE",
  });
}

export async function financeContentKey(text) {
  const bytes = new TextEncoder().encode(String(text || ""));
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  }
  let hash = 2166136261;
  bytes.forEach((value) => {
    hash ^= value;
    hash = Math.imul(hash, 16777619);
  });
  return `fallback-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
