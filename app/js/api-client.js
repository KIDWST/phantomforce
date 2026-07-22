import { session } from "./store.js?v=phantom-live-20260721-4";

export function authHeaders(extra = {}) {
  const token = session.token();
  return { ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}
