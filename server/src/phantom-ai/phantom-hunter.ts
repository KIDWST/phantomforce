import { spawn } from "node:child_process";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { access, mkdir, readFile, rename, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

export const PHANTOM_HUNTER_VERSION = "1.1.0";
export const PHANTOM_HUNTER_POLICY_ID = "phantom-hunter-authorized-secret-discovery.v1";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, "../../..");
const DATA_ROOT = resolve(process.env.PHANTOM_HUNTER_DATA_DIR || join(REPO_ROOT, ".local", "phantomhunter"));
const MAX_ASSETS_PER_ORG = 500;
const MAX_SCANS_PER_ORG = 50;
const MAX_FINDINGS_PER_SCAN = 10_000;
const MAX_TOOL_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_REMOTE_BYTES = 8 * 1024 * 1024;
const MAX_REMOTE_DOCUMENTS = 18;
const DEFAULT_TOOL_TIMEOUT_MS = 5 * 60 * 1000;
const FINGERPRINT_KEY = Buffer.from(
  process.env.PHANTOM_HUNTER_FINGERPRINT_KEY
    || process.env.PHANTOMFORCE_SESSION_SECRET
    || randomBytes(32).toString("hex"),
  "utf8",
);

export type PhantomHunterAssetKind = "local_path" | "git_repository" | "web_app" | "api";
export type PhantomHunterEngineId = "betterleaks" | "trufflehog" | "keyhunter";
export type PhantomHunterVerificationStatus = "active" | "inactive" | "conflict" | "unknown" | "unverified";
export type PhantomHunterScanStatus = "queued" | "running" | "completed" | "partial" | "failed" | "cancelled";

export const PhantomHunterBulkIntakeSchema = z.object({
  tenant_id: z.string().trim().max(80).optional(),
  assets: z.array(z.object({
    label: z.string().trim().max(160).optional(),
    target: z.string().trim().min(1).max(4096),
    kind: z.enum(["auto", "local_path", "git_repository", "web_app", "api"]).optional().default("auto"),
  })).min(1).max(250),
});

export const PhantomHunterScanStartSchema = z.object({
  tenant_id: z.string().trim().max(80).optional(),
  asset_ids: z.array(z.string().uuid()).min(1).max(250),
  engines: z.array(z.enum(["betterleaks", "trufflehog", "keyhunter"]))
    .min(1).max(3).optional().default(["betterleaks", "trufflehog", "keyhunter"]),
  verify_active: z.boolean().optional().default(true),
  authorization_attested: z.literal(true),
  verification_confirmation: z.string().trim().max(80).optional(),
});

export type PhantomHunterAsset = {
  id: string;
  organization_id: string;
  label: string;
  kind: PhantomHunterAssetKind;
  target: string;
  target_display: string;
  readiness: "ready" | "missing" | "source_required";
  created_at: string;
  created_by: string;
  authorization_attested_at: string;
};

export type PhantomHunterFindingSource = {
  engine: PhantomHunterEngineId;
  asset_id: string;
  location: string;
  line: number | null;
  commit: string | null;
  source_url: string | null;
  detector: string;
};

export type PhantomHunterFinding = {
  id: string;
  organization_id: string;
  scan_id: string;
  provider: string;
  masked_secret: string;
  secret_fingerprint: string;
  verification_status: PhantomHunterVerificationStatus;
  verified_at: string | null;
  verification_engines: PhantomHunterEngineId[];
  detection_engines: PhantomHunterEngineId[];
  confidence: "verified_active" | "engine_conflict" | "corroborated" | "candidate";
  sources: PhantomHunterFindingSource[];
  remediation: string;
  raw_secret_stored: false;
};

export type PhantomHunterEngineRun = {
  engine: PhantomHunterEngineId;
  asset_id: string;
  status: "queued" | "running" | "completed" | "skipped" | "failed";
  candidates: number;
  verified_active: number;
  started_at: string | null;
  completed_at: string | null;
  note: string | null;
};

export type PhantomHunterScan = {
  id: string;
  organization_id: string;
  status: PhantomHunterScanStatus;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  created_by: string;
  authorization_attested_at: string;
  verification_confirmation_recorded: boolean;
  verify_active: boolean;
  engines_requested: PhantomHunterEngineId[];
  asset_ids: string[];
  progress: { completed_assets: number; total_assets: number; current_asset_id: string | null };
  engine_runs: PhantomHunterEngineRun[];
  findings: PhantomHunterFinding[];
  summary: {
    total_candidates: number;
    verified_active: number;
    inactive: number;
    conflicts: number;
    needs_review: number;
    providers: number;
    assets_scanned: number;
  };
  errors: Array<{ engine: PhantomHunterEngineId | "orchestrator"; asset_id: string | null; code: string }>;
  integrity_hash: string;
  raw_secrets_stored: false;
  cancellation_requested?: boolean;
};

type OrgState = { assets: PhantomHunterAsset[]; scans: PhantomHunterScan[] };
type Candidate = {
  secret: string;
  provider: string;
  detector: string;
  engine: PhantomHunterEngineId;
  verification: "active" | "inactive" | "unknown" | "unverified";
  verifiedAt: string | null;
  location: string;
  line: number | null;
  commit: string | null;
  sourceUrl: string | null;
};

type ToolStatus = {
  id: PhantomHunterEngineId;
  name: string;
  available: boolean;
  version: string | null;
  executable_configured: boolean;
  role: "broad_discovery" | "history_discovery" | "safe_provider_verification_bridge";
  path_exposed: false;
  error: string | null;
};

const stateCache = new Map<string, Promise<OrgState>>();
const saveQueues = new Map<string, Promise<void>>();
const activeChildren = new Map<string, Set<ReturnType<typeof spawn>>>();
let toolStatusCache: { expiresAt: number; tools: ToolStatus[] } | null = null;

