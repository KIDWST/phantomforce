import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function parseJson<T>(payload: string): T {
  return JSON.parse(payload) as T;
}

const tempDir = mkdtempSync(join(tmpdir(), "phantom-owner-memory-"));
const vaultDir = join(tempDir, "vault");
const repoDocsDir = join(tempDir, "docs");
const ledgerPath = join(tempDir, "hermes-ledger.jsonl");
const interactionPath = join(tempDir, "hermes-interaction-memory.jsonl");

process.env.NODE_ENV = "development";
process.env.PHANTOMFORCE_SERVER_LISTEN = "false";
process.env.PHANTOMFORCE_SERVER_LOGGER = "false";
process.env.PHANTOMFORCE_AUTH_PROVIDER = "demo";
process.env.PHANTOMFORCE_ENABLE_DEMO_AUTH = "true";
process.env.PHANTOMFORCE_SKIP_SERVER_DOTENV = "true";
process.env.PHANTOMFORCE_ALLOW_UNSIGNED_SESSION_HEADER = "false";
process.env.PHANTOMFORCE_PROCESS_VAULT_PATH = vaultDir;
process.env.PHANTOM_HERMES_LEDGER_PATH = ledgerPath;
process.env.PHANTOM_HERMES_INTERACTION_MEMORY_STORE_PATH = interactionPath;

const source = await readFile(new URL("../src/phantom-ai/owner-codex-memory.ts", import.meta.url), "utf8");
assert(!/\bfetch\s*\(/i.test(source), "Owner memory status must not add fetch calls.");
assert(!/\bhttps?\.request\b/i.test(source), "Owner memory status must not add HTTP requests.");
assert(!/\baxios\s*\(/i.test(source), "Owner memory status must not use axios.");
assert(!/\bappendFile\b|\bwriteFile\b/i.test(source), "Owner memory status must not write files.");

mkdirSync(vaultDir, { recursive: true });
mkdirSync(repoDocsDir, { recursive: true });
writeFileSync(join(vaultDir, ".keep"), "", { flag: "w" });
writeFileSync(join(repoDocsDir, ".keep"), "", { flag: "w" });
writeFileSync(join(vaultDir, "wisconsin-drive-note.md"), "PhantomForce owner note. api_key=sk-owner-test-secret", "utf8");
writeFileSync(join(repoDocsDir, "admin-memory.md"), "Admin memory document for PhantomForce.", "utf8");
writeFileSync(join(vaultDir, ".env"), "OPENROUTER_API_KEY=sk-should-never-return", "utf8");

const { app } = await import("../src/index.js");

type LoginResponse = {
  token: string;
};

type OwnerMemoryResponse = {
  ok: boolean;
  owner_memory: {
    access_model: {
      owner_admin_only: boolean;
      raw_codex_internal_memory_exposed: boolean;
      sanitized_local_codex_artifacts_exposed: boolean;
    };
    query: string | null;
    artifacts: Array<{ path: string; match_snippet?: string }>;
    safety_flags: {
      admin_only: boolean;
      client_visible: boolean;
      env_files_excluded: boolean;
      raw_secret_exposed: boolean;
      provider_called: boolean;
      network_call_performed: boolean;
    };
  };
  provider_called: boolean;
  network_call_performed: boolean;
  credentials_returned: boolean;
};

async function login(sessionId: string) {
  const response = await app.inject({
    method: "POST",
    url: "/auth/demo-login",
    headers: { "Content-Type": "application/json" },
    payload: JSON.stringify({ sessionId }),
  });
  assert(response.statusCode === 200, `${sessionId} login should succeed.`);
  return parseJson<LoginResponse>(response.payload).token;
}

try {
  const adminToken = await login("admin-jordan");
  const clientToken = await login("client-sports-demo");

  const admin = await app.inject({
    method: "GET",
    url: "/phantom-ai/admin/codex-memory/status?q=owner",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert(admin.statusCode === 200, "Admin should access owner memory status.");
  const adminBody = parseJson<OwnerMemoryResponse>(admin.payload);
  const adminText = JSON.stringify(adminBody);

  assert(adminBody.ok === true, "Admin response ok.");
  assert(adminBody.owner_memory.access_model.owner_admin_only === true, "Owner memory must be admin-only.");
  assert(
    adminBody.owner_memory.access_model.raw_codex_internal_memory_exposed === false,
    "Raw Codex internals must not be exposed.",
  );
  assert(
    adminBody.owner_memory.access_model.sanitized_local_codex_artifacts_exposed === true,
    "Sanitized local artifacts should be exposed.",
  );
  assert(adminBody.owner_memory.query === "owner", "Query should be reflected.");
  assert(adminBody.owner_memory.artifacts.some((artifact) => artifact.path.endsWith("wisconsin-drive-note.md")), "Vault artifact should be indexed.");
  assert(!adminText.includes("sk-owner-test-secret"), "Secrets in notes must be redacted.");
  assert(!adminText.includes("sk-should-never-return"), ".env content must not be returned.");
  assert(!adminBody.owner_memory.artifacts.some((artifact) => artifact.path.endsWith(".env")), ".env files must be excluded.");
  assert(adminBody.owner_memory.safety_flags.admin_only === true, "Safety flag admin only.");
  assert(adminBody.owner_memory.safety_flags.client_visible === false, "Clients must not see owner memory.");
  assert(adminBody.owner_memory.safety_flags.env_files_excluded === true, "Env exclusion flag required.");
  assert(adminBody.owner_memory.safety_flags.provider_called === false, "No provider call.");
  assert(adminBody.owner_memory.safety_flags.network_call_performed === false, "No network call.");
  assert(adminBody.provider_called === false, "Route must not call provider.");
  assert(adminBody.network_call_performed === false, "Route must not perform network call.");
  assert(adminBody.credentials_returned === false, "Route must not return credentials.");

  const client = await app.inject({
    method: "GET",
    url: "/phantom-ai/admin/codex-memory/status",
    headers: { Authorization: `Bearer ${clientToken}` },
  });
  assert(client.statusCode === 403, "Client should be blocked from owner memory status.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        adminStatus: admin.statusCode,
        clientStatus: client.statusCode,
        artifacts: adminBody.owner_memory.artifacts.length,
        rawCodexInternalMemoryExposed: adminBody.owner_memory.access_model.raw_codex_internal_memory_exposed,
        providerCalled: adminBody.provider_called,
        networkCallPerformed: adminBody.network_call_performed,
      },
      null,
      2,
    ),
  );
} finally {
  await app.close();
  rmSync(tempDir, { recursive: true, force: true });
}
