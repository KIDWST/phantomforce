import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { assertPrintTenant } from "./print-runs.js";
import { businessError } from "./business-scope.js";

export function privatePrinterAddress(host: string) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false;
  const octets = host.split(".").map(Number);
  if (octets.some(value => value < 0 || value > 255) || octets.some((value, index) => String(value) !== host.split(".")[index])) return false;
  return octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168);
}
const printerId = z.enum(["p2s", "p1s"]);
const pairing = z.object({ id: printerId, label: z.string().trim().min(1).max(120), model: z.enum(["P2S", "P1S"]),
  host: z.string().refine(privatePrinterAddress), serial: z.string().trim().min(6).max(40).regex(/^[A-Za-z0-9]+$/),
  accessCode: z.string().trim().regex(/^[A-Za-z0-9]{8}$/), expectedRevision: z.number().int().nonnegative() }).strict()
  .refine(value => value.id.toUpperCase() === value.model);
const encrypted = z.object({ iv: z.string().min(16).max(32), tag: z.string().min(20).max(32), ciphertext: z.string().min(1).max(4096) }).strict();
const record = z.object({ id: printerId, label: z.string().min(1).max(120), model: z.enum(["P2S", "P1S"]), updatedAt: z.string().datetime(), value: encrypted }).strict();
const schema = z.object({ schemaVersion: z.literal(1), tenantId: z.literal("occasionally-odd"), revision: z.number().int().nonnegative(), connections: z.array(record).max(2) }).strict();
type Document = z.infer<typeof schema>;
export type SavedBambuConnection = Omit<z.infer<typeof pairing>, "expectedRevision">;
type Options = { root?: string; env?: Record<string, string | undefined> };
const defaultRoot = process.env.LOCALAPPDATA ? resolve(process.env.LOCALAPPDATA, "PhantomForce/print-runs") : resolve(dirname(fileURLToPath(import.meta.url)), "../../.local/print-runs");
const locks = new Map<string, Promise<unknown>>();
function fail(message: string, status = 400): never { throw businessError("BAMBU_CONNECTION_INVALID", message, status); }
function key(options: Options) {
  const env = options.env || process.env;
  const secret = env.PHANTOMFORCE_PRINTER_CREDENTIALS_SECRET || env.PHANTOMFORCE_SESSION_SECRET;
  if (!secret || secret.length < 32) fail("Printer credential encryption is unavailable. Configure the server encryption secret before pairing.", 503);
  return createHash("sha256").update("phantomforce:bambu:occasionally-odd\0").update(secret).digest();
}
function path(options: Options) { return resolve(options.root || process.env.PHANTOMFORCE_PRINT_RUNS_ROOT || process.env.PHANTOMFORCE_PRINT_RUNS_DIR || defaultRoot, "bambu-connections.json"); }
async function read(options: Options): Promise<Document> {
  try {
    if ((await stat(path(options))).size > 32 * 1024) fail("Printer connections require administrator review.", 409);
    const checked = schema.safeParse(JSON.parse(await readFile(path(options), "utf8")));
    if (!checked.success || new Set(checked.data.connections.map(row => row.id)).size !== checked.data.connections.length) fail("Printer connections require administrator review.", 409);
    return checked.data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 1, tenantId: "occasionally-odd", revision: 0, connections: [] };
    if (error instanceof SyntaxError) fail("Printer connections require administrator review.", 409);
    throw error;
  }
}
function encrypt(value: SavedBambuConnection, options: Options) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(options), iv);
  cipher.setAAD(Buffer.from(`occasionally-odd:${value.id}`));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}
function decrypt(row: Document["connections"][number], options: Options): SavedBambuConnection {
  try {
    const cipher = createDecipheriv("aes-256-gcm", key(options), Buffer.from(row.value.iv, "base64"));
    cipher.setAAD(Buffer.from(`occasionally-odd:${row.id}`)); cipher.setAuthTag(Buffer.from(row.value.tag, "base64"));
    const value = JSON.parse(Buffer.concat([cipher.update(Buffer.from(row.value.ciphertext, "base64")), cipher.final()]).toString("utf8"));
    const checked = pairing.safeParse({ ...value, expectedRevision: 0 });
    if (!checked.success || checked.data.id !== row.id || checked.data.model !== row.model || checked.data.label !== row.label) fail("Saved printer connection could not be verified. Pair it again.", 409);
    const { expectedRevision, ...connection } = checked.data; return connection;
  } catch { return fail("Saved printer connection could not be unlocked. Pair it again.", 409); }
}
async function mutate<T>(options: Options, expectedRevision: number, operation: (document: Document) => T) {
  const target = path(options), previous = locks.get(target) || Promise.resolve();
  const current = previous.catch(() => undefined).then(async () => {
    const document = await read(options);
    if (document.revision !== expectedRevision) fail("Printer settings changed. Refresh before saving again.", 409);
    const result = operation(document); document.revision++;
    await mkdir(dirname(target), { recursive: true }); const temporary = target + "." + randomUUID() + ".tmp";
    try { await writeFile(temporary, JSON.stringify(schema.parse(document), null, 2) + "\n", { mode: 0o600 }); await rename(temporary, target); }
    finally { await unlink(temporary).catch(() => undefined); }
    return result;
  });
  locks.set(target, current); try { return await current; } finally { if (locks.get(target) === current) locks.delete(target); }
}

/** Trusted transport only. No HTTP handler returns access codes or encrypted documents. */
export async function getSavedBambuConnections(options: Options = {}): Promise<SavedBambuConnection[]> {
  return (await read(options)).connections.map(row => decrypt(row, options));
}
export async function getBambuConnectionSummary(tenantId: string, options: Options = {}) {
  assertPrintTenant(tenantId); const document = await read(options); let encryptionReady = false;
  try { key(options); encryptionReady = true; } catch { /* Explicit setup state, no environment or credential details. */ }
  return { revision: document.revision, encryptionReady, connections: document.connections.map(({ id, label, model, updatedAt }) => ({ id, label, model, updatedAt, configured: true })),
    security: "Access codes are encrypted on this server and never returned. The connector subscribes to status only." };
}
export async function saveBambuConnection(tenantId: string, input: unknown, options: Options = {}) {
  assertPrintTenant(tenantId); const checked = pairing.safeParse(input);
  if (!checked.success) fail("Enter the printer's private IPv4 address, serial and access code. Choose the matching P2S or P1S slot.");
  const { expectedRevision, ...connection } = checked.data, value = encrypt(connection, options);
  await mutate(options, expectedRevision, document => {
    if (document.connections.some(row => row.id !== connection.id && decrypt(row, options).serial === connection.serial)) fail("This physical printer is already paired in the other slot. Keep P2S and P1S identities separate.", 409);
    const next = { id: connection.id, label: connection.label, model: connection.model, updatedAt: new Date().toISOString(), value };
    const index = document.connections.findIndex(row => row.id === connection.id); if (index < 0) document.connections.push(next); else document.connections[index] = next;
  });
  return getBambuConnectionSummary(tenantId, options);
}
export async function removeBambuConnection(tenantId: string, id: string, expectedRevision: number, options: Options = {}) {
  assertPrintTenant(tenantId); if (!printerId.safeParse(id).success || !Number.isInteger(expectedRevision) || expectedRevision < 0) fail("Choose a valid printer connection.");
  await mutate(options, expectedRevision, document => { document.connections = document.connections.filter(row => row.id !== id); });
  return getBambuConnectionSummary(tenantId, options);
}
