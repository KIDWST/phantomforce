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

type ImageToolchainResponse = {
  ok: true;
  admin_access: boolean;
  image_toolchain: {
    summary: {
      connectors_total?: number;
      visible_connectors?: number;
      active_or_available: number;
      browser_tools_active?: number;
      local_cli_available?: number;
      provider_bridges_gated?: number;
    };
    connectors: Array<{
      id: string;
      label: string;
      kind?: string;
      state: string;
      detected_path?: string | null;
      admin_only?: boolean;
      user_visible?: boolean;
    }>;
    details_redacted?: boolean;
    safety_flags: {
      status_only: true;
      provider_called: false;
      paid_job_called: false;
      upload_performed: false;
      external_send_performed: false;
      credentials_read: false;
      destructive_action: false;
    };
  };
};

try {
  const unauth = await app.inject({
    method: "GET",
    url: "/phantom-ai/media-lab/image-toolchain/status",
  });
  assert(unauth.statusCode === 401, "Unauthenticated image toolchain status should return 401.");

  const adminLogin = await app.inject({
    method: "POST",
    url: "/auth/demo-login",
    headers: { "Content-Type": "application/json" },
    payload: JSON.stringify({ sessionId: "admin-jordan" }),
  });
  assert(adminLogin.statusCode === 200, "Admin demo login should succeed.");
  const adminToken = parseJson<LoginResponse>(adminLogin.payload).token;

  const adminStatus = await app.inject({
    method: "GET",
    url: "/phantom-ai/media-lab/image-toolchain/status",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert(adminStatus.statusCode === 200, "Admin image toolchain status should return 200.");
  const adminBody = parseJson<ImageToolchainResponse>(adminStatus.payload);
  assert(adminBody.admin_access === true, "Admin should receive full toolchain view.");
  assert((adminBody.image_toolchain.summary.connectors_total ?? 0) >= 10, "Admin should see the expanded connector stack.");
  assert((adminBody.image_toolchain.summary.browser_tools_active ?? 0) >= 4, "Browser image tools should be active.");
  assert(adminBody.image_toolchain.connectors.some((tool) => tool.id === "rembg"), "rembg connector should be represented.");
  assert(adminBody.image_toolchain.connectors.some((tool) => tool.id === "ffmpeg"), "ffmpeg connector should be represented.");
  assert(adminBody.image_toolchain.connectors.some((tool) => tool.id === "higgsfield-image-bridge" && tool.state === "gated"), "Paid provider bridge must be gated.");
  assert(adminBody.image_toolchain.safety_flags.status_only === true, "Toolchain route must be status-only.");
  assert(adminBody.image_toolchain.safety_flags.provider_called === false, "Toolchain route must not call providers.");
  assert(adminBody.image_toolchain.safety_flags.upload_performed === false, "Toolchain route must not upload.");
  assert(adminBody.image_toolchain.safety_flags.credentials_read === false, "Toolchain route must not read credentials.");

  const clientLogin = await app.inject({
    method: "POST",
    url: "/auth/demo-login",
    headers: { "Content-Type": "application/json" },
    payload: JSON.stringify({ sessionId: "client-sports-demo" }),
  });
  assert(clientLogin.statusCode === 200, "Client demo login should succeed.");
  const clientToken = parseJson<LoginResponse>(clientLogin.payload).token;

  const clientStatus = await app.inject({
    method: "GET",
    url: "/phantom-ai/media-lab/image-toolchain/status",
    headers: { Authorization: `Bearer ${clientToken}` },
  });
  assert(clientStatus.statusCode === 200, "Client image toolchain status should return 200.");
  const clientBody = parseJson<ImageToolchainResponse>(clientStatus.payload);
  assert(clientBody.admin_access === false, "Client should not receive admin view.");
  assert(clientBody.image_toolchain.details_redacted === true, "Client toolchain details should be redacted.");
  assert(
    clientBody.image_toolchain.connectors.every((tool) => !tool.detected_path && tool.admin_only !== true),
    "Client must not see local executable paths or admin-only connectors.",
  );

  console.log(JSON.stringify({
    ok: true,
    adminConnectors: adminBody.image_toolchain.summary.connectors_total,
    browserToolsActive: adminBody.image_toolchain.summary.browser_tools_active,
    localCliAvailable: adminBody.image_toolchain.summary.local_cli_available,
    clientVisibleConnectors: clientBody.image_toolchain.summary.visible_connectors,
    providerCalled: adminBody.image_toolchain.safety_flags.provider_called,
    uploadPerformed: adminBody.image_toolchain.safety_flags.upload_performed,
  }, null, 2));
} finally {
  await app.close();
}
