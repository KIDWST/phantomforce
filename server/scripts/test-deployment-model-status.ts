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

type DeploymentStatusResponse = {
  ok: true;
  read_only: true;
  deployment_model: {
    audience: "admin" | "client";
    model: "cloud_app_with_optional_local_connector";
    user_facing_product: "PhantomForce";
    user_facing_ai: "PhantomAI";
    normal_user_surface: "hosted_web_app";
    desktop_companion_role: "optional_local_connector";
    source_code_exposed_to_users: false;
    repo_access_required_for_users: false;
    users_can_modify_product_files: false;
    customer_traffic_should_route_through_jordan_pc: false;
    current_jordan_windows_host_role: "admin_pilot_and_private_connector_only";
    internal_tool_names_hidden_from_clients: true;
    local_connector: {
      customer_owned: true;
      outbound_only?: true;
      raw_files_uploaded_by_default: false;
      source_code_shipped?: false;
    };
    client_copy_resistance?: string[];
    admin_operating_rules?: string[];
    hidden_capabilities?: string[];
    safety_flags?: {
      read_only_status: true;
      provider_called: false;
      external_network_call_performed: false;
      deployment_changed: false;
      credential_read: false;
      customer_data_mutated: false;
    };
  };
};

type OpsStatusResponse = {
  ok: true;
  read_only: true;
  status: {
    deployment_model: DeploymentStatusResponse["deployment_model"];
  };
};

try {
  const unauth = await app.inject({
    method: "GET",
    url: "/phantom-ai/deployment/model/status",
  });
  assert(unauth.statusCode === 401, "Unauthenticated deployment model status should return 401.");

  const adminLogin = await app.inject({
    method: "POST",
    url: "/auth/demo-login",
    headers: { "Content-Type": "application/json" },
    payload: JSON.stringify({ sessionId: "admin-jordan" }),
  });
  assert(adminLogin.statusCode === 200, "Admin login should succeed.");
  const adminToken = parseJson<LoginResponse>(adminLogin.payload).token;
  const adminHeaders = { Authorization: `Bearer ${adminToken}` };

  const adminStatus = await app.inject({
    method: "GET",
    url: "/phantom-ai/deployment/model/status",
    headers: adminHeaders,
  });
  assert(adminStatus.statusCode === 200, "Admin deployment model status should return 200.");
  const adminBody = parseJson<DeploymentStatusResponse>(adminStatus.payload);
  const adminModel = adminBody.deployment_model;

  assert(adminBody.read_only === true, "Deployment model route must be read-only.");
  assert(adminModel.audience === "admin", "Admin should receive admin deployment model.");
  assert(adminModel.model === "cloud_app_with_optional_local_connector", "Architecture must be cloud + connector.");
  assert(adminModel.normal_user_surface === "hosted_web_app", "Normal users should use hosted app.");
  assert(adminModel.desktop_companion_role === "optional_local_connector", "Desktop app should be connector only.");
  assert(adminModel.source_code_exposed_to_users === false, "Source code must not be exposed to users.");
  assert(adminModel.repo_access_required_for_users === false, "Users must not need repo access.");
  assert(adminModel.users_can_modify_product_files === false, "Users must not modify product files.");
  assert(
    adminModel.customer_traffic_should_route_through_jordan_pc === false,
    "Customer traffic must not be designed around Jordan PC.",
  );
  assert(
    adminModel.current_jordan_windows_host_role === "admin_pilot_and_private_connector_only",
    "Jordan PC should be pilot/private connector only.",
  );
  assert(adminModel.internal_tool_names_hidden_from_clients === true, "Tool names must stay hidden from clients.");
  assert(adminModel.local_connector.customer_owned === true, "Local connector must be customer-owned.");
  assert(adminModel.local_connector.source_code_shipped === false, "Connector must not ship source code.");
  assert(adminModel.client_copy_resistance?.length >= 4, "Admin should see copy-resistance plan.");
  assert(adminModel.admin_operating_rules?.length >= 4, "Admin should see operating rules.");
  assert(adminModel.safety_flags?.read_only_status === true, "Admin status must be read-only.");
  assert(adminModel.safety_flags?.provider_called === false, "Status must not call providers.");
  assert(adminModel.safety_flags?.deployment_changed === false, "Status must not change deployment.");
  assert(adminModel.safety_flags?.credential_read === false, "Status must not read credentials.");

  const clientLogin = await app.inject({
    method: "POST",
    url: "/auth/demo-login",
    headers: { "Content-Type": "application/json" },
    payload: JSON.stringify({ sessionId: "client-sports-demo" }),
  });
  assert(clientLogin.statusCode === 200, "Client login should succeed.");
  const clientToken = parseJson<LoginResponse>(clientLogin.payload).token;

  const clientStatus = await app.inject({
    method: "GET",
    url: "/phantom-ai/deployment/model/status",
    headers: { Authorization: `Bearer ${clientToken}` },
  });
  assert(clientStatus.statusCode === 200, "Client deployment model status should return 200.");
  const clientBody = parseJson<DeploymentStatusResponse>(clientStatus.payload);
  const clientPayload = clientStatus.payload;
  const clientModel = clientBody.deployment_model;

  assert(clientModel.audience === "client", "Client should receive client deployment model.");
  assert(clientModel.hidden_capabilities?.includes("source code"), "Client should be told source code is hidden.");
  assert(!clientPayload.includes("Codex"), "Client payload must not expose Codex.");
  assert(!clientPayload.includes("Claude"), "Client payload must not expose Claude.");
  assert(!clientPayload.includes("OpenRouter"), "Client payload must not expose OpenRouter.");
  assert(!clientPayload.includes("n8n"), "Client payload must not expose n8n.");
  assert(!clientPayload.includes("provider routing"), "Client payload should avoid provider routing detail outside hidden capabilities.");

  const opsStatus = await app.inject({
    method: "GET",
    url: "/phantom-ai/ops/status",
    headers: adminHeaders,
  });
  assert(opsStatus.statusCode === 200, "Ops status should return 200.");
  const opsBody = parseJson<OpsStatusResponse>(opsStatus.payload);
  assert(
    opsBody.status.deployment_model.model === "cloud_app_with_optional_local_connector",
    "Ops status should include deployment model.",
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        unauthStatus: unauth.statusCode,
        adminStatus: adminStatus.statusCode,
        clientStatus: clientStatus.statusCode,
        opsStatus: opsStatus.statusCode,
        model: adminModel.model,
        normalUserSurface: adminModel.normal_user_surface,
        desktopCompanionRole: adminModel.desktop_companion_role,
        sourceCodeExposed: adminModel.source_code_exposed_to_users,
        customerTrafficThroughJordanPc: adminModel.customer_traffic_should_route_through_jordan_pc,
      },
      null,
      2,
    ),
  );
} finally {
  await app.close();
}