function isoNow() {
  return new Date().toISOString();
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function integrityHash(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function orgKey(organizationId: string) {
  return createHash("sha256").update(organizationId).digest("hex").slice(0, 24);
}

function orgStatePath(organizationId: string) {
  return join(DATA_ROOT, orgKey(organizationId), "state.json");
}

function emptyState(): OrgState {
  return { assets: [], scans: [] };
}

async function loadOrgState(organizationId: string): Promise<OrgState> {
  const key = orgKey(organizationId);
  const cached = stateCache.get(key);
  if (cached) return cached;
  const pending = (async () => {
    try {
      const parsed = JSON.parse(await readFile(orgStatePath(organizationId), "utf8")) as Partial<OrgState>;
      const scans = Array.isArray(parsed.scans) ? parsed.scans.filter((scan) => scan.organization_id === organizationId) : [];
      for (const scan of scans) {
        scan.findings = Array.isArray(scan.findings)
          ? scan.findings.filter((finding) => finding.verification_status === "active")
          : [];
        scan.summary = {
          ...scan.summary,
          total_candidates: scan.findings.length,
          verified_active: scan.findings.length,
          inactive: 0,
          conflicts: 0,
          needs_review: 0,
          providers: new Set(scan.findings.map((finding) => finding.provider)).size,
        };
      }
      return {
        assets: Array.isArray(parsed.assets) ? parsed.assets.filter((asset) => asset.organization_id === organizationId) : [],
        scans,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return emptyState();
    }
  })();
  stateCache.set(key, pending);
  return pending;
}

async function persistOrgState(organizationId: string, state: OrgState) {
  const key = orgKey(organizationId);
  const previous = saveQueues.get(key) || Promise.resolve();
  const next = previous.then(async () => {
    const filePath = orgStatePath(organizationId);
    await mkdir(dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, filePath);
  });
  saveQueues.set(key, next.catch(() => undefined));
  await next;
}

function redactText(value: unknown) {
  return String(value ?? "")
    .replace(/\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9_-]{8,}\b/gi, "[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/gi, "[redacted]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[redacted]")
    .replace(/\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{12,}\b/gi, "[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, "Bearer [redacted]")
    .replace(/(?:token|secret|password|api[_-]?key)=([^&\s]+)/gi, "$1=[redacted]")
    .slice(0, 220);
}

function maskSecret(secret: string, provided?: unknown) {
  const redacted = String(provided ?? "").trim();
  if (redacted && redacted !== secret && !redacted.toLowerCase().includes(secret.toLowerCase())) {
    return redactText(redacted).slice(0, 80);
  }
  if (secret.length <= 8) return "••••••••";
  return `${secret.slice(0, Math.min(4, Math.floor(secret.length / 3)))}…${secret.slice(-4)}`;
}

function secretFingerprint(secret: string) {
  return createHmac("sha256", FINGERPRINT_KEY).update(secret).digest("hex");
}

function normalizedProvider(value: unknown, secret = "") {
  const source = String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const pairs: Array<[RegExp, string]> = [
    [/openai/, "openai"], [/anthropic|claude/, "anthropic"], [/google|gemini/, "google"],
    [/github/, "github"], [/gitlab/, "gitlab"], [/stripe/, "stripe"], [/aws|amazon_web_services/, "aws"],
    [/azure/, "azure"], [/sendgrid/, "sendgrid"], [/mailgun/, "mailgun"], [/slack/, "slack"],
    [/discord/, "discord"], [/telegram/, "telegram"], [/twilio/, "twilio"], [/huggingface/, "huggingface"],
    [/replicate/, "replicate"], [/cohere/, "cohere"], [/mistral/, "mistral"], [/together/, "together"],
    [/deepseek/, "deepseek"], [/groq/, "groq"], [/perplexity/, "perplexity"], [/fireworks/, "fireworks"],
    [/datadog/, "datadog"], [/newrelic/, "newrelic"], [/mapbox/, "mapbox"], [/firebase/, "firebase"],
    [/sentry/, "sentry"], [/supabase/, "supabase"], [/vercel/, "vercel"], [/npm/, "npm"], [/pypi/, "pypi"],
  ];
  for (const [pattern, provider] of pairs) if (pattern.test(source)) return provider;
  if (/^sk_(?:live|test)_/.test(secret)) return "stripe";
  if (/^sk-/.test(secret)) return "openai";
  if (/^(?:ghp|gho|ghu|ghs|github_pat)_/.test(secret)) return "github";
  if (/^AKIA/.test(secret)) return "aws";
  return source.replace(/^generic_/, "") || "unknown";
}

function keyHunterProvider(candidate: Candidate) {
  const provider = normalizedProvider(candidate.provider, candidate.secret);
  /* KeyHunter's Anthropic and Perplexity implementations call generation
     endpoints. They are deliberately excluded: PhantomHunter only promotes
     credentials through metadata-style verification that cannot create
     content or intentionally spend. Manual/unsupported verifiers are also
     excluded so they remain honest review candidates. */
  const mapping: Record<string, string> = {
    openai: "openai", google: "google", github: "github_token", gitlab: "gitlab",
    stripe: candidate.secret.startsWith("rk_") ? "stripe_restricted" : "stripe_live",
    sendgrid: "sendgrid", mailgun: "mailgun", slack: "slack_bot", discord: "discord", telegram: "telegram",
    huggingface: "huggingface", replicate: "replicate", cohere: "cohere", mistral: "mistral",
    together: "together", deepseek: "deepseek", groq: "groq", fireworks: "fireworks",
    datadog: "datadog", newrelic: "newrelic", mapbox: "mapbox",
  };
  return mapping[provider] || null;
}

function sanitizeLabel(value: string | undefined, fallback: string) {
  return (value || fallback).replace(/[<>\r\n\t]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) || "Untitled asset";
}

function hasEmbeddedCredential(url: URL) {
  if (url.username || url.password) return true;
  return [...url.searchParams.keys()].some((key) => /token|secret|password|passwd|api.?key|auth|signature/i.test(key));
}

function inferAssetKind(target: string): PhantomHunterAssetKind {
  if (isAbsolute(target) || /^[A-Za-z]:[\\/]/.test(target) || /^\\\\/.test(target)) return "local_path";
  if (/^https?:\/\//i.test(target)) {
    const url = new URL(target);
    if (/github\.com$|gitlab\.com$/i.test(url.hostname) || /\.git$/i.test(url.pathname)) return "git_repository";
    if (/openapi|swagger|\/api(?:\/|$)/i.test(url.pathname)) return "api";
    return "web_app";
  }
  throw new Error("Target must be an absolute local path or an HTTP(S) repository, app, or API URL.");
}

function normalizeUrlTarget(target: string) {
  const url = new URL(target);
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("Only HTTP(S) targets are accepted.");
  if (url.protocol === "http:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase())) {
    throw new Error("External app and repository targets must use HTTPS.");
  }
  if (hasEmbeddedCredential(url)) throw new Error("Put access credentials in a server connector, not in the target URL.");
  url.hash = "";
  return url.toString();
}

function blockedLocalTarget(target: string) {
  const full = resolve(target);
  const root = parse(full).root;
  const userRoot = resolve(homedir());
  const blocked = [root, userRoot, resolve(userRoot, ".ssh"), resolve(userRoot, ".aws"), resolve(userRoot, ".azure")];
  return blocked.some((entry) => full.localeCompare(entry, undefined, { sensitivity: "accent" }) === 0)
    || /[\\/](?:Windows|Program Files(?: \(x86\))?)[\\/]?$/i.test(full);
}

function targetDisplay(kind: PhantomHunterAssetKind, target: string) {
  if (kind === "local_path") return `${parse(target).root}…${basename(target)}`;
  try {
    const url = new URL(target);
    return `${url.hostname}${url.pathname}`.replace(/\/$/, "") || url.hostname;
  } catch {
    return "Configured target";
  }
}

async function normalizeAssetInput(input: z.infer<typeof PhantomHunterBulkIntakeSchema>["assets"][number]) {
  const requestedKind = input.kind || "auto";
  const kind = requestedKind === "auto" ? inferAssetKind(input.target) : requestedKind;
  let target = input.target.trim();
  let readiness: PhantomHunterAsset["readiness"] = "ready";
  if (kind === "local_path") {
    target = resolve(target);
    if (blockedLocalTarget(target)) throw new Error("Choose a specific repository or app folder, not a system or account root.");
    try { await access(target); } catch { readiness = "missing"; }
  } else {
    target = normalizeUrlTarget(target);
  }
  if ((kind === "web_app" || kind === "api") && !/^https?:\/\//i.test(target)) readiness = "source_required";
  return { kind, target, readiness, label: sanitizeLabel(input.label, targetDisplay(kind, target)) };
}

function publicAsset(asset: PhantomHunterAsset) {
  const { target: _target, ...safe } = asset;
  return safe;
}

function publicScan(scan: PhantomHunterScan) {
  const activeFindings = scan.findings.filter((finding) => finding.verification_status === "active");
  return {
    ...scan,
    findings: activeFindings,
    active_findings: activeFindings,
  };
}

export async function addPhantomHunterAssets(input: {
  organizationId: string;
  actorId: string;
  allowLocalPaths: boolean;
  assets: z.infer<typeof PhantomHunterBulkIntakeSchema>["assets"];
}) {
  const state = await loadOrgState(input.organizationId);
  const now = isoNow();
  const created: PhantomHunterAsset[] = [];
  const rejected: Array<{ index: number; error: string }> = [];
  for (const [index, assetInput] of input.assets.entries()) {
    try {
      const normalized = await normalizeAssetInput(assetInput);
      if (normalized.kind === "local_path" && !input.allowLocalPaths) {
        throw new Error("Local project paths are available only to the platform operator on the owner desktop. Use an authorized repository URL instead.");
      }
      const duplicate = state.assets.find((asset) => asset.kind === normalized.kind && asset.target === normalized.target);
      if (duplicate) {
        created.push(duplicate);
        continue;
      }
      if (state.assets.length >= MAX_ASSETS_PER_ORG) throw new Error(`Organization asset limit (${MAX_ASSETS_PER_ORG}) reached.`);
      const asset: PhantomHunterAsset = {
        id: randomUUID(), organization_id: input.organizationId, ...normalized,
        target_display: targetDisplay(normalized.kind, normalized.target),
        created_at: now, created_by: input.actorId, authorization_attested_at: now,
      };
      state.assets.unshift(asset);
      created.push(asset);
    } catch (error) {
      rejected.push({ index, error: redactText(error instanceof Error ? error.message : error) });
    }
  }
  await persistOrgState(input.organizationId, state);
  return { assets: created.map(publicAsset), rejected };
}

export async function listPhantomHunterAssets(organizationId: string) {
  return (await loadOrgState(organizationId)).assets.map(publicAsset);
}

type PhantomHunterWebRepositoryBinding = {
  target: string;
  label?: string;
  kind?: "local_path" | "git_repository";
};

function configuredWebRepository(organizationId: string, allowPlatformDefault: boolean): PhantomHunterWebRepositoryBinding | null {
  const raw = String(process.env.PHANTOM_HUNTER_WEB_REPOSITORIES_JSON || "").trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, string | PhantomHunterWebRepositoryBinding>;
      const value = parsed[organizationId] ?? parsed["*"];
      if (typeof value === "string" && value.trim()) return { target: value.trim() };
      if (value && typeof value === "object" && typeof value.target === "string" && value.target.trim()) {
        return { target: value.target.trim(), label: String(value.label || "").trim() || undefined, kind: value.kind };
      }
    } catch {
      return null;
    }
  }
  if (!allowPlatformDefault) return null;
  return { target: REPO_ROOT, label: basename(REPO_ROOT), kind: "local_path" };
}

export async function getPhantomHunterWebRepository(input: {
  organizationId: string;
  actorId: string;
  allowPlatformDefault: boolean;
}) {
  const binding = configuredWebRepository(input.organizationId, input.allowPlatformDefault);
  if (!binding) {
    return {
      connected: false as const,
      repository: null,
      connection_state: "repository_connection_required" as const,
      accepts_arbitrary_targets: false,
    };
  }
  const inferredKind = binding.kind || (isAbsolute(binding.target) ? "local_path" : "git_repository");
  const result = await addPhantomHunterAssets({
    organizationId: input.organizationId,
    actorId: input.actorId,
    allowLocalPaths: input.allowPlatformDefault,
    assets: [{ target: binding.target, label: binding.label, kind: inferredKind }],
  });
  const repository = result.assets[0] || null;
  return {
    connected: Boolean(repository),
    repository,
    connection_state: repository ? "connected" as const : "repository_unavailable" as const,
    accepts_arbitrary_targets: false,
  };
}

export async function createPhantomHunterWebScan(input: {
  organizationId: string;
  actorId: string;
  allowPlatformDefault: boolean;
  authorizationAttested: true;
}) {
  const workspace = await getPhantomHunterWebRepository(input);
  if (!workspace.connected || !workspace.repository) throw new Error(workspace.connection_state);
  return createPhantomHunterScan({
    organizationId: input.organizationId,
    actorId: input.actorId,
    assetIds: [workspace.repository.id],
    engines: ["betterleaks", "trufflehog", "keyhunter"],
    verifyActive: true,
    authorizationAttested: input.authorizationAttested,
    verificationConfirmation: "VERIFY_AUTHORIZED_CREDENTIALS",
  });
}

function toolCandidates(id: PhantomHunterEngineId) {
  const exe = process.platform === "win32" ? ".exe" : "";
  if (id === "betterleaks") return [
    process.env.PHANTOM_HUNTER_BETTERLEAKS_BIN,
    process.env.BETTERLEAKS_BIN,
    join(REPO_ROOT, ".tools", "betterleaks", `betterleaks${exe}`),
    join(homedir(), "betterleaks", `betterleaks${exe}`),
  ];
  if (id === "trufflehog") return [
    process.env.PHANTOM_HUNTER_TRUFFLEHOG_BIN,
    process.env.TRUFFLEHOG_BIN,
    join(REPO_ROOT, ".tools", "trufflehog", `trufflehog${exe}`),
  ];
  return [
    process.env.PHANTOM_HUNTER_KEYHUNTER_BIN,
    process.env.KEYHUNTER_BIN,
    join(REPO_ROOT, ".tools", "keyhunter", `keyhunter${exe}`),
    join(homedir(), "Documents", "Tools", "keyhunter", "target", "release", `keyhunter${exe}`),
    join(homedir(), "Documents", "Tools", "keyhunter", "target", "debug", `keyhunter${exe}`),
  ];
}

async function executableFor(id: PhantomHunterEngineId) {
  for (const candidate of toolCandidates(id)) {
    if (!candidate) continue;
    try { await access(candidate); return candidate; } catch { /* try next */ }
  }
  return null;
}

type CommandResult = { stdout: string; stderr: string; code: number | null; timedOut: boolean };

async function runCommand(input: {
  scanId?: string;
  executable: string;
  args: string[];
  stdin?: Buffer | string;
  cwd?: string;
  timeoutMs?: number;
  acceptedExitCodes?: number[];
}): Promise<CommandResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(input.executable, input.args, {
      cwd: input.cwd || REPO_ROOT,
      env: process.env,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (input.scanId) {
      const children = activeChildren.get(input.scanId) || new Set();
      children.add(child);
      activeChildren.set(input.scanId, children);
    }
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (input.scanId) activeChildren.get(input.scanId)?.delete(child);
      callback();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, input.timeoutMs || DEFAULT_TOOL_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_TOOL_OUTPUT_BYTES) child.kill();
      else stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= 2 * 1024 * 1024) stderr.push(chunk);
    });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code) => finish(() => {
      const result = {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        code,
        timedOut,
      };
      const accepted = input.acceptedExitCodes || [0];
      if (timedOut) reject(new Error("tool_timeout"));
      else if (stdoutBytes > MAX_TOOL_OUTPUT_BYTES) reject(new Error("tool_output_limit"));
      else if (code == null || !accepted.includes(code)) reject(new Error(`tool_exit_${code ?? "unknown"}`));
      else resolvePromise(result);
    }));
    if (input.stdin != null) child.stdin.end(input.stdin);
    else child.stdin.end();
  });
}

