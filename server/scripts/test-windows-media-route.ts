function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

process.env.NODE_ENV = "development";
process.env.PHANTOMFORCE_SERVER_LISTEN = "false";
process.env.PHANTOMFORCE_SERVER_LOGGER = "false";
process.env.PHANTOMFORCE_AUTH_PROVIDER = "demo";
process.env.PHANTOMFORCE_ENABLE_DEMO_AUTH = "true";
process.env.PHANTOMFORCE_ALLOW_UNSIGNED_SESSION_HEADER = "false";

const { app } = await import("../src/index.js");

try {
  const unauthenticated = await app.inject({ method: "GET", url: "/phantom-ai/desktop-media/status" });
  assert(unauthenticated.statusCode === 401, "Desktop media status must require admin authentication.");

  const login = await app.inject({
    method: "POST",
    url: "/auth/demo-login",
    headers: { "Content-Type": "application/json" },
    payload: JSON.stringify({ sessionId: "admin-jordan" }),
  });
  assert(login.statusCode === 200, "Admin demo login should succeed.");
  const token = JSON.parse(login.payload).token as string;

  const status = await app.inject({
    method: "GET",
    url: "/phantom-ai/desktop-media/status",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(status.statusCode === 200, "Authenticated desktop media status should return 200.");
  const statusBody = JSON.parse(status.payload);
  assert(statusBody.media?.source === "windows_media_session", "Route should use Windows media sessions.");
  assert(statusBody.privacy?.playback_metadata_only === true, "Route should declare metadata-only scope.");
  assert(statusBody.privacy?.browser_history_read === false, "Route must not read browser history.");

  const rejected = await app.inject({
    method: "POST",
    url: "/phantom-ai/desktop-media/control",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    payload: JSON.stringify({ command: "launch" }),
  });
  assert(rejected.statusCode === 400, "Unsupported media commands must be rejected before execution.");

  console.log(JSON.stringify({
    ok: true,
    unauthenticated_status: unauthenticated.statusCode,
    authenticated_status: status.statusCode,
    helper_reachable: statusBody.media?.ok === true,
    session_count: statusBody.media?.sessions?.length ?? 0,
    unsupported_command_status: rejected.statusCode,
  }, null, 2));
} finally {
  await app.close();
}
