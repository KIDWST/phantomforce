import { createHash } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { getPrintRunSettings, importPrintRun, setPrintCollectorStatus, type PrintCollectorStatus } from "./print-runs.js";

const MAX_BYTES = 128 * 1024 * 1024;
const COVERAGE = "Bambu Studio send packages only. Printer submission and completion are not connected; SD, cloud and printer reprints may be missed.";
type CollectorOptions = {
  roots?: string[]; enabled?: boolean; intervalMs?: number; settleMs?: number;
  log?: { warn: (...args: any[]) => void };
};
type Seen = { signature: string; since: number; captured?: boolean; attempts: number; reason?: "unsupported" | "read-failed" };

/** A ZIP directory presence check, never decompression or execution of G-code. */
export function hasBambuGcode(bytes: Uint8Array): boolean {
  if (bytes.length < 22 || bytes.length > MAX_BYTES) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) { end = offset; break; }
  }
  if (end < 0) return false;
  const count = view.getUint16(end + 10, true), start = view.getUint32(end + 16, true), size = view.getUint32(end + 12, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count || count > 10000 || start + size > end) return false;
  let offset = start, found = false;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > start + size || view.getUint32(offset, true) !== 0x02014b50) return false;
    const length = view.getUint16(offset + 28, true), next = offset + 46 + length + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    if (next > start + size) return false;
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + length));
    if (/^Metadata\/plate_\d+\.gcode$/i.test(name) && !(view.getUint16(offset + 8, true) & 1)) found = true;
    offset = next;
  }
  return found;
}

export function defaultBambuRoots() {
  const roots: string[] = [];
  if (process.env.LOCALAPPDATA) roots.push(join(process.env.LOCALAPPDATA, "Temp", "bamboo_model"));
  if (process.env.APPDATA) roots.push(join(process.env.APPDATA, "BambuStudio", "tmp", "bamboo_model"));
  return roots;
}

export async function bambuCaptureEnabled() {
  if (process.env.PHANTOMFORCE_BAMBU_CAPTURE === "0") return false;
  if (process.env.PHANTOMFORCE_BAMBU_CAPTURE === "1") return true;
  if (!process.env.LOCALAPPDATA) return false;
  try {
    // This explicit owner opt-in contains no printer credentials or network configuration.
    const raw = await readFile(join(process.env.LOCALAPPDATA, "PhantomForce", "bambu-capture.json"), "utf8");
    if (raw.length > 4096) return false;
    const value = JSON.parse(raw);
    return value.schemaVersion === 1 && value.enabled === true && value.tenantId === "occasionally-odd";
  } catch { return false; }
}

