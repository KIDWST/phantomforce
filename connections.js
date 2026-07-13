// Local, encrypted storage for provider API keys — no accounts, no logins,
// single local user. Encrypts at rest so keys don't sit as plaintext under
// .termina/, and are never echoed into any log, ledger, recording, or API
// response. This does NOT protect against a determined attacker with full
// access to the user's own account, the same limitation ~/.claude/ or
// ~/.aws/credentials already have — it's meaningfully better than the
// status quo (no stored secret at all), not a claim of airtight security.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const CONNECTION_PROVIDERS = {
  claude: { label: "Claude (Anthropic)", envVar: "ANTHROPIC_API_KEY" },
  codex: { label: "Codex (OpenAI)", envVar: "OPENAI_API_KEY" },
  openrouter: {
    label: "OpenRouter",
    envVar: "OPENROUTER_API_KEY",
    extraField: { name: "model", envVar: "OPENROUTER_MODEL", label: "Model", placeholder: "z-ai/glm-5.2" },
  },
};

function termDir(appDir) {
  const dir = path.join(appDir, ".termina");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function keyPath(appDir) {
  return path.join(termDir(appDir), "connections.key");
}

function connectionsPath(appDir) {
  return path.join(termDir(appDir), "connections.json");
}

function getOrCreateKey(appDir) {
  const file = keyPath(appDir);
  if (existsSync(file)) return Buffer.from(readFileSync(file, "utf8"), "base64");
  const key = randomBytes(32);
  writeFileSync(file, key.toString("base64"), "utf8");
  return key;
}

function readRaw(appDir) {
  const file = connectionsPath(appDir);
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function writeRaw(appDir, all) {
  writeFileSync(connectionsPath(appDir), JSON.stringify(all, null, 2), "utf8");
}

export async function saveConnection(appDir, provider, apiKey, extra) {
  const key = getOrCreateKey(appDir);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  const all = readRaw(appDir);
  all[provider] = {
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    last4: apiKey.slice(-4),
    connectedAt: Date.now(),
    extra: extra ?? null,
  };
  writeRaw(appDir, all);
}

// Metadata only — never includes iv/authTag/ciphertext. Safe to serialize
// straight to an API response. `extra` (e.g. a model slug) is a plain,
// non-secret value, safe to expose alongside the rest of the metadata.
export function readConnections(appDir) {
  const all = readRaw(appDir);
  const out = {};
  for (const [provider, entry] of Object.entries(all)) {
    out[provider] = { connected: true, last4: entry.last4, connectedAt: entry.connectedAt, extra: entry.extra ?? null };
  }
  return out;
}

export async function removeConnection(appDir, provider) {
  const all = readRaw(appDir);
  delete all[provider];
  writeRaw(appDir, all);
}

// Server-side only — never call this from a handler that serializes its
// result back to the client.
export function getApiKeyEnv(appDir, provider) {
  const meta = CONNECTION_PROVIDERS[provider];
  if (!meta) return {};
  const all = readRaw(appDir);
  const entry = all[provider];
  if (!entry) return {};
  try {
    const key = getOrCreateKey(appDir);
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(entry.iv, "base64"));
    decipher.setAuthTag(Buffer.from(entry.authTag, "base64"));
    const plain = Buffer.concat([decipher.update(Buffer.from(entry.ciphertext, "base64")), decipher.final()]);
    const env = { [meta.envVar]: plain.toString("utf8") };
    if (meta.extraField && entry.extra) env[meta.extraField.envVar] = entry.extra;
    return env;
  } catch {
    return {};
  }
}