async function commandVersion(id: PhantomHunterEngineId, executable: string) {
  const args = id === "betterleaks" ? ["version"] : ["--version"];
  const result = await runCommand({ executable, args, timeoutMs: 15_000 });
  return redactText(result.stdout || result.stderr).replace(/\s+/g, " ").trim().slice(0, 80) || "available";
}

export async function getPhantomHunterStatus() {
  if (toolStatusCache && toolStatusCache.expiresAt > Date.now()) {
    return buildStatus(toolStatusCache.tools);
  }
  const definitions: Array<Pick<ToolStatus, "id" | "name" | "role">> = [
    { id: "betterleaks", name: "Betterleaks", role: "broad_discovery" },
    { id: "trufflehog", name: "TruffleHog", role: "history_discovery" },
    { id: "keyhunter", name: "KeyHunter", role: "safe_provider_verification_bridge" },
  ];
  const tools = await Promise.all(definitions.map(async (definition): Promise<ToolStatus> => {
    const executable = await executableFor(definition.id);
    if (!executable) return { ...definition, available: false, version: null, executable_configured: false, path_exposed: false, error: "executable_not_found" };
    try {
      return { ...definition, available: true, version: await commandVersion(definition.id, executable), executable_configured: true, path_exposed: false, error: null };
    } catch {
      return { ...definition, available: false, version: null, executable_configured: true, path_exposed: false, error: "version_probe_failed" };
    }
  }));
  toolStatusCache = { expiresAt: Date.now() + 30_000, tools };
  return buildStatus(tools);
}

