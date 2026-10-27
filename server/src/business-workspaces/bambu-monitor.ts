import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import type { PeerCertificate } from "node:tls";
import { bambuObservation, normalizeBambuStatus, type BambuJobStatus, type BambuObservation } from "./bambu-status.js";

export type BambuConnection = { id: string; label: string; model: string; host: string; serial: string; accessCode: string };
type Client = { on(event: string, handler: (...args: any[]) => void): Client; subscribe(topic: string, options: { qos: 0 }, callback: (error?: Error | null) => void): unknown; end(force?: boolean, options?: object, callback?: () => void): unknown };
type Connector = (url: string, options: Record<string, unknown>) => Client;
export type BambuMonitorPrinter = {
  id: string; bindingId: string; label: string; model: string; connected: boolean;
  state: "connecting" | "waiting-status" | "monitoring" | "disconnected" | "error";
  lastReceivedAt: string | null; lastError: string | null; job: BambuJobStatus | null;
};
type Options = { getConnections(): Promise<BambuConnection[]>; onObservation(observation: BambuObservation): Promise<unknown> | unknown; connect?: Connector; now?: () => Date; caPem?: string; pollMs?: number };

export function isPrivateBambuHost(host: string) {
  if (isIP(host) !== 4) return false;
  const parts = host.split(".").map(Number);
  return parts[0] === 10 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 || parts[0] === 192 && parts[1] === 168;
}
export function checkBambuServerIdentity(serial: string, certificate: PeerCertificate): Error | undefined {
  // Node has already validated the certificate chain against Bambu's bundled public CA.
  // The printer's leaf identifies its serial rather than its current DHCP address.
  // Exact matching avoids accepting another Bambu device or a wildcard cloud certificate.
  const commonName = certificate.subject?.CN;
  if (typeof commonName === "string" && [serial, `${serial}.bambulab.com`].includes(commonName)) return undefined;
  return new Error("The printer certificate does not match the configured serial number.");
}
function validConnection(value: BambuConnection) {
  return /^[A-Za-z0-9_.-]{1,180}$/.test(value.id) && isPrivateBambuHost(value.host) && /^[A-Za-z0-9]{6,40}$/.test(value.serial)
    && typeof value.accessCode === "string" && /^[A-Za-z0-9]{8}$/.test(value.accessCode);
}
const CA_URL = new URL("../../resources/bambu-printer-ca.pem", import.meta.url);
// Official BambuStudio v02.08.02.61 resources/cert/printer.cer, normalized LF.
const CA_SHA256 = "168852cde67cd9c7648de5f95b46f7b950d1627966d2da6a968fd9ef9d034910";
async function loadCA() {
  const bytes = await readFile(CA_URL);
  if (createHash("sha256").update(bytes).digest("hex") !== CA_SHA256) throw new Error("The bundled public printer certificate authorities could not be verified.");
  return bytes.toString("utf8");
}

