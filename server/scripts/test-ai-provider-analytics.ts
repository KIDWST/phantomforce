import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getAiProviderUsageSummary,
  getConfiguredAiProviderAccountSnapshots,
  recordAiProviderUsage,
} from "../src/phantom-ai/ai-provider-analytics.js";
import { saveAiProviderCredential } from "../src/phantom-ai/ai-provider-credentials.js";

const analyticsRoot = await mkdtemp(join(tmpdir(), "phantom-ai-analytics-test-"));
const credentialRoot = await mkdtemp(join(tmpdir(), "phantom-ai-analytics-credentials-test-"));
const credentialEnv = { PHANTOMFORCE_AI_CREDENTIALS_SECRET: "analytics-test-only-encryption-secret" };
const tenantId = "analytics-org";
const deepSeekCredential = "sk-test-deepseek-analytics-1234567890";
const openRouterCredential = "sk-or-test-analytics-1234567890";

try {
  await saveAiProviderCredential({
    tenantId,
    providerId: "deepseek_api",
    credential: deepSeekCredential,
    actor: "analytics-test",
    root: credentialRoot,
    env: credentialEnv,
  });

  const deepSeekUrls: string[] = [];
  const deepSeekOnly = await getConfiguredAiProviderAccountSnapshots(tenantId, {
    force: true,
    credentialRoot,
    credentialEnv,
    fetchImpl: (async (url: string | URL) => {
      deepSeekUrls.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          is_available: true,
          balance_infos: [{ currency: "USD", total_balance: "12.50", granted_balance: "2.50", topped_up_balance: "10.00" }],
        }),
      } as Response;
    }) as typeof fetch,
  });
  assert.deepEqual(deepSeekUrls, ["https://api.deepseek.com/user/balance"]);
  assert.equal(deepSeekOnly.length, 1, "Only configured providers may appear in account analytics.");
  assert.equal(deepSeekOnly[0]?.provider_id, "deepseek_api");
  assert.equal(deepSeekOnly[0]?.status, "up");
  assert.equal(deepSeekOnly[0]?.account.balances[0]?.total, 12.5);

  await saveAiProviderCredential({
    tenantId,
    providerId: "openrouter_glm",
    credential: openRouterCredential,
    actor: "analytics-test",
    root: credentialRoot,
    env: credentialEnv,
  });

  const authorizations: string[] = [];
  const bothProviders = await getConfiguredAiProviderAccountSnapshots(tenantId, {
    force: true,
    credentialRoot,
    credentialEnv,
    fetchImpl: (async (url: string | URL, init?: RequestInit) => {
      authorizations.push(String((init?.headers as Record<string, string>)?.Authorization || ""));
      if (String(url).includes("openrouter.ai")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { usage: 4.25, limit: 20, limit_remaining: 15.75, is_free_tier: false } }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ is_available: true, balance_infos: [{ currency: "USD", total_balance: "12.50" }] }),
      } as Response;
    }) as typeof fetch,
  });
  assert.equal(bothProviders.length, 2);
  assert.ok(authorizations.includes(`Bearer ${deepSeekCredential}`));
  assert.ok(authorizations.includes(`Bearer ${openRouterCredential}`));
  const openRouter = bothProviders.find((provider) => provider.provider_id === "openrouter_glm");
  assert.equal(openRouter?.account.spent_amount, 4.25);
  assert.equal(openRouter?.account.limit_amount, 20);
  assert.equal(openRouter?.account.remaining_amount, 15.75);
  assert.doesNotMatch(JSON.stringify(bothProviders), /sk-(?:or-)?test/u, "Account snapshots must never return credentials.");

  await recordAiProviderUsage({
    tenantId,
    requestId: "request-success",
    surface: "platform",
    providerId: "openrouter_glm",
    modelId: "deepseek/deepseek-chat",
    status: "called",
    usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
    root: analyticsRoot,
  });
  await recordAiProviderUsage({
    tenantId,
    requestId: "request-failed",
    surface: "phantombot",
    providerId: "deepseek_api",
    modelId: "deepseek-chat",
    status: "error",
    usage: null,
    root: analyticsRoot,
  });

  const summary = await getAiProviderUsageSummary(tenantId, 30, analyticsRoot);
  assert.equal(summary.totals.attempts, 2);
  assert.equal(summary.totals.successful_requests, 1);
  assert.equal(summary.totals.prompt_tokens, 120);
  assert.equal(summary.totals.completion_tokens, 30);
  assert.equal(summary.totals.total_tokens, 150);

  const ledger = await readFile(join(analyticsRoot, "usage", `${tenantId}.ndjson`), "utf8");
  assert.doesNotMatch(ledger, new RegExp(deepSeekCredential, "u"));
  assert.doesNotMatch(ledger, new RegExp(openRouterCredential, "u"));
  assert.doesNotMatch(ledger, /"(?:prompt|response|message|content)"\s*:/i, "The usage ledger must contain metrics only, not conversation content.");

  console.log("AI provider analytics checks passed.");
} finally {
  await Promise.all([
    rm(analyticsRoot, { recursive: true, force: true }),
    rm(credentialRoot, { recursive: true, force: true }),
  ]);
}