function buildStatus(tools: ToolStatus[]) {
  return {
    app: "PhantomHunter",
    version: PHANTOM_HUNTER_VERSION,
    policy_id: PHANTOM_HUNTER_POLICY_ID,
    status: tools.every((tool) => tool.available) ? "ready" : tools.some((tool) => tool.available) ? "degraded" : "unavailable",
    tools,
    limits: { assets_per_intake: 250, assets_per_organization: MAX_ASSETS_PER_ORG, findings_per_scan: MAX_FINDINGS_PER_SCAN },
    security: {
      authorization_attestation_required: true,
      active_verification_requires_confirmation: true,
      raw_secrets_returned: false,
      raw_secrets_persisted: false,
      raw_secrets_logged: false,
      exports_masked_only: true,
      provider_verification_rate_limited: true,
      native_discovery_engine_verification_disabled: true,
      verification_safe_methods_only: true,
      public_web_collection_same_origin_only: true,
      private_network_fetch_disabled: process.env.PHANTOM_HUNTER_ALLOW_PRIVATE_TARGETS !== "true",
    },
  };
}

function privateIp(address: string) {
  if (address === "::1" || address === "0:0:0:0:0:0:0:1") return true;
  if (/^(?:10\.|127\.|169\.254\.|192\.168\.)/.test(address)) return true;
  const ipv4 = address.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4) {
    const first = Number(ipv4[1]);
    const second = Number(ipv4[2]);
    return first === 0 || first === 10 || first === 127 || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168) || (first === 169 && second === 254);
  }
  return /^(?:fc|fd|fe80):/i.test(address);
}

