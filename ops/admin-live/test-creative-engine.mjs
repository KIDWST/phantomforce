#!/usr/bin/env node
/* Creative Engine transport tests — run with: node ops/admin-live/test-creative-engine.mjs
   Spins the REAL admin-static-server against a stub Hermes and a canary
   `higgsfield` CLI shim. Proves:
   - status prefers Hermes/MCP and never generates during preflight
   - default config routes briefs through Hermes and NEVER touches the CLI
   - Hermes down => honest blocked, not fake success, no silent CLI fallback
   - CLI lane requires HIGGSFIELD_CLI_FALLBACK_ENABLED=true AND approved:true */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const results = [];
const ok = (name, pass, note = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${note ? " — " + note : ""}`);
};

/* canary CLI: writes a marker file if ANY test path ever executes it */
const binDir = mkdtempSync(path.join(tmpdir(), "pf-ce-bin-"));
const marker = path.join(binDir, "cli-was-called");
writeFileSync(path.join(binDir, "higgsfield"), `#!/usr/bin/env bash
echo "called: $@" >> "${marker}"
if [ "$1" = "--version" ]; then echo "higgsfield test-shim"; exit 0; fi
echo '{"id":"cli-job","status":"completed","result_url":"https://cdn.example/cli-render.png"}'
`);
chmodSync(path.join(binDir, "higgsfield"), 0o755);
/* count RENDER invocations only — `--version` preflights are read-only and allowed */
const cliCalls = () => (existsSync(marker)
  ? readFileSync(marker, "utf8").split("\n").filter((line) => line.includes("generate create")).length
  : 0);

/* stub Hermes: /session validates any bearer, status + draft succeed */
let hermesDraftHits = 0;
const hermes = createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.url === "/session") { res.end(JSON.stringify({ session: { canManageAccess: true, id: "s1" } })); return; }
  if (req.url === "/phantom-ai/media-lab/higgsfield/status") {
    res.end(JSON.stringify({ ok: true, phantomcut: { reachable: true, base_url: "http://127.0.0.1:8787" } }));
    return;
  }
  if (req.url === "/phantom-ai/media-lab/higgsfield/draft" && req.method === "POST") {
    hermesDraftHits += 1;
    res.end(JSON.stringify({ ok: true, draft: { id: "hf-draft-1", status: "queued" }, safety: { paid_job_called: false } }));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ message: "Route not found", statusCode: 404 }));
});
await new Promise((r) => hermes.listen(0, "127.0.0.1", r));
const hermesPort = hermes.address().port;

const servers = [];
async function startBackend(env = {}) {
  const port = 42000 + Math.floor(Math.random() * 2000);
  const child = spawn(process.execPath, [
    path.join(__dirname, "admin-static-server.mjs"),
    "--port", String(port), "--host", "127.0.0.1",
    "--api", `http://127.0.0.1:${hermesPort}`,
  ], { env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, ...env }, stdio: "ignore" });
  servers.push(child);
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 150));
    try { const r = await fetch(`http://127.0.0.1:${port}/health`); if (r.ok) break; } catch {}
  }
  return { port, child };
}
const j = (r) => r.json();
const AUTH = { Authorization: "Bearer test", "Content-Type": "application/json" };
const brief = { prompt: "a red fox in the snow", modality: "image", params: { count: 1 }, async: true };

/* ---- A. default config: Hermes primary, CLI untouched ---- */
{
  const { port } = await startBackend();
  const status = await j(await fetch(`http://127.0.0.1:${port}/api/creative-engine/status`, { headers: AUTH }));
  ok("status prefers Hermes/MCP", status.transport === "hermes_mcp" && status.status === "connected", status.message);
  ok("status: tools visible through Hermes", status.hermes.reachable === true && status.higgsfield.availableThroughHermes === true);
  ok("status: CLI fallback disabled by default", status.cliFallbackEnabled === false);
  ok("status: approval always required", status.approvalRequired === true);
  ok("preflight performed zero renders", hermesDraftHits === 0 && cliCalls() === 0, `drafts=${hermesDraftHits} cli=${cliCalls()}`);

  const gen = await j(await fetch(`http://127.0.0.1:${port}/generate`, { method: "POST", headers: AUTH, body: JSON.stringify(brief) }));
  ok("brief routes through Hermes (queued draft)", gen.ok === true && gen.transport === "hermes_mcp" && gen.status === "queued", JSON.stringify(gen).slice(0, 90));
  ok("Hermes lane spends no credits", gen.safety?.paid_job_called === false && gen.approvalRequired === true);
  ok("job is tracked with transport", (await j(await fetch(`http://127.0.0.1:${port}/generate/job/${gen.job}`, { headers: AUTH }))).transport === "hermes_mcp");
  ok("CLI never invoked on the Hermes lane", cliCalls() === 0, `cli calls: ${cliCalls()}`);
}

/* ---- B. Hermes down: honest blocked, no fake success, no silent CLI ---- */
{
  const { port } = await startBackend({ HERMES_BASE_URL: "http://127.0.0.1:9" });
  const status = await j(await fetch(`http://127.0.0.1:${port}/api/creative-engine/status`, { headers: AUTH }));
  ok("Hermes down => not_configured (not fake ok)", status.status === "not_configured" && /Blocked/.test(status.message), status.message.slice(0, 70));
  const gen = await j(await fetch(`http://127.0.0.1:${port}/generate`, { method: "POST", headers: AUTH, body: JSON.stringify(brief) }));
  ok("Hermes down => generate returns blocked", gen.blocked === true && /Blocked/.test(gen.message), (gen.message || "").slice(0, 70));
  ok("no silent CLI fallback", cliCalls() === 0, `cli calls: ${cliCalls()}`);
}

/* ---- C. CLI fallback: needs the env flag AND explicit approval ---- */
{
  const { port } = await startBackend({ HERMES_BASE_URL: "http://127.0.0.1:9", HIGGSFIELD_CLI_FALLBACK_ENABLED: "true" });
  const noApproval = await j(await fetch(`http://127.0.0.1:${port}/generate`, { method: "POST", headers: AUTH, body: JSON.stringify(brief) }));
  ok("CLI lane demands approval", noApproval.error === "approval_required" && /Approve render\?/.test(noApproval.message), noApproval.message);
  ok("no render happened without approval", cliCalls() === 0);
  const approvedRes = await j(await fetch(`http://127.0.0.1:${port}/generate`, { method: "POST", headers: AUTH, body: JSON.stringify({ ...brief, async: false, approved: true }) }));
  ok("approved CLI fallback renders", Array.isArray(approvedRes.assets) && approvedRes.assets.length === 1 && approvedRes.live === true, JSON.stringify(approvedRes.assets?.[0]?.url || ""));
  ok("CLI ran exactly for the approved render", cliCalls() >= 1);
}

/* ---- D. transport disabled: everything blocked ---- */
{
  const { port } = await startBackend({ CREATIVE_ENGINE_TRANSPORT: "disabled" });
  const status = await j(await fetch(`http://127.0.0.1:${port}/api/creative-engine/status`, { headers: AUTH }));
  const gen = await j(await fetch(`http://127.0.0.1:${port}/generate`, { method: "POST", headers: AUTH, body: JSON.stringify(brief) }));
  ok("disabled transport is honest end to end", status.status === "not_configured" && gen.blocked === true && /disabled/i.test(gen.message));
}

servers.forEach((s) => { try { s.kill(); } catch {} });
hermes.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