/** Subscribes only to a configured printer report topic. No request/publish/control function is used or exposed. */
export async function startBambuMonitor(options: Options) {
  const entries = new Map<string, { client: Client; fingerprint: string; status: BambuMonitorPrinter; delivered: Set<string>; serial: string }>();
  let closed = false, loading: Promise<void> | null = null, generation = 0, setupError: string | null = null;
  let connector = options.connect;
  const now = () => (options.now?.() || new Date()).toISOString();
  const ca = options.caPem ?? await loadCA();
  async function getConnector() { if (!connector) { const mqtt = await import("mqtt"); connector = mqtt.connect as unknown as Connector; } return connector; }
  function closeClient(client: Client) { return new Promise<void>(resolve => { let done = false; const finish = () => { if (!done) { done = true; clearTimeout(timer); resolve(); } }; const timer = setTimeout(finish, 2000); timer.unref(); try { client.end(true, {}, finish); } catch { finish(); } }); }
  async function reconcile() {
    const epoch = generation;
    const connections = await options.getConnections();
    if (closed || epoch !== generation) return;
    if (connections.length > 8) throw new Error("Too many configured printer monitors.");
    const desired = new Set(connections.map(value => value.id));
    for (const [id, entry] of entries) if (!desired.has(id)) { entries.delete(id); await closeClient(entry.client); }
    for (const connection of connections) {
      if (closed || epoch !== generation) break;
      if (!validConnection(connection)) { setupError = "A saved printer connection requires a private IPv4 address, serial and valid access code."; continue; }
      const fingerprint = createHash("sha256").update(JSON.stringify(connection)).digest("hex");
      const old = entries.get(connection.id);
      if (old?.fingerprint === fingerprint) continue;
      if (old) { entries.delete(connection.id); await closeClient(old.client); }
      const connect = await getConnector();
      if (closed || epoch !== generation) break;
      const client = connect(`mqtts://${connection.host}:8883`, {
        protocolVersion: 4, username: "bblp", password: connection.accessCode, clientId: `phantomforce-read-${randomBytes(8).toString("hex")}`,
        clean: true, reconnectPeriod: 15000, connectTimeout: 10000, keepalive: 30, resubscribe: false,
        rejectUnauthorized: true, ca, minVersion: "TLSv1.2", maxVersion: "TLSv1.2",
        checkServerIdentity: (_hostname: string, certificate: PeerCertificate) => checkBambuServerIdentity(connection.serial, certificate),
      });
      const bindingId = `${connection.id}:${createHash("sha256").update(connection.serial).digest("hex").slice(0, 16)}`;
      const entry = { client, fingerprint, serial: connection.serial, delivered: new Set<string>(), status: { id: connection.id, bindingId, label: connection.label.slice(0, 120), model: connection.model.slice(0, 40), connected: false,
        state: "connecting" as BambuMonitorPrinter["state"], lastReceivedAt: null, lastError: null, job: null } as BambuMonitorPrinter };
      entries.set(connection.id, entry);
      const active = () => !closed && entries.get(connection.id) === entry;
      client.on("connect", () => {
        if (!active()) return;
        entry.status.connected = true; entry.status.state = "waiting-status"; entry.status.lastError = null;
        client.subscribe(`device/${connection.serial}/report`, { qos: 0 }, error => { if (active() && error) { entry.status.state = "error"; entry.status.lastError = "The printer rejected its read-only status subscription."; } });
      });
      client.on("message", (topic: string, bytes: Uint8Array) => {
        if (!active() || topic !== `device/${connection.serial}/report`) return;
        try {
          const observedAt = now(), job = normalizeBambuStatus(bytes, entry.status.job, observedAt);
          if (!job) return;
          entry.status.job = job; entry.status.lastReceivedAt = observedAt; entry.status.state = "monitoring"; entry.status.lastError = null;
          const observation = bambuObservation(bindingId, job);
          if (observation && !entry.delivered.has(observation.eventId)) {
            // Persist first, then deduplicate. A failed store may retry on the next status delta.
            void Promise.resolve(options.onObservation(observation)).then(result => {
              const unmatched = result !== null && typeof result === "object" && ("matched" in result && result.matched === false || "recorded" in result && result.recorded === false);
              if (active() && !unmatched) { entry.delivered.add(observation.eventId); if (entry.delivered.size > 1000) entry.delivered.delete(entry.delivered.values().next().value!); }
            }).catch(() => { if (active()) entry.status.lastError = "A printer observation could not be saved. It will retry on the next report."; });
          }
        } catch { entry.status.lastError = "A printer report could not be verified. No print outcome was inferred."; }
      });
      client.on("error", () => { if (active()) { entry.status.connected = false; entry.status.state = "error"; entry.status.lastError = "Printer status connection failed. Check the LAN address, serial, access code and certificate trust."; } });
      client.on("close", () => { if (active()) { entry.status.connected = false; entry.status.state = "disconnected"; } });
      client.on("reconnect", () => { if (active()) { entry.status.connected = false; entry.status.state = "connecting"; } });
    }
  }
  async function reload() {
    if (closed) return;
    const previous = loading || Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
      if (closed) return;
      setupError = null;
      await reconcile().catch(() => { setupError = "Saved printer connections could not be loaded. Existing print archives are unaffected."; });
    }).finally(() => { if (loading === current) loading = null; });
    loading = current;
    return current;
  }
  await reload();
  const timer = setInterval(() => { void reload(); }, options.pollMs ?? 30000); timer.unref();
  return {
    reload,
    status() { return { source: "bambu-lan-mqtt", readOnly: true, configured: entries.size, connected: [...entries.values()].filter(entry => entry.status.connected).length,
      state: setupError ? "error" : entries.size ? "configured" : "pairing-required", error: setupError,
      printers: [...entries.values()].map(entry => ({ ...entry.status, job: entry.status.job ? { ...entry.status.job } : null })) }; },
    async stop() { closed = true; generation++; clearInterval(timer); await loading; const clients = [...entries.values()].map(entry => entry.client); entries.clear(); await Promise.all(clients.map(closeClient)); },
  };
}