async function assertRemoteAllowed(url: URL) {
  if (process.env.PHANTOM_HUNTER_ALLOW_PRIVATE_TARGETS === "true") return;
  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase())) {
    throw new Error("private_network_target_blocked");
  }
  const records = await lookup(url.hostname, { all: true });
  if (!records.length || records.some((record) => privateIp(record.address))) throw new Error("private_network_target_blocked");
}

async function fetchBounded(url: URL) {
  await assertRemoteAllowed(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: { Accept: "text/html,application/json,text/javascript,application/javascript,text/plain,application/xml;q=0.8" },
      signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("redirect_without_location");
      const next = new URL(location, url);
      if (next.origin !== url.origin) throw new Error("cross_origin_redirect_blocked");
      return fetchBounded(next);
    }
    if (!response.ok) throw new Error(`http_${response.status}`);
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_REMOTE_BYTES) throw new Error("remote_content_too_large");
    const type = response.headers.get("content-type") || "";
    if (!/(?:text|json|javascript|xml|yaml|graphql)/i.test(type)) throw new Error("remote_content_type_not_scannable");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_REMOTE_BYTES) throw new Error("remote_content_too_large");
    return { url, type, text: bytes.toString("utf8") };
  } finally {
    clearTimeout(timer);
  }
}

async function collectRemoteContent(asset: PhantomHunterAsset) {
  const root = new URL(asset.target);
  const queue = [root];
  if (asset.kind === "api") {
    for (const path of ["/openapi.json", "/swagger.json", "/api-docs", "/.well-known/openapi.json"]) queue.push(new URL(path, root));
  }
  const seen = new Set<string>();
  const documents: Array<{ url: URL; text: string; type: string }> = [];
  let totalBytes = 0;
  while (queue.length && documents.length < MAX_REMOTE_DOCUMENTS && totalBytes < MAX_REMOTE_BYTES) {
    const next = queue.shift()!;
    if (next.origin !== root.origin || seen.has(next.toString())) continue;
    seen.add(next.toString());
    try {
      const document = await fetchBounded(next);
      documents.push(document);
      totalBytes += Buffer.byteLength(document.text);
      if (/html/i.test(document.type)) {
        const scripts = [...document.text.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((match) => match[1]);
        for (const script of scripts) {
          try {
            const scriptUrl = new URL(script, next);
            if (scriptUrl.origin === root.origin && /\.(?:js|mjs)(?:\?|$)/i.test(scriptUrl.pathname)) queue.push(scriptUrl);
          } catch { /* malformed source is ignored */ }
        }
      }
    } catch (error) {
      if (documents.length === 0 && queue.length === 0) throw error;
    }
  }
  if (!documents.length) throw new Error("remote_content_unavailable");
  return Buffer.from(documents.map((document) => `\n/* PhantomHunter source: ${document.url.pathname} */\n${document.text}`).join("\n"), "utf8");
}

function safeLocation(asset: PhantomHunterAsset, value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return asset.target_display;
  if (asset.kind === "local_path") {
    const full = isAbsolute(raw) ? resolve(raw) : resolve(asset.target, raw);
    const rel = relative(asset.target, full);
    if (rel && !rel.startsWith("..") && !isAbsolute(rel)) return rel.replace(/\\/g, "/").slice(0, 500);
    return basename(raw).slice(0, 260) || asset.target_display;
  }
  try {
    const url = new URL(raw);
    url.username = ""; url.password = ""; url.search = ""; url.hash = "";
    return `${url.hostname}${url.pathname}`.slice(0, 500);
  } catch {
    return raw.replace(/[<>\r\n]/g, " ").slice(0, 500);
  }
}

function safeSourceUrl(value: unknown) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    url.username = ""; url.password = ""; url.search = ""; url.hash = "";
    return url.toString().slice(0, 1000);
  } catch { return null; }
}

export function parseBetterleaksOutput(stdout: string, asset?: PhantomHunterAsset): Candidate[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(trimmed); } catch { return []; }
  const rows = Array.isArray(parsed) ? parsed : [];
  return rows.flatMap((row): Candidate[] => {
    if (!row || typeof row !== "object") return [];
    const finding = row as Record<string, unknown>;
    const secret = String(finding.Secret ?? finding.secret ?? "");
    if (!secret || secret === "REDACTED") return [];
    const attrs = (finding.Attributes && typeof finding.Attributes === "object" ? finding.Attributes : {}) as Record<string, unknown>;
    const validation = String(finding.ValidationStatus ?? finding.validationStatus ?? "").toLowerCase();
    const verification = validation === "valid" ? "active" : ["invalid", "revoked"].includes(validation)
      ? "inactive" : ["unknown", "error", "needs_validation"].includes(validation) ? "unknown" : "unverified";
    const detector = String(finding.RuleID ?? finding.ruleId ?? finding.Description ?? "betterleaks-rule");
    return [{
      secret,
      provider: normalizedProvider(`${detector} ${String(finding.Description ?? "")}`, secret),
      detector,
      engine: "betterleaks",
      verification,
      verifiedAt: verification === "unverified" ? null : isoNow(),
      location: asset ? safeLocation(asset, attrs.path ?? finding.File) : String(attrs.path ?? finding.File ?? "unknown"),
      line: Number.isFinite(Number(finding.StartLine)) ? Number(finding.StartLine) : null,
      commit: String(attrs.commit ?? attrs.git_sha ?? finding.Commit ?? "") || null,
      sourceUrl: safeSourceUrl(finding.Link ?? attrs.link),
    }];
  });
}

function rawFromTrufflehog(row: Record<string, unknown>) {
  const raw = row.Raw ?? row.RawV2 ?? row.raw;
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && "data" in raw) return String((raw as { data?: unknown }).data ?? "");
  return "";
}

