/* P3+P4 verification: approval-gated external execution on the ONE run
   engine, and the real website publishing pipeline (build → validate →
   approval → publish → verify → receipt → rollback) plus the DNS adapter's
   honest domain states. Runs against a live server started with
   PHANTOMFORCE_AUTH_PROVIDER=database and (for the expiry test)
   PHANTOM_RUN_APPROVAL_DEADLINE_MS=5000. */
const BASE = process.env.BASE ?? "http://127.0.0.1:5391";
const PASSWORD = "phantom-dev-password";
const ORG = "dev-org-chicagoshots";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${String(detail).slice(0, 160)}` : ""}`);
  ok ? pass++ : fail++;
};

async function api(path, { method = "GET", token, body, raw = false } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (raw) return { status: res.status, text: await res.text() };
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function login(email) {
  const { json } = await api("/auth/login", { method: "POST", body: { email, password: PASSWORD } });
  return json.token;
}

async function waitForRun(token, runId, timeoutMs = 15000) {
  const terminal = new Set(["completed", "succeeded", "partially_succeeded", "failed", "cancelled", "rejected", "expired"]);
  const deadline = Date.now() + timeoutMs;
  let run = null;
  while (Date.now() < deadline) {
    const { json } = await api(`/phantom-ai/runs/${runId}`, { token });
    run = json.run ?? run;
    if (run && terminal.has(run.state)) return run;
    await new Promise((r) => setTimeout(r, 500));
  }
  return run;
}

const jordan = await login("jordan@phantomforce.local");
const owner = await login("owner@chicagoshots.local");
const employee = await login("employee@chicagoshots.local");

/* make sure the org is on a publishing-capable plan */
await api(`/admin/orgs/${ORG}/plan`, { method: "POST", token: jordan, body: { planKey: "professional", status: "active", overrides: null, note: "test setup" } });
await new Promise((r) => setTimeout(r, 16000)); /* session entitlement cache */

/* ---- 1. build creation + validation ---- */
const snapshot = {
  title: "ChicagoShots Premium",
  sections: ["Hero", "Services", "Proof", "Contact"],
  design: { brand: "ChicagoShots", headline: "Premium Sports Media", subhead: "Recruitment videos that get athletes seen.", cta: "Book a shoot", theme: "gold" },
};
const build1 = await api(`/orgs/${ORG}/sites/builds`, { method: "POST", token: employee, body: snapshot });
check("employee can create a validated build", build1.status === 200 && build1.json.validated === true, build1.json.build?.status);
const siteId = build1.json.site?.id;
const buildId1 = build1.json.build?.id;
check("build log records real validation steps", (build1.json.buildLog || []).some((l) => l.includes("RESULT: validated")));

const preview = await api(`/orgs/${ORG}/sites/${siteId}/builds/${buildId1}/preview`, { token: employee, raw: true });
check("org member can preview the build HTML", preview.status === 200 && preview.text.includes("Premium Sports Media"));

const crossPreview = await api(`/orgs/dev-org-phantomforce/sites/${siteId}/builds/${buildId1}/preview`, { token: owner, raw: true });
check("preview is tenant-isolated (403 cross-org)", crossPreview.status === 403);

/* ---- 2. publishing requires approval; nothing live before it ---- */
const notLive = await api(`/public/sites/${siteId}`, { raw: true });
check("site NOT public before any approved publish", notLive.status === 404);

const pubReq = await api(`/orgs/${ORG}/sites/${siteId}/publish-request`, { method: "POST", token: employee, body: { buildId: buildId1 } });
check("publish request creates run awaiting_approval", pubReq.status === 200 && pubReq.json.run?.state === "awaiting_approval", pubReq.json.run?.state);
const runId1 = pubReq.json.run?.id;
check("run carries risk + requester + deadline", pubReq.json.run?.risk === "external_approval" && pubReq.json.run?.requested_by === "employee@chicagoshots.local" && !!pubReq.json.run?.approval_deadline);

const stillNotLive = await api(`/public/sites/${siteId}`, { raw: true });
check("still not live while awaiting approval", stillNotLive.status === 404);

const employeeApprove = await api(`/phantom-ai/runs/${runId1}/approve`, { method: "POST", token: employee, body: {} });
check("employee (member) CANNOT approve (403)", employeeApprove.status === 403);
const crossRunView = await api(`/phantom-ai/runs/${runId1}`, { token: await login("jordan@phantomforce.local") ? jordan : jordan });
check("super-admin can view the run", crossRunView.status === 200);

/* expiry: deadline is 5s on this server — leave run 1 untouched past it */
await new Promise((r) => setTimeout(r, 6500));
const expiredApprove = await api(`/phantom-ai/runs/${runId1}/approve`, { method: "POST", token: owner, body: {} });
check("approval past deadline is refused (expired)", expiredApprove.status === 409 && String(expiredApprove.json.error).includes("expired"), JSON.stringify(expiredApprove.json));
const expiredRun = await api(`/phantom-ai/runs/${runId1}`, { token: owner });
check("run state is expired", expiredRun.json.run?.state === "expired", expiredRun.json.run?.state);

/* ---- 3. approve within deadline → real deploy + receipt + verify ---- */
const pubReq2 = await api(`/orgs/${ORG}/sites/${siteId}/publish-request`, { method: "POST", token: employee, body: { buildId: buildId1 } });
const runId2 = pubReq2.json.run?.id;
const approve = await api(`/phantom-ai/runs/${runId2}/approve`, { method: "POST", token: owner, body: {} });
check("org owner approves the publish run", approve.status === 200);
const run2 = await waitForRun(owner, runId2);
check("run reaches succeeded with verification", run2?.state === "succeeded", run2?.state + " | " + (run2?.error || ""));
check("execution receipt records requester + approver + effect", run2?.receipt?.requested_by === "employee@chicagoshots.local" && run2?.receipt?.approved_by === "owner@chicagoshots.local" && !!run2?.receipt?.actual_effect);
check("receipt includes rollback guidance", !!run2?.receipt?.rollback_guidance);

const live = await api(`/public/sites/${siteId}`, { raw: true });
check("site is now PUBLIC at its PhantomForce-hosted URL", live.status === 200 && live.text.includes("Premium Sports Media"));

/* ---- 4. version 2 + rollback ---- */
const snapshot2 = { ...snapshot, siteId, design: { ...snapshot.design, headline: "Premium Sports Media — V2" } };
const build2 = await api(`/orgs/${ORG}/sites/builds`, { method: "POST", token: employee, body: snapshot2 });
const buildId2 = build2.json.build?.id;
const pubReq3 = await api(`/orgs/${ORG}/sites/${siteId}/publish-request`, { method: "POST", token: employee, body: { buildId: buildId2 } });
await api(`/phantom-ai/runs/${pubReq3.json.run.id}/approve`, { method: "POST", token: owner, body: {} });
const run3 = await waitForRun(owner, pubReq3.json.run.id);
check("v2 publish succeeds", run3?.state === "succeeded", run3?.error || "");
const liveV2 = await api(`/public/sites/${siteId}`, { raw: true });
check("public URL serves v2", liveV2.text.includes("V2"));

const rollbackDenied = await api(`/orgs/${ORG}/sites/${siteId}/rollback`, { method: "POST", token: employee, body: {} });
check("employee cannot roll back (403)", rollbackDenied.status === 403);
const rollback = await api(`/orgs/${ORG}/sites/${siteId}/rollback`, { method: "POST", token: owner, body: {} });
check("org owner rollback succeeds with receipt", rollback.status === 200 && !!rollback.json.deployment?.receipt?.rollback_of_deployment);
const liveV1 = await api(`/public/sites/${siteId}`, { raw: true });
check("public URL serves v1 again after rollback", liveV1.status === 200 && !liveV1.text.includes("V2"));

/* ---- 5. reject flow ---- */
const pubReq4 = await api(`/orgs/${ORG}/sites/${siteId}/publish-request`, { method: "POST", token: employee, body: { buildId: buildId2 } });
const reject = await api(`/phantom-ai/runs/${pubReq4.json.run.id}/reject`, { method: "POST", token: owner, body: { reason: "not ready" } });
check("org owner can reject with a recorded reason", reject.status === 200 && reject.json.run?.state === "rejected" && reject.json.run?.rejection_reason === "not ready");
const liveAfterReject = await api(`/public/sites/${siteId}`, { raw: true });
check("rejected publish changed nothing", !liveAfterReject.text.includes("V2"));

/* ---- 6. entitlement gate on publishing ---- */
await api(`/admin/orgs/${ORG}/plan`, { method: "POST", token: jordan, body: { planKey: "starter", status: "active", note: "publishing gate test" } });
const gated = await api(`/orgs/${ORG}/sites/${siteId}/publish-request`, { method: "POST", token: employee, body: { buildId: buildId2 } });
check("starter plan cannot request publishing (upgrade_required)", gated.status === 403 && gated.json.error === "upgrade_required", JSON.stringify(gated.json).slice(0, 100));

/* ---- 7. domains: honest states, never 'connected' by typing ---- */
const domainDeniedByPlan = await api(`/orgs/${ORG}/sites/${siteId}/domains`, { method: "POST", token: owner, body: { domain: "chicagoshots.example.com" } });
check("custom domains gated by plan (starter/professional lack it)", domainDeniedByPlan.status === 400 && domainDeniedByPlan.json.error === "feature_not_available", JSON.stringify(domainDeniedByPlan.json).slice(0, 100));
await api(`/admin/orgs/${ORG}/plan`, { method: "POST", token: jordan, body: { planKey: "elite", status: "active", note: "domain test" } });
const domainAdd = await api(`/orgs/${ORG}/sites/${siteId}/domains`, { method: "POST", token: owner, body: { domain: "definitely-not-registered-pf-test.example" } });
check("elite plan can add a domain; state starts verification_required", domainAdd.status === 200 && domainAdd.json.domain?.state === "verification_required");
check("domain add returns TXT instructions + token, no fake 'connected'", (domainAdd.json.domain?.instructions || "").includes("_phantomforce-verify"));
const verify = await api(`/orgs/${ORG}/sites/${siteId}/domains/${domainAdd.json.domain.id}/verify`, { method: "POST", token: owner, body: {} });
check("verification runs a REAL DNS check and does not claim verified", verify.status === 200 && verify.json.domain?.state !== "verified", `state=${verify.json.domain?.state}`);
const badDomain = await api(`/orgs/${ORG}/sites/${siteId}/domains`, { method: "POST", token: owner, body: { domain: "not a domain" } });
check("implausible domain rejected", badDomain.status === 400 && badDomain.json.error === "invalid_domain");

/* ---- 8. org run queue + restore plan ---- */
const queue = await api(`/orgs/${ORG}/runs`, { token: owner });
check("org run queue lists this org's runs only", queue.status === 200 && queue.json.runs?.every((r) => r.workspace === ORG) && queue.json.runs?.length >= 4);
const crossQueue = await api(`/orgs/dev-org-phantomforce/runs`, { token: owner });
check("cross-org run queue denied (403)", crossQueue.status === 403);
await api(`/admin/orgs/${ORG}/plan`, { method: "POST", token: jordan, body: { planKey: "professional", status: "active", overrides: null, note: "restore" } });

console.log(fail ? `${fail} FAILURES (${pass} passed)` : `ALL ${pass} PASS`);
process.exit(fail ? 1 : 0);
