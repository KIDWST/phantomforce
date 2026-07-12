/* Provider-neutral DNS adapter boundary.
   The product never hardcodes a registrar or proxy vendor: everything above
   this file talks to the DnsAdapter interface. The one adapter shipped today
   is the system resolver — it VERIFIES domains with real DNS lookups
   (TXT ownership token + A/CNAME presence) and probes SSL with a real HTTPS
   request. It cannot and will not change live DNS (canWriteDns: false);
   write-capable registrar adapters plug in here later, and live changes stay
   approval-gated regardless of adapter. */

import { promises as dns } from "node:dns";
import { request as httpsRequest } from "node:https";

export type DomainCheckState =
  | "verification_required"
  | "dns_records_pending"
  | "verified"
  | "misconfigured"
  | "failed";

export type SslState = "unknown" | "active" | "unreachable";

export type DomainCheckResult = {
  state: DomainCheckState;
  detail: string;
  txtFound: boolean;
  addressFound: boolean;
  sslState: SslState;
  checkedAt: string;
};

export type DnsAdapter = {
  id: string;
  label: string;
  canWriteDns: false;
  checkDomain: (domain: string, expectedToken: string) => Promise<DomainCheckResult>;
};

export const VERIFICATION_RECORD_PREFIX = "_phantomforce-verify";

function normalizeDomain(domain: string) {
  return domain.trim().toLowerCase().replace(/\.$/, "");
}

export function isPlausibleDomain(domain: string) {
  const normalized = normalizeDomain(domain);
  return /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(normalized);
}

async function probeSsl(domain: string): Promise<SslState> {
  return new Promise((resolvePromise) => {
    const req = httpsRequest(
      { host: domain, method: "HEAD", path: "/", timeout: 4000, rejectUnauthorized: true },
      () => {
        resolvePromise("active");
        req.destroy();
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolvePromise("unreachable");
    });
    req.on("error", () => resolvePromise("unreachable"));
    req.end();
  });
}

export const systemResolverAdapter: DnsAdapter = {
  id: "system-resolver",
  label: "System DNS resolver (verification + probes only; never writes DNS)",
  canWriteDns: false,
  async checkDomain(domainRaw, expectedToken) {
    const domain = normalizeDomain(domainRaw);
    const checkedAt = new Date().toISOString();

    let txtFound = false;
    let txtError: string | null = null;
    try {
      const records = await dns.resolveTxt(`${VERIFICATION_RECORD_PREFIX}.${domain}`);
      txtFound = records.some((chunks) => chunks.join("").trim() === expectedToken);
      if (!txtFound && records.length) txtError = "verification TXT record exists but does not match the expected token";
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOTFOUND" && code !== "ENODATA") txtError = `TXT lookup failed (${code ?? "unknown"})`;
    }

    let addressFound = false;
    try {
      const a = await dns.resolve4(domain).catch(() => [] as string[]);
      const cname = await dns.resolveCname(domain).catch(() => [] as string[]);
      addressFound = a.length > 0 || cname.length > 0;
    } catch { /* fall through — addressFound stays false */ }

    const sslState = addressFound ? await probeSsl(domain) : "unknown";

    if (txtError && !txtFound) {
      return { state: "misconfigured", detail: txtError, txtFound, addressFound, sslState, checkedAt };
    }
    if (txtFound && addressFound) {
      return { state: "verified", detail: "Ownership token verified and the domain resolves.", txtFound, addressFound, sslState, checkedAt };
    }
    if (txtFound && !addressFound) {
      return { state: "dns_records_pending", detail: "Ownership verified, but the domain does not resolve to any address yet.", txtFound, addressFound, sslState, checkedAt };
    }
    return {
      state: "verification_required",
      detail: `Add a TXT record at ${VERIFICATION_RECORD_PREFIX}.${domain} with the verification token.`,
      txtFound,
      addressFound,
      sslState,
      checkedAt,
    };
  },
};

const adapters = new Map<string, DnsAdapter>([[systemResolverAdapter.id, systemResolverAdapter]]);

export function getDnsAdapter(id = systemResolverAdapter.id): DnsAdapter {
  return adapters.get(id) ?? systemResolverAdapter;
}

export function listDnsAdapters() {
  return [...adapters.values()].map((adapter) => ({ id: adapter.id, label: adapter.label, canWriteDns: adapter.canWriteDns }));
}