export function parseTrufflehogOutput(stdout: string, asset?: PhantomHunterAsset): Candidate[] {
  const candidates: Candidate[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const row = JSON.parse(line) as Record<string, unknown>;
      const secret = rawFromTrufflehog(row);
      if (!secret) continue;
      const detector = String(row.DetectorName ?? row.detector_name ?? "trufflehog-detector");
      const verified = row.Verified === true || row.verified === true;
      const verificationError = String(row.VerificationError ?? row.verification_error ?? "");
      const metadata = (row.SourceMetadata && typeof row.SourceMetadata === "object" ? row.SourceMetadata : {}) as Record<string, unknown>;
      const data = (metadata.Data && typeof metadata.Data === "object" ? metadata.Data : {}) as Record<string, unknown>;
      const source = Object.values(data).find((value) => value && typeof value === "object") as Record<string, unknown> | undefined;
      candidates.push({
        secret,
        provider: normalizedProvider(detector, secret),
        detector,
        engine: "trufflehog",
        verification: verified ? "active" : verificationError ? "unknown" : "unverified",
        verifiedAt: verified ? isoNow() : null,
        location: asset ? safeLocation(asset, source?.file ?? source?.path ?? source?.repository ?? asset.target_display) : String(source?.file ?? source?.path ?? "unknown"),
        line: Number.isFinite(Number(source?.line)) ? Number(source?.line) : null,
        commit: String(source?.commit ?? "") || null,
        sourceUrl: safeSourceUrl(source?.link ?? source?.url),
      });
    } catch { /* non-JSON progress output is ignored */ }
  }
  return candidates;
}

function scanTarget(asset: PhantomHunterAsset, engine: "betterleaks" | "trufflehog") {
  if (asset.kind === "local_path") {
    const gitMarker = join(asset.target, ".git");
    return stat(gitMarker).then(() => ({ mode: "git" as const, target: asset.target })).catch(() => ({ mode: "filesystem" as const, target: asset.target }));
  }
  if (asset.kind === "git_repository") {
    return assertRemoteAllowed(new URL(asset.target)).then(() => ({ mode: "git" as const, target: asset.target }));
  }
  return Promise.resolve({ mode: "stdin" as const, target: asset.target });
}

async function runBetterleaks(scanId: string, asset: PhantomHunterAsset, webContent?: Buffer) {
  const executable = await executableFor("betterleaks");
  if (!executable) throw new Error("engine_unavailable");
  const target = await scanTarget(asset, "betterleaks");
  const source = target.mode === "filesystem" ? "dir" : target.mode;
  const args = [source];
  if (source !== "stdin") args.push(target.target);
  args.push("--no-banner", "--no-color", "--report-format", "json", "--report-path", "-", "--redact=0", "--exit-code", "0", "--max-target-megabytes", "100", "--timeout", "300");
  const result = await runCommand({ scanId, executable, args, stdin: source === "stdin" ? webContent : undefined, acceptedExitCodes: [0] });
  return parseBetterleaksOutput(result.stdout, asset);
}

function localGitUri(target: string) {
  return new URL(`file:///${target.replace(/\\/g, "/")}`).toString();
}

async function runTrufflehog(scanId: string, asset: PhantomHunterAsset, webContent?: Buffer) {
  const executable = await executableFor("trufflehog");
  if (!executable) throw new Error("engine_unavailable");
  const target = await scanTarget(asset, "trufflehog");
  const source = target.mode === "filesystem" ? "filesystem" : target.mode;
  const args = [source];
  if (source === "git") args.push(asset.kind === "local_path" ? localGitUri(target.target) : target.target);
  else if (source === "filesystem") args.push(target.target);
  args.push("--json", "--no-color", "--no-update", "--concurrency=3", "--max-decode-depth=5");
  args.push("--no-verification", "--results=unverified");
  const result = await runCommand({ scanId, executable, args, stdin: source === "stdin" ? webContent : undefined, acceptedExitCodes: [0, 183] });
  return parseTrufflehogOutput(result.stdout, asset);
}

