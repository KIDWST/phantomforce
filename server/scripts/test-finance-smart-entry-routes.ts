function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}
function parseJson<T>(payload: string): T {
  return JSON.parse(payload) as T;
}

process.env.NODE_ENV = "development";
process.env.PHANTOMFORCE_SERVER_LISTEN = "false";
process.env.PHANTOMFORCE_SERVER_LOGGER = "false";
process.env.PHANTOMFORCE_AUTH_PROVIDER = "demo";
process.env.PHANTOMFORCE_ENABLE_DEMO_AUTH = "true";
process.env.PHANTOMFORCE_SKIP_SERVER_DOTENV = "true";
process.env.PHANTOMFORCE_ALLOW_UNSIGNED_SESSION_HEADER = "false";
process.env.PHANTOM_LIVE_PROVIDERS_ENABLED = "false"; // exercise the graceful-degrade path, no live network call in this test

const { app } = await import("../src/index.js");

type LoginResponse = { ok: boolean; token: string };

try {
  const adminLogin = await app.inject({
    method: "POST",
    url: "/auth/demo-login",
    headers: { "Content-Type": "application/json" },
    payload: JSON.stringify({ sessionId: "admin-jordan" }),
  });
  assert(adminLogin.statusCode === 200, "Admin demo login should succeed.");
  const adminToken = parseJson<LoginResponse>(adminLogin.payload).token;
  const headers = { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" };

  const unauthText = await app.inject({
    method: "POST",
    url: "/phantom-ai/ops/finance/parse-expense-text",
    headers: { "Content-Type": "application/json" },
    payload: JSON.stringify({ text: "$5 coffee" }),
  });
  assert(unauthText.statusCode === 401, "Unauthenticated text parse must return 401.");

  const textResult = await app.inject({
    method: "POST",
    url: "/phantom-ai/ops/finance/parse-expense-text",
    headers,
    payload: JSON.stringify({ text: "$500 every week since April" }),
  });
  assert(textResult.statusCode === 200, "A valid text parse must return 200.");
  const textBody = parseJson<{ ok: boolean; draft: { kind: string } }>(textResult.payload);
  assert(textBody.ok === true, "Text parse response must be ok.");
  assert(textBody.draft.kind === "recurring_rule", "A recurring phrase must produce a recurring_rule draft.");

  const badTextResult = await app.inject({
    method: "POST",
    url: "/phantom-ai/ops/finance/parse-expense-text",
    headers,
    payload: JSON.stringify({ text: "no money here" }),
  });
  assert(badTextResult.statusCode === 422, "Unparseable text must return 422.");

  const tinyPngDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const receiptResult = await app.inject({
    method: "POST",
    url: "/phantom-ai/ops/finance/parse-receipt",
    headers,
    payload: JSON.stringify({ image: tinyPngDataUrl, filename: "receipt.png" }),
  });
  assert(receiptResult.statusCode === 200, "A receipt upload must return 200 even when AI parsing is disabled.");
  const receiptBody = parseJson<{ ok: boolean; assetId: string | null; aiAvailable: boolean }>(receiptResult.payload);
  assert(receiptBody.ok === true, "Receipt upload response must be ok.");
  assert(typeof receiptBody.assetId === "string" && receiptBody.assetId.length > 0, "A stored receipt must return an assetId.");
  assert(receiptBody.aiAvailable === false, "AI must report unavailable when live providers are disabled.");

  const fetchResult = await app.inject({
    method: "GET",
    url: `/phantom-ai/ops/finance/receipt/${receiptBody.assetId}`,
    headers,
  });
  assert(fetchResult.statusCode === 200, "Fetching a just-stored receipt must return 200.");

  console.log(JSON.stringify({ ok: true, suite: "finance-smart-entry-routes" }));
} finally {
  await app.close();
}
