/*
 * subscription-store.ts — the server-side source of truth for who has paid.
 *
 * This is the ONLY place "is this account paid?" is decided, and it can only be
 * written by trusted server code (the admin owner-grant endpoint or a verified
 * payment webhook). The browser can never set it. The paywall reads this to
 * decide write entitlement, so the whole gate hinges on this being untrusted-
 * input-proof.
 *
 * JSON-backed (atomic write + .bak) until Postgres, mirroring access-storage.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const defaultDataDir = join(moduleDir, "../../data");
const dataDir = process.env.PHANTOMFORCE_ACCESS_DATA_DIR || defaultDataDir;
const storePath = join(dataDir, "subscriptions.json");

export type SubscriptionRecord = {
  /** lowercased account identity (the gateway-forwarded user). */
  email: string;
  active: boolean;
  tier: "pro";
  /** how it was set: "owner-grant" | "webhook:<provider>" — never client-supplied. */
  source: string;
  updatedAt: string;
  note?: string;
};

type Store = Record<string, SubscriptionRecord>;

let store: Store = {};
let loaded = false;

const key = (email: string) => (email || "").trim().toLowerCase();

function ensureDir() {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
}

function load(): Store {
  if (loaded) return store;
  try {
    if (existsSync(storePath)) store = JSON.parse(readFileSync(storePath, "utf8")) as Store;
  } catch {
    store = {}; // corrupt/unreadable -> fail safe to "nobody is paid"
  }
  loaded = true;
  return store;
}

function persist() {
  ensureDir();
  if (existsSync(storePath)) {
    try {
      copyFileSync(storePath, `${storePath}.bak`);
    } catch {
      /* best-effort backup */
    }
  }
  const tempPath = `${storePath}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  renameSync(tempPath, storePath);
}

export function getSubscription(email: string): SubscriptionRecord | undefined {
  return load()[key(email)];
}

/** The single question the paywall asks. Fail safe: unknown accounts are not paid. */
export function isSubscriptionActive(email: string | undefined | null): boolean {
  if (!email) return false;
  return getSubscription(email)?.active === true;
}

export function setSubscription(input: {
  email: string;
  active: boolean;
  source: string;
  note?: string;
}): SubscriptionRecord {
  load();
  const k = key(input.email);
  if (!k) throw new Error("A non-empty account email is required to set a subscription.");

  const record: SubscriptionRecord = {
    email: k,
    active: input.active,
    tier: "pro",
    source: input.source,
    updatedAt: new Date().toISOString(),
    note: input.note,
  };
  store[k] = record;
  persist();
  return record;
}

export function listSubscriptions(): SubscriptionRecord[] {
  return Object.values(load());
}

/** Test-only reset so unit tests don't leak state. */
export function __resetSubscriptionStoreForTests() {
  store = {};
  loaded = true;
}
