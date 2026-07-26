import assert from "node:assert/strict";

import {
  ensureRunning,
  isRunning,
  listRepos,
  terminaTokenFromEnv,
  terminaUrlFromEnv,
} from "../src/phantom-ai/termina-bridge.js";

const baseUrl = terminaUrlFromEnv();
const token = terminaTokenFromEnv();
assert(token, "TERMINA_TOKEN must be provided to the live client preflight.");
assert.equal(await isRunning(baseUrl, "definitely-invalid", 3_000), false);
await ensureRunning(baseUrl, token, 3_000);
const repos = await listRepos(baseUrl, token);

process.stdout.write(`${JSON.stringify({
  adapterAuthenticated: true,
  invalidTokenRejected: true,
  reposReturned: repos.length,
})}\n`);