async function scrubAndUnlink(path: string) {
  try {
    const size = (await stat(path)).size;
    if (size > 0 && size <= MAX_TOOL_OUTPUT_BYTES) await writeFile(path, Buffer.alloc(size));
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function parseKeyHunterVerificationOutput(stdout: string): Candidate[] {
  let parsed: unknown;
  try { parsed = JSON.parse(stdout); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((row): Candidate[] => {
    if (!row || typeof row !== "object") return [];
    const finding = row as Record<string, unknown>;
    const secret = String(finding.key ?? "");
    if (!secret) return [];
    const isActive = finding.is_active === true;
    const error = String(finding.error_message ?? "");
    return [{
      secret,
      provider: normalizedProvider(finding.provider, secret),
      detector: `keyhunter:${String(finding.provider ?? "provider")}`,
      engine: "keyhunter",
      verification: isActive ? "active" : error ? "unknown" : "inactive",
      verifiedAt: String(finding.verified_at ?? "") || isoNow(),
      location: String(finding.file_path ?? finding.repo_name ?? "provider verification"),
      line: null,
      commit: null,
      sourceUrl: safeSourceUrl(finding.file_url ?? finding.repo_url),
    }];
  });
}

async function runKeyHunterBridge(scanId: string, asset: PhantomHunterAsset, candidates: Candidate[]) {
  const executable = await executableFor("keyhunter");
  if (!executable) throw new Error("engine_unavailable");
  const unique = new Map<string, Candidate & { keyHunterProvider: string }>();
  for (const candidate of candidates) {
    const provider = keyHunterProvider(candidate);
    if (!provider) continue;
    unique.set(secretFingerprint(candidate.secret), { ...candidate, keyHunterProvider: provider });
  }
  if (!unique.size) return [];
  const temporaryRoot = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(tmpdir(), "phantomhunter-keyhunter-")));
  const inputPath = join(temporaryRoot, "input.json");
  const outputPath = join(temporaryRoot, "output.json");
  try {
    const payload = [...unique.values()].map((candidate) => ({
      provider: candidate.keyHunterProvider,
      key: candidate.secret,
      key_masked: maskSecret(candidate.secret),
      file_path: candidate.location,
      file_url: candidate.sourceUrl || "",
      repo_name: asset.target_display,
      repo_url: asset.kind === "local_path" ? "" : asset.target,
      owner: "authorized-client",
      owner_url: "",
      owner_type: "AuthorizedAsset",
      found_at: isoNow(),
      verified: null,
    }));
    await writeFile(inputPath, JSON.stringify(payload), { encoding: "utf8", mode: 0o600 });
    await runCommand({
      scanId,
      executable,
      args: ["verify", "-i", inputPath, "-a", "-c", "3", "-o", outputPath],
      cwd: temporaryRoot,
      acceptedExitCodes: [0],
    });
    return parseKeyHunterVerificationOutput(await readFile(outputPath, "utf8"));
  } finally {
    await scrubAndUnlink(inputPath).catch(() => undefined);
    await scrubAndUnlink(outputPath).catch(() => undefined);
    await rmdir(temporaryRoot).catch(() => undefined);
  }
}

function candidateSource(asset: PhantomHunterAsset, candidate: Candidate): PhantomHunterFindingSource {
  return {
    engine: candidate.engine,
    asset_id: asset.id,
    location: safeLocation(asset, candidate.location),
    line: candidate.line,
    commit: candidate.commit?.slice(0, 80) || null,
    source_url: candidate.sourceUrl,
    detector: candidate.detector.replace(/[<>\r\n]/g, " ").slice(0, 160),
  };
}

function mergeCandidate(map: Map<string, PhantomHunterFinding>, scan: PhantomHunterScan, asset: PhantomHunterAsset, candidate: Candidate) {
  if (!candidate.secret || map.size >= MAX_FINDINGS_PER_SCAN) return;
  const fingerprint = secretFingerprint(candidate.secret);
  let finding = map.get(fingerprint);
  if (!finding) {
    finding = {
      id: randomUUID(), organization_id: scan.organization_id, scan_id: scan.id,
      provider: normalizedProvider(candidate.provider, candidate.secret),
      masked_secret: maskSecret(candidate.secret), secret_fingerprint: fingerprint,
      verification_status: candidate.verification,
      verified_at: candidate.verification === "active" ? candidate.verifiedAt || isoNow() : null,
      verification_engines: candidate.verification !== "unverified" ? [candidate.engine] : [],
      detection_engines: [candidate.engine], confidence: candidate.verification === "active" ? "verified_active" : "candidate",
      sources: [candidateSource(asset, candidate)], remediation: "Revoke or rotate this credential, remove it from history/build artifacts, then rescan.",
      raw_secret_stored: false,
    };
    map.set(fingerprint, finding);
  } else {
    if (!finding.detection_engines.includes(candidate.engine)) finding.detection_engines.push(candidate.engine);
    if (candidate.verification !== "unverified" && !finding.verification_engines.includes(candidate.engine)) finding.verification_engines.push(candidate.engine);
    const source = candidateSource(asset, candidate);
    if (!finding.sources.some((entry) => entry.engine === source.engine && entry.asset_id === source.asset_id && entry.location === source.location && entry.line === source.line)) {
      finding.sources.push(source);
    }
    const statuses = new Set([finding.verification_status, candidate.verification]);
    if (statuses.has("active") && statuses.has("inactive")) finding.verification_status = "conflict";
    else if (statuses.has("active")) finding.verification_status = "active";
    else if (statuses.has("inactive") && !statuses.has("unknown")) finding.verification_status = "inactive";
    else if (statuses.has("unknown") && !statuses.has("inactive")) finding.verification_status = "unknown";
    if (candidate.verification === "active") finding.verified_at = candidate.verifiedAt || isoNow();
  }
  finding.confidence = finding.verification_status === "active" ? "verified_active"
    : finding.verification_status === "conflict" ? "engine_conflict"
      : finding.detection_engines.length >= 2 ? "corroborated" : "candidate";
}

function summarizeScan(scan: PhantomHunterScan) {
  scan.findings = scan.findings.slice(0, MAX_FINDINGS_PER_SCAN);
  scan.summary = {
    total_candidates: scan.findings.length,
    verified_active: scan.findings.filter((finding) => finding.verification_status === "active").length,
    inactive: scan.findings.filter((finding) => finding.verification_status === "inactive").length,
    conflicts: scan.findings.filter((finding) => finding.verification_status === "conflict").length,
    needs_review: scan.findings.filter((finding) => ["unknown", "unverified", "conflict"].includes(finding.verification_status)).length,
    providers: new Set(scan.findings.map((finding) => finding.provider)).size,
    assets_scanned: scan.progress.completed_assets,
  };
  scan.integrity_hash = integrityHash({
    id: scan.id, organization_id: scan.organization_id, status: scan.status, asset_ids: scan.asset_ids,
    summary: scan.summary, findings: scan.findings, engine_runs: scan.engine_runs, errors: scan.errors,
  });
}

async function runOneEngine(scan: PhantomHunterScan, state: OrgState, asset: PhantomHunterAsset, engine: "betterleaks" | "trufflehog", webContent?: Buffer) {
  const run = scan.engine_runs.find((entry) => entry.asset_id === asset.id && entry.engine === engine)!;
  run.status = "running";
  run.started_at = isoNow();
  await persistOrgState(scan.organization_id, state);
  try {
    const candidates = engine === "betterleaks"
      ? await runBetterleaks(scan.id, asset, webContent)
      : await runTrufflehog(scan.id, asset, webContent);
    run.status = "completed";
    run.candidates = candidates.length;
    run.verified_active = candidates.filter((candidate) => candidate.verification === "active").length;
    return candidates;
  } catch (error) {
    run.status = "failed";
    run.note = redactText(error instanceof Error ? error.message : error);
    scan.errors.push({ engine, asset_id: asset.id, code: run.note || "engine_failed" });
    return [];
  } finally {
    run.completed_at = isoNow();
  }
}

async function executeScan(scan: PhantomHunterScan, state: OrgState) {
  scan.status = "running";
  scan.started_at = isoNow();
  summarizeScan(scan);
  await persistOrgState(scan.organization_id, state);
  const findingMap = new Map<string, PhantomHunterFinding>();
  for (const finding of scan.findings) findingMap.set(finding.secret_fingerprint, finding);
  for (const assetId of scan.asset_ids) {
    if (scan.cancellation_requested) break;
    const asset = state.assets.find((candidate) => candidate.id === assetId);
    if (!asset || asset.readiness !== "ready") {
      scan.errors.push({ engine: "orchestrator", asset_id: assetId, code: asset ? asset.readiness : "asset_not_found" });
      scan.progress.completed_assets += 1;
      continue;
    }
    scan.progress.current_asset_id = asset.id;
    let webContent: Buffer | undefined;
    if (asset.kind === "web_app" || asset.kind === "api") {
      try { webContent = await collectRemoteContent(asset); }
      catch (error) {
        scan.errors.push({ engine: "orchestrator", asset_id: asset.id, code: redactText(error instanceof Error ? error.message : error) || "remote_collection_failed" });
      }
    }
    const candidates: Candidate[] = [];
    for (const engine of ["betterleaks", "trufflehog"] as const) {
      if (!scan.engines_requested.includes(engine)) continue;
      if ((asset.kind === "web_app" || asset.kind === "api") && !webContent) {
        const run = scan.engine_runs.find((entry) => entry.asset_id === asset.id && entry.engine === engine)!;
        run.status = "skipped"; run.note = "remote_content_unavailable"; run.completed_at = isoNow();
        continue;
      }
      candidates.push(...await runOneEngine(scan, state, asset, engine, webContent));
    }
    if (scan.engines_requested.includes("keyhunter")) {
      const run = scan.engine_runs.find((entry) => entry.asset_id === asset.id && entry.engine === "keyhunter")!;
      if (!scan.verify_active) {
        run.status = "skipped"; run.note = "active_verification_not_requested"; run.completed_at = isoNow();
      } else {
        run.status = "running"; run.started_at = isoNow();
        try {
          const verified = await runKeyHunterBridge(scan.id, asset, candidates);
          candidates.push(...verified);
          run.status = "completed";
          run.candidates = verified.length;
          run.verified_active = verified.filter((candidate) => candidate.verification === "active").length;
        } catch (error) {
          run.status = "failed";
          run.note = redactText(error instanceof Error ? error.message : error);
          scan.errors.push({ engine: "keyhunter", asset_id: asset.id, code: run.note || "engine_failed" });
        } finally {
          run.completed_at = isoNow();
        }
      }
    }
    for (const candidate of candidates) {
      mergeCandidate(findingMap, scan, asset, candidate);
      candidate.secret = "";
    }
    // Candidate material stays process-local. PhantomForce's web surface and
    // durable tenant record retain provider-confirmed active exposure only.
    scan.findings = [...findingMap.values()].filter((finding) => finding.verification_status === "active");
    scan.progress.completed_assets += 1;
    summarizeScan(scan);
    await persistOrgState(scan.organization_id, state);
  }
  scan.progress.current_asset_id = null;
  scan.completed_at = isoNow();
  if (scan.cancellation_requested) scan.status = "cancelled";
  else if (scan.progress.completed_assets === 0) scan.status = "failed";
  else if (scan.errors.length) scan.status = "partial";
  else scan.status = "completed";
  summarizeScan(scan);
  await persistOrgState(scan.organization_id, state);
}

export async function createPhantomHunterScan(input: {
  organizationId: string;
  actorId: string;
  assetIds: string[];
  engines: PhantomHunterEngineId[];
  verifyActive: boolean;
  authorizationAttested: true;
  verificationConfirmation?: string;
}) {
  if (!input.authorizationAttested) throw new Error("authorization_attestation_required");
  if (input.verifyActive && input.verificationConfirmation !== "VERIFY_AUTHORIZED_CREDENTIALS") {
    throw new Error("verification_confirmation_required");
  }
  const state = await loadOrgState(input.organizationId);
  const uniqueAssetIds = [...new Set(input.assetIds)];
  if (uniqueAssetIds.some((id) => !state.assets.some((asset) => asset.id === id))) throw new Error("asset_not_found_for_organization");
  const uniqueEngines = [...new Set(input.engines)] as PhantomHunterEngineId[];
  const now = isoNow();
  const scan: PhantomHunterScan = {
    id: randomUUID(), organization_id: input.organizationId, status: "queued", created_at: now,
    started_at: null, completed_at: null, created_by: input.actorId, authorization_attested_at: now,
    verification_confirmation_recorded: input.verifyActive,
    verify_active: input.verifyActive, engines_requested: uniqueEngines, asset_ids: uniqueAssetIds,
    progress: { completed_assets: 0, total_assets: uniqueAssetIds.length, current_asset_id: null },
    engine_runs: uniqueAssetIds.flatMap((assetId) => uniqueEngines.map((engine): PhantomHunterEngineRun => ({
      engine, asset_id: assetId, status: "queued", candidates: 0, verified_active: 0,
      started_at: null, completed_at: null, note: null,
    }))),
    findings: [], summary: { total_candidates: 0, verified_active: 0, inactive: 0, conflicts: 0, needs_review: 0, providers: 0, assets_scanned: 0 },
    errors: [], integrity_hash: "", raw_secrets_stored: false,
  };
  summarizeScan(scan);
  state.scans.unshift(scan);
  state.scans = state.scans.slice(0, MAX_SCANS_PER_ORG);
  await persistOrgState(input.organizationId, state);
  queueMicrotask(() => { void executeScan(scan, state).catch(async () => {
    scan.status = "failed"; scan.completed_at = isoNow();
    scan.errors.push({ engine: "orchestrator", asset_id: null, code: "scan_execution_failed" });
    summarizeScan(scan); await persistOrgState(scan.organization_id, state).catch(() => undefined);
  }); });
  return publicScan(scan);
}

export async function listPhantomHunterScans(organizationId: string, limit = 20) {
  const state = await loadOrgState(organizationId);
  return state.scans.slice(0, Math.max(1, Math.min(50, limit))).map((scan) => publicScan(scan));
}

export async function getPhantomHunterScan(organizationId: string, scanId: string, _includeReview = false) {
  const scan = (await loadOrgState(organizationId)).scans.find((candidate) => candidate.id === scanId);
  return scan ? publicScan(scan) : null;
}

export async function cancelPhantomHunterScan(organizationId: string, scanId: string) {
  const state = await loadOrgState(organizationId);
  const scan = state.scans.find((candidate) => candidate.id === scanId);
  if (!scan) return null;
  if (["completed", "partial", "failed", "cancelled"].includes(scan.status)) return publicScan(scan);
  scan.cancellation_requested = true;
  for (const child of activeChildren.get(scan.id) || []) child.kill();
  summarizeScan(scan);
  await persistOrgState(organizationId, state);
  return publicScan(scan);
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function exportPhantomHunterActiveCsv(organizationId: string, scanId: string) {
  const scan = (await loadOrgState(organizationId)).scans.find((candidate) => candidate.id === scanId);
  if (!scan) return null;
  const header = ["provider", "masked_secret", "fingerprint", "verification_status", "verified_at", "engines", "asset_id", "location", "line", "remediation"];
  const rows = scan.findings.filter((finding) => finding.verification_status === "active").flatMap((finding) => finding.sources.map((source) => [
    finding.provider, finding.masked_secret, finding.secret_fingerprint, finding.verification_status, finding.verified_at,
    finding.verification_engines.join("+"), source.asset_id, source.location, source.line ?? "", finding.remediation,
  ]));
  return `${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function resetPhantomHunterStateForTests() {
  stateCache.clear();
  saveQueues.clear();
  toolStatusCache = null;
}
