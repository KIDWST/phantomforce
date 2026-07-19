import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { HermesLedgerRecord } from "./types.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");

export const DEFAULT_HERMES_LEDGER_PATH = resolve(repoRoot, ".phantom", "hermes-ledger.jsonl");

export function resolveHermesLedgerPath(pathFromEnv = process.env.PHANTOM_HERMES_LEDGER_PATH) {
  return pathFromEnv?.trim() ? resolve(pathFromEnv) : DEFAULT_HERMES_LEDGER_PATH;
}

export async function appendHermesLedgerRecord(
  record: HermesLedgerRecord,
  options: { ledgerPath?: string } = {},
) {
  const ledgerPath = options.ledgerPath ?? resolveHermesLedgerPath();
  // Redact at rest, not just on read: this ledger is a proof/audit log, not a
  // place callers should rely on to reconstruct exact original user text, so
  // there is no legitimate reason for raw emails/SSNs/keys/cards to ever sit
  // in the file on disk. Every caller gets this for free — it does not
  // depend on the caller remembering to redact its own summary fields.
  const redactedRecord = redactHermesLedgerRecord(record);
  await mkdir(dirname(ledgerPath), { recursive: true });
  await appendFile(ledgerPath, `${JSON.stringify(redactedRecord)}\n`, "utf8");
  return { ledgerPath, record: redactedRecord };
}

export async function readHermesLedgerRecords(
  options: { ledgerPath?: string; limit?: number } = {},
): Promise<HermesLedgerRecord[]> {
  const ledgerPath = options.ledgerPath ?? resolveHermesLedgerPath();
  const limit = options.limit ?? 50;

  try {
    const raw = await readFile(ledgerPath, "utf8");
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-limit)
      .map((line) => JSON.parse(line) as HermesLedgerRecord);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function luhnCheck(digits: string): boolean {
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = Number(digits[i]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

function redactCardNumbers(value: string): string {
  // Only redact digit runs (allowing spaces/dashes) that pass Luhn, so
  // ordinary order numbers, invoice IDs, and phone-adjacent digit strings
  // are not destroyed by a blind length match.
  return value.replace(/\b(?:\d[ -]?){12,18}\d\b/g, (match) => {
    const digits = match.replace(/[ -]/g, "");
    if (digits.length < 13 || digits.length > 19) return match;
    return luhnCheck(digits) ? "[redacted-card]" : match;
  });
}

// Known API key / token prefixes worth catching by shape even without a
// labeled "key=" / "token:" context nearby.
const KNOWN_SECRET_PREFIX_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/g, // OpenAI-style
  /\bsk-ant-[A-Za-z0-9_-]{8,}\b/g, // Anthropic-style
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, // GitHub tokens (ghp_/gho_/ghu_/ghs_/ghr_)
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, // Slack tokens
  /\bAIza[0-9A-Za-z_-]{30,}\b/g, // Google API keys
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT-shaped tokens
  /-----BEGIN[ A-Z]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z]*PRIVATE KEY-----/g, // PEM private key blocks
];

const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/g;
const PHONE_PATTERN = /(?<!\d)(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?!\d)/g;
const IPV4_PATTERN = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;

/** Secrets/credentials only — keys, tokens, passwords, card numbers. Safe to
 *  apply to fields whose whole purpose is to carry a real contact identifier
 *  (a CRM `contact` field, an email/phone column) because it never touches
 *  emails, phone numbers, SSNs, or IPs. This is the long-standing contract
 *  several modules (ops-workflow, approval queue/transitions) depend on —
 *  do not broaden its scope here; add new PII categories to
 *  redactPersonalDataText below instead. */
export function redactSensitiveText(value: string) {
  let result = value;

  for (const pattern of KNOWN_SECRET_PREFIX_PATTERNS) {
    result = result.replace(pattern, "[redacted-key]");
  }

  result = result
    .replace(/\bBearer\s+[A-Za-z0-9._-]{8,}\b/gi, "Bearer [redacted-token]")
    .replace(
      /\b([A-Z0-9_]*(?:API[_-]?KEY|PASSWORD|SECRET|TOKEN|AUTHORIZATION)[A-Z0-9_]*)\s*[:=]\s*("[^"]+"|'[^']+'|[^\s,;]+)/gi,
      "$1=[redacted]",
    )
    .replace(
      /\b(api[_ -]?key|password|secret|token|authorization)\s*[:=]\s*("[^"]+"|'[^']+'|[^\s,;]+)/gi,
      "$1=[redacted]",
    );

  return redactCardNumbers(result);
}

/** Secrets AND personal-data categories (email, phone, SSN, IPv4) on top of
 *  redactSensitiveText. Used for the Hermes ledger (a proof/audit trail that
 *  has no legitimate reason to hold a client's raw email/SSN at rest) and
 *  the prompt-injection guard's redacted_input — NOT for structured fields
 *  (CRM contact info, etc.) that legitimately need to retain a real
 *  identifier to function. */
export function redactPersonalDataText(value: string) {
  return redactSensitiveText(value)
    .replace(SSN_PATTERN, "[redacted-ssn]")
    .replace(EMAIL_PATTERN, "[redacted-email]")
    .replace(PHONE_PATTERN, "[redacted-phone]")
    .replace(IPV4_PATTERN, "[redacted-ip]");
}

function redactValue<T>(value: T): T {
  if (typeof value === "string") {
    return redactPersonalDataText(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item)) as T;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactValue(item)]),
    ) as T;
  }

  return value;
}

export function redactHermesLedgerRecord(record: HermesLedgerRecord) {
  return redactValue(record);
}

export async function readRedactedHermesLedgerRecords(options: { ledgerPath?: string; limit?: number } = {}) {
  const records = await readHermesLedgerRecords(options);
  return records.map((record) => redactHermesLedgerRecord(record));
}

export async function getHermesLedgerStatus(options: { ledgerPath?: string } = {}) {
  const ledgerPath = options.ledgerPath ?? resolveHermesLedgerPath();

  try {
    const fileStat = await stat(ledgerPath);
    return {
      enabled: true,
      exists: true,
      ledgerPath,
      bytes: fileStat.size,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        enabled: true,
        exists: false,
        ledgerPath,
        bytes: 0,
      };
    }
    throw error;
  }
}