function inside(root: string, target: string) {
  const path = relative(root, target);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

/** Runs inside the existing API process. It never launches Bambu or controls a printer. */
export async function startBambuCollector(options: CollectorOptions = {}) {
  const enabled = options.enabled ?? await bambuCaptureEnabled();
  const roots = (options.roots || defaultBambuRoots()).map(root => resolve(root));
  const watchers = new Map<string, FSWatcher>(), seen = new Map<string, Seen>(), directoryOffsets = new Map<string, number>();
  const settleMs = options.settleMs ?? 1800;
  let stopped = false, running: Promise<void> | null = null, queued: ReturnType<typeof setTimeout> | undefined;
  let discovered = 0, lastCaptureAt: string | null = null, rootCursor = 0;
  const status = (state: PrintCollectorStatus["state"], extra: Partial<PrintCollectorStatus> = {}) => setPrintCollectorStatus({ state, enabled, connected: state === "watching", source: "Bambu Studio local send packages", coverage: COVERAGE, lastCaptureAt, discovered, ...extra });
  if (!enabled) {
    status("disconnected");
    return { scanNow: async () => {}, stop: async () => { stopped = true; } };
  }

  async function candidates(root: string, budget: { entries: number; directories: number; readErrors: number }, directory = root, depth = 0): Promise<string[]> {
    if (depth > 5 || budget.directories >= 256 || budget.entries >= 4096) return [];
    budget.directories++;
    const output: string[] = [];
    const entries = await readdir(directory, { withFileTypes: true });
    const start = (directoryOffsets.get(directory) || 0) % Math.max(1, entries.length);
    for (let offset = 0; offset < entries.length; offset++) {
      if (budget.directories >= 256 || budget.entries >= 4096) break;
      const index = (start + offset) % entries.length, entry = entries[index];
      directoryOffsets.set(directory, (index + 1) % entries.length); budget.entries++;
      if (entry.isSymbolicLink()) continue;
      const file = join(directory, entry.name);
      if (entry.isDirectory()) {
        try { output.push(...await candidates(root, budget, file, depth + 1)); }
        catch (error) {
          const code = (error as NodeJS.ErrnoException).code || "";
          if (["EACCES", "EPERM"].includes(code)) budget.readErrors++;
          else if (!["ENOENT", "ENOTDIR"].includes(code)) throw error;
        }
      }
      else if (entry.isFile() && basename(directory).toLowerCase() === "metadata" && /^\.\d+\.\d+\.3mf$/i.test(entry.name)) output.push(file);
      if (output.length >= 500) break;
    }
    return output.slice(0, 500);
  }

  function schedule() {
    if (stopped || queued) return;
    queued = setTimeout(() => { queued = undefined; void scanNow(); }, settleMs);
    queued.unref();
  }

  async function scan() {
    if (stopped) return;
    if ((await getPrintRunSettings()).paused) { status("paused", { lastScanAt: new Date().toISOString() }); return; }
    let available = 0, failed = false, unsupported = 0;
    const budget = { entries: 0, directories: 0, readErrors: 0 };
    const orderedRoots = [...roots.slice(rootCursor), ...roots.slice(0, rootCursor)];
    rootCursor = (rootCursor + 1) % Math.max(1, roots.length);
    for (const configuredRoot of orderedRoots) {
      if (stopped) break;
      let root: string;
      try {
        if ((await lstat(configuredRoot)).isSymbolicLink()) continue;
        root = await realpath(configuredRoot);
        available++;
      } catch { continue; }
      if (!watchers.has(root)) {
        try {
          const watcher = watch(root, { recursive: true }, schedule);
          watcher.on("error", () => { watcher.close(); watchers.delete(root); });
          watcher.unref(); watchers.set(root, watcher);
        } catch { /* The bounded reconciliation scan also works without filesystem events. */ }
      }
      let files: string[];
      try { files = await candidates(root, budget); }
      catch { failed = true; continue; }
      discovered = Math.max(discovered, files.length);
      for (const file of files) {
        if (stopped) break;
        try {
          const resolved = await realpath(file);
          if (!inside(root, resolved)) continue;
          const info = await lstat(file);
          if (!info.isFile() || info.isSymbolicLink() || info.size < 22 || info.size > MAX_BYTES) { unsupported++; continue; }
          const signature = `${info.size}:${info.mtimeMs}:${info.birthtimeMs}`;
          let item = seen.get(file);
          if (!item || item.signature !== signature) { item = { signature, since: Date.now(), attempts: 0 }; seen.set(file, item); schedule(); continue; }
          if (item.captured || Date.now() - item.since < settleMs) continue;
          if (item.attempts >= 5) {
            if (Date.now() - item.since < 5 * 60 * 1000) { if (item.reason === "unsupported") unsupported++; else failed = true; continue; }
            item.attempts = 0; item.since = Date.now(); item.reason = undefined;
          }
          // Avoid parsing the entire durable journal for every already-captured file on every pass.
          if ((await getPrintRunSettings()).paused) break;
          // Recheck path containment immediately before opening; only narrow generated artifacts are candidates.
          if (!inside(root, await realpath(file))) continue;
          const bytes = await readFile(file);
          if (!hasBambuGcode(bytes)) { item.attempts++; item.reason = "unsupported"; unsupported++; continue; }
          const after = await lstat(file);
          if (after.size !== info.size || after.mtimeMs !== info.mtimeMs) { seen.delete(file); schedule(); continue; }
          const match = basename(file).match(/^\.(\d+)\.(\d+)\.3mf$/i)!;
          const companion = join(dirname(file), `.${match[1]}.${Number(match[2]) + 1}_config.3mf`);
          let companionConfigPath: string | undefined;
          try { const companionInfo = await lstat(companion); if (companionInfo.isFile() && !companionInfo.isSymbolicLink() && companionInfo.size <= MAX_BYTES && inside(root, await realpath(companion))) companionConfigPath = companion; } catch { /* Metadata in the main package is normally sufficient. */ }
          const sourceEventId = createHash("sha256").update(`${resolved}\0${signature}`).digest("hex");
          await importPrintRun({ filePath: file, sourceEventId, observedAt: info.mtime.toISOString(), evidence: "prepared", companionConfigPath });
          item.captured = true;
          lastCaptureAt = new Date().toISOString();
        } catch {
          const item = seen.get(file); if (item) { item.attempts++; item.reason = "read-failed"; }
          failed = true;
          options.log?.warn("Bambu capture could not read a generated package; it will retry without changing the source.");
        }
      }
    }
    if (seen.size > 2000) for (const key of seen.keys()) { seen.delete(key); if (seen.size <= 1500) break; }
    if (directoryOffsets.size > 2000) directoryOffsets.clear();
    const paused = (await getPrintRunSettings()).paused;
    status(paused ? "paused" : available ? "watching" : "missing-source", { lastScanAt: new Date().toISOString(), unsupported, scanLimited: budget.entries >= 4096 || budget.directories >= 256, error: failed || budget.readErrors ? "Some packages are still being written or could not be read. Capture will retry." : undefined });
  }

  async function scanNow() {
    if (stopped) return;
    if (running) return running;
    running = scan().catch(() => status("error", { error: "Bambu capture is unavailable. Existing archived packages remain available." })).finally(() => { running = null; });
    return running;
  }
  const timer = setInterval(() => { void scanNow(); }, options.intervalMs ?? 15000);
  timer.unref();
  await scanNow();
  return {
    scanNow,
    async stop() { stopped = true; clearInterval(timer); if (queued) clearTimeout(queued); await running; for (const watcher of watchers.values()) watcher.close(); watchers.clear(); status("stopped"); },
  };
}
