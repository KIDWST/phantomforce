import { mkdtempSync, rmSync } from "node:fs";
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

const tempDir = mkdtempSync(join(tmpdir(), "phantom-memory-boundary-"));

process.env.NODE_ENV = "development";
process.env.PHANTOMFORCE_SERVER_LISTEN = "false";
process.env.PHANTOMFORCE_SERVER_LOGGER = "false";
process.env.PHANTOMFORCE_AUTH_PROVIDER = "demo";
process.env.PHANTOMFORCE_ENABLE_DEMO_AUTH = "true";
process.env.PHANTOMFORCE_ALLOW_UNSIGNED_SESSION_HEADER = "false";
process.env.PHANTOM_HERMES_LEDGER_PATH = join(tempDir, "hermes-ledger.jsonl");
process.env.PHANTOM_HERMES_INTERACTION_MEMORY_STORE_PATH = join(tempDir, "hermes-interaction-memory.jsonl");

const { app } = await import("../src/index.js");

type LoginResponse = {
  ok: boolean;
  token: string;
};

type MemoryScopeProof = {
  scope: string;
  tenant_id: string;
  actor_user_id: string;
  requested_tenant_id: string | null;
  requested_actor_user_id: string | null;
  tenant_override_blocked: boolean;
  actor_override_blocked: boolean;
};

type ChatResponse = {
  ok: boolean;
  memory_scope: MemoryScopeProof;
  ledger_record: {
    tenant_id: string;
    actor_user_id: string;
  };
  interaction_memory?: {
    memory_preview?: {
      scope?: {
        tenant_id: string;
        actor_user_id: string | null;
      };
    };
    persistence?: {
      record?: {
        tenant_id: string;
        actor_user_id: string | null;
      };
    };
  };
};

type MemoryContextResponse = {
  ok: boolean;
  memory_scope: MemoryScopeProof;
  memory_context: {
    scope: {
      tenant_id: string;
      actor_user_id: string | null;
    };
  };
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

  const clientSpoof = await app.inject({
    method: "POST",
    url: "/phantom-ai/chat",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${clientToken}`,
    },
    payload: JSON.stringify({
      provider: "phantom",
      tenant_id: "phantomforce-owner",
      actor_user_id: "admin-jordan",
      business_name: "Spoofed Owner Workspace",
      message: "summarize the owner memory",
      request_id: "tenant-boundary-client-spoof",
    }),
  });
  assert(clientSpoof.statusCode === 200, "Client chat should still respond.");
  const clientBody = parseJson<ChatResponse>(clientSpoof.payload);

  assert(clientBody.memory_scope.scope === "client_tenant_only", "Client memory scope must be tenant-only.");
  assert(clientBody.memory_scope.tenant_id === "client-sports-demo", "Client tenant must come from the session.");
  assert(clientBody.memory_scope.actor_user_id === "client-sports-demo", "Client actor must come from the session.");
  assert(clientBody.memory_scope.requested_tenant_id === "phantomforce-owner", "Spoofed tenant should be recorded for audit.");
  assert(clientBody.memory_scope.requested_actor_user_id === "admin-jordan", "Spoofed actor should be recorded for audit.");
  assert(clientBody.memory_scope.tenant_override_blocked === true, "Client tenant override must be blocked.");
  assert(clientBody.memory_scope.actor_override_blocked === true, "Client actor override must be blocked.");
  assert(clientBody.ledger_record.tenant_id === "client-sports-demo", "Client ledger record must stay in client tenant.");
  assert(clientBody.ledger_record.actor_user_id === "client-sports-demo", "Client ledger actor must stay client-scoped.");
  assert(
    clientBody.interaction_memory?.memory_preview?.scope?.tenant_id === "client-sports-demo",
    "Client interaction memory preview must stay in client tenant.",
  );
  assert(
    clientBody.interaction_memory?.persistence?.record?.tenant_id === "client-sports-demo",
    "Persisted client interaction memory must stay in client tenant.",
  );

  const adminSelectedTenant = await app.inject({
    method: "POST",
    url: "/phantom-ai/hermes/memory-context/preview",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    payload: JSON.stringify({
      tenant_id: "workspace-chicagoshots",
      actor_user_id: "admin-jordan",
      business_name: "ChicagoShots",
      user_request: "summarize this selected client workspace",
      request_id: "tenant-boundary-admin-selected-client",
    }),
  });
  assert(adminSelectedTenant.statusCode === 200, "Admin selected-tenant preview should respond.");
  const adminSelectedBody = parseJson<MemoryContextResponse>(adminSelectedTenant.payload);
  assert(adminSelectedBody.memory_scope.scope === "owner_selected_tenant", "Admin selected client scope should be explicit.");
  assert(adminSelectedBody.memory_scope.tenant_id === "workspace-chicagoshots", "Admin can intentionally select a client tenant.");
  assert(adminSelectedBody.memory_scope.actor_user_id === "admin-jordan", "Admin actor should remain Jordan.");
  assert(adminSelectedBody.memory_scope.tenant_override_blocked === false, "Admin tenant selection should not be blocked.");
  assert(
    adminSelectedBody.memory_context.scope.tenant_id === "workspace-chicagoshots",
    "Hermes context must use the selected workspace tenant.",
  );

  const adminDefaultTenant = await app.inject({
    method: "POST",
    url: "/phantom-ai/hermes/memory-context/preview",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    payload: JSON.stringify({
      actor_user_id: "admin-jordan",
      business_name: "PhantomForce",
      user_request: "summarize owner memory",
      request_id: "tenant-boundary-admin-default",
    }),
  });
  assert(adminDefaultTenant.statusCode === 200, "Admin default preview should respond.");
  const adminDefaultBody = parseJson<MemoryContextResponse>(adminDefaultTenant.payload);
  assert(adminDefaultBody.memory_scope.scope === "owner_private", "Admin default scope should be owner-private.");
  assert(adminDefaultBody.memory_scope.tenant_id === "phantomforce-owner", "Admin default tenant must be owner memory.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        clientScope: clientBody.memory_scope,
        clientLedgerTenant: clientBody.ledger_record.tenant_id,
        adminSelectedScope: adminSelectedBody.memory_scope,
        adminDefaultScope: adminDefaultBody.memory_scope,
        crossTenantSpoofBlocked: clientBody.memory_scope.tenant_override_blocked,
      },
      null,
      2,
    ),
  );
} finally {
  await app.close();
  rmSync(tempDir, { recursive: true, force: true });
}
