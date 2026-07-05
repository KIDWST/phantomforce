function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function parseJson<T>(payload: string): T {
  return JSON.parse(payload) as T;
}

process.env.NODE_ENV = "development";
process.env.PHANTOMFORCE_SERVER_LISTEN = "false";
process.env.PHANTOMFORCE_SERVER_LOGGER = "false";
process.env.PHANTOMFORCE_AUTH_PROVIDER = "demo";
process.env.PHANTOMFORCE_ENABLE_DEMO_AUTH = "true";
process.env.PHANTOMFORCE_ALLOW_UNSIGNED_SESSION_HEADER = "false";

const { app } = await import("../src/index.js");

type LoginResponse = {
  ok: boolean;
  token: string;
};

type CrmResponse = {
  ok: boolean;
  crm: {
    business: "ChicagoShots";
    managed_by: "PhantomForce";
    workspace_id: "chicagoshots";
    source: {
      system: "NexProspex CRM";
      source_of_truth: string;
    };
    service_tier: {
      active_for_admin: string;
      client_tiers: Array<{ id: string; name: string }>;
    };
    summary: {
      contacts_total: number;
      organizations_total: number;
      verified_contacts: number;
      immediate_opportunities: number;
      follow_ups_due_or_ready: number;
      open_pipeline_value: number;
    };
    contacts: Array<{
      id: string;
      name: string;
      organization: string;
      readiness: string;
      pipeline_value: number;
    }>;
    organizations: Array<{ id: string; name: string }>;
    safety: {
      workspace_scoped: true;
      copied_into_repo: false;
      external_send: false;
      outreach_executed: false;
      source_data_mutated: false;
      credentials_returned: false;
    };
  };
  provider_called: false;
  network_call_performed: false;
  external_send: false;
  n8n_executed: false;
  approval_executed: false;
  queue_written: false;
  production_ledger_write: false;
  source_data_mutated: false;
  credentials_returned: false;
};

async function login(sessionId: string) {
  const response = await app.inject({
    method: "POST",
    url: "/auth/demo-login",
    headers: { "Content-Type": "application/json" },
    payload: JSON.stringify({ sessionId }),
  });
  assert(response.statusCode === 200, `${sessionId} demo login should succeed.`);
  return parseJson<LoginResponse>(response.payload).token;
}

try {
  const unauth = await app.inject({
    method: "GET",
    url: "/phantom-ai/ops/chicagoshots/nexprospex-crm?limit=5",
  });
  assert(unauth.statusCode === 401, "Unauthenticated CRM route should return 401.");

  const adminToken = await login("admin-jordan");
  const admin = await app.inject({
    method: "GET",
    url: "/phantom-ai/ops/chicagoshots/nexprospex-crm?limit=5",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert(admin.statusCode === 200, "Admin should view ChicagoShots CRM.");
  const adminBody = parseJson<CrmResponse>(admin.payload);
  assert(adminBody.ok === true, "Admin CRM response should be ok.");
  assert(adminBody.crm.business === "ChicagoShots", "CRM business should be ChicagoShots.");
  assert(adminBody.crm.managed_by === "PhantomForce", "CRM should show PhantomForce management.");
  assert(adminBody.crm.workspace_id === "chicagoshots", "CRM should be scoped to ChicagoShots.");
  assert(adminBody.crm.source.system === "NexProspex CRM", "CRM source should be NexProspex.");
  assert(adminBody.crm.summary.contacts_total > 0, "CRM should return contacts.");
  assert(adminBody.crm.summary.organizations_total > 0, "CRM should return organizations.");
  assert(adminBody.crm.contacts.length === 5, "Limit should cap returned contacts.");
  assert(adminBody.crm.contacts.every((contact) => contact.id && contact.name && contact.organization), "Contacts need useful fields.");
  assert(adminBody.crm.service_tier.client_tiers.some((tier) => tier.id === "basic"), "Basic tier should be described.");
  assert(adminBody.crm.service_tier.client_tiers.some((tier) => tier.id === "premiere"), "Premiere tier should be described.");
  assert(adminBody.crm.service_tier.client_tiers.some((tier) => tier.id === "elite"), "Elite tier should be described.");
  assert(adminBody.crm.safety.workspace_scoped === true, "CRM route must be workspace-scoped.");
  assert(adminBody.crm.safety.copied_into_repo === false, "CRM source data must not be copied into this repo.");
  assert(adminBody.external_send === false, "CRM route must not send externally.");
  assert(adminBody.provider_called === false, "CRM route must not call providers.");
  assert(adminBody.n8n_executed === false, "CRM route must not execute n8n.");
  assert(adminBody.queue_written === false, "CRM route must not write queues.");
  assert(adminBody.production_ledger_write === false, "CRM route must not write production ledgers.");
  assert(adminBody.source_data_mutated === false, "CRM route must not mutate NexProspex data.");
  assert(adminBody.credentials_returned === false, "CRM route must not return credentials.");

  const shotsToken = await login("client-chicagoshots");
  const shots = await app.inject({
    method: "GET",
    url: "/phantom-ai/ops/chicagoshots/nexprospex-crm?limit=3",
    headers: { Authorization: `Bearer ${shotsToken}` },
  });
  assert(shots.statusCode === 200, "ChicagoShots client should view its own CRM.");
  const shotsBody = parseJson<CrmResponse>(shots.payload);
  assert(shotsBody.crm.contacts.length === 3, "ChicagoShots client limit should work.");

  const sportsToken = await login("client-sports-demo");
  const sports = await app.inject({
    method: "GET",
    url: "/phantom-ai/ops/chicagoshots/nexprospex-crm?limit=3",
    headers: { Authorization: `Bearer ${sportsToken}` },
  });
  assert(sports.statusCode === 403, "Different client workspace must not view ChicagoShots CRM.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        unauthStatus: unauth.statusCode,
        adminStatus: admin.statusCode,
        chicagoShotsClientStatus: shots.statusCode,
        otherClientStatus: sports.statusCode,
        contactsTotal: adminBody.crm.summary.contacts_total,
        organizationsTotal: adminBody.crm.summary.organizations_total,
        returnedContacts: adminBody.crm.contacts.length,
        openPipelineValue: adminBody.crm.summary.open_pipeline_value,
        source: adminBody.crm.source.system,
        managedBy: adminBody.crm.managed_by,
        externalSend: adminBody.external_send,
        providerCalled: adminBody.provider_called,
        sourceDataMutated: adminBody.source_data_mutated,
      },
      null,
      2,
    ),
  );
} finally {
  await app.close();
}
