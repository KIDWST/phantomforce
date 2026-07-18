/* Live API verification for org-scoped Easy CRM:
   signup/login -> settings -> contact CRUD with socials/avatar data -> org isolation. */

const BASE = process.env.BASE ?? "http://127.0.0.1:5392";
const DEV_ADMIN_PASSWORD = process.env.PHANTOMFORCE_EASY_CRM_DEV_PASSWORD ?? "phantom-dev-password";
const runId = Date.now().toString(36);

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail.slice(0, 180)}` : ""}`);
  ok ? pass++ : fail++;
}

async function api(path: string, options: { method?: string; token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, json };
}

let devAdminToken = "";

async function ensureWritableTestPlan(orgId: string, prefix: string) {
  if (!devAdminToken) {
    const adminLogin = await api("/auth/login", {
      method: "POST",
      body: { email: "jordan@phantomforce.local", password: DEV_ADMIN_PASSWORD },
    });
    check("test super-admin login returns token", adminLogin.status === 200 && adminLogin.json.token, JSON.stringify(adminLogin.json));
    if (!adminLogin.json.token) throw new Error("Easy CRM test could not obtain the seeded test super-admin session.");
    devAdminToken = adminLogin.json.token as string;
  }

  const plan = await api(`/admin/orgs/${orgId}/plan`, {
    method: "POST",
    token: devAdminToken,
    body: { planKey: "professional", status: "active", note: "isolated Easy CRM verification" },
  });
  check(`${prefix} receives writable test plan through admin API`, plan.status === 200 && plan.json.entitlements?.planKey === "professional" && plan.json.entitlements?.effectiveStatus === "active", JSON.stringify(plan.json));
  if (!plan.ok) throw new Error(`${prefix} test plan assignment failed.`);
}

async function signupAndLogin(prefix: string) {
  const email = `${prefix}-${runId}@phantomforce.local`;
  const username = `${prefix}_${runId}`;
  const password = `${prefix}-password-123`;
  const signup = await api("/auth/signup", {
    method: "POST",
    body: { email, username, password, name: `${prefix} CRM Test`, organizationName: `${prefix} Org` },
  });
  check(`${prefix} signup creates isolated org`, signup.status === 200 && signup.json.orgId, JSON.stringify(signup.json));
  if (!signup.json.orgId) throw new Error(`${prefix} signup did not return a usable organization.`);
  await ensureWritableTestPlan(signup.json.orgId as string, prefix);
  const login = await api("/auth/login", { method: "POST", body: { email: username, password } });
  check(`${prefix} login returns token`, login.status === 200 && login.json.token && login.json.session?.orgId, JSON.stringify(login.json));
  if (!login.json.token || !login.json.session?.orgId) throw new Error(`${prefix} login did not return a usable database session.`);
  return { token: login.json.token as string, orgId: login.json.session.orgId as string };
}

const primary = await signupAndLogin("crmprimary");

const settings = await api(`/orgs/${primary.orgId}/crm/settings`, {
  method: "POST",
  token: primary.token,
  body: { dailyPullTarget: 20, sourceMode: "daily", notes: "pull 20 new clients per day", brain: { kind: "phantomforce_org_crm_brain", lastNaturalCommand: "pull 20 new clients per day" } },
});
check("daily pull setting and hidden org brain persist", settings.status === 200 && settings.json.settings?.dailyPullTarget === 20 && settings.json.settings?.brain?.lastNaturalCommand, JSON.stringify(settings.json));

const pull = await api(`/orgs/${primary.orgId}/crm/pull`, {
  method: "POST",
  token: primary.token,
  body: { count: 3, prompt: "pull 3 gym clients per day", audience: "gym clients" },
});
check(
  "natural-language CRM pull refuses synthetic contacts without verified public research",
  pull.status === 409
    && pull.json.error === "public_research_not_connected"
    && pull.json.created === 0
    && Array.isArray(pull.json.contacts)
    && pull.json.contacts.length === 0
    && pull.json.provider_called === false
    && pull.json.outbound_action_executed === false
    && pull.json.public_exposure_changed === false,
  JSON.stringify(pull.json),
);

const create = await api(`/orgs/${primary.orgId}/crm/contacts`, {
  method: "POST",
  token: primary.token,
  body: {
    name: "Tak Test Contact",
    organization: "Neon Studio",
    email: "tak@example.test",
    phone: "555-0100",
    website: "https://neon.example.test",
    status: "new",
    value: 1500,
    nextStep: "Qualify project",
    socials: { instagram: "tak", tiktok: "takdev" },
    tags: ["creator", "warm"],
    fitScore: 91,
  },
});
const contactId = create.json.contact?.id as string | undefined;
check("contact create stores socials and org ws", create.status === 200 && contactId && create.json.contact.ws === primary.orgId && create.json.contact.socials?.instagram === "tak", JSON.stringify(create.json));

const list = await api(`/orgs/${primary.orgId}/crm`, { token: primary.token });
check(
  "CRM list returns research-required settings and only the manually created contact",
  list.status === 200
    && list.json.settings?.dailyPullTarget === 3
    && list.json.settings?.sourceMode === "research-required"
    && list.json.contacts?.length === 1
    && list.json.contacts?.some((c: any) => c.id === contactId),
  JSON.stringify(list.json),
);

const brainPackage = await api(`/orgs/${primary.orgId}/brain-package`, { token: primary.token });
check(
  "org brain package is hidden app data with CRM, Obsidian brain, and Hermes brain",
  brainPackage.status === 200
    && brainPackage.json.package?.storage?.hiddenInsideApp === true
    && brainPackage.json.package?.crm?.contacts?.some((c: any) => c.id === contactId)
    && brainPackage.json.package?.obsidianBrain?.private === true
    && brainPackage.json.package?.hermesBrain?.private === true
    && brainPackage.json.package?.redaction?.includesSecrets === false,
  JSON.stringify(brainPackage.json),
);

const patch = await api(`/orgs/${primary.orgId}/crm/contacts/${contactId}`, {
  method: "PATCH",
  token: primary.token,
  body: { status: "follow-up", phone: "555-9999", lastTouchAt: new Date().toISOString() },
});
check("contact patch updates pipeline fields", patch.status === 200 && patch.json.contact?.status === "follow-up" && patch.json.contact?.phone === "555-9999", JSON.stringify(patch.json));

const secondary = await signupAndLogin("crmsecondary");
const isolatedList = await api(`/orgs/${secondary.orgId}/crm`, { token: secondary.token });
check("second org cannot see first org CRM contacts", isolatedList.status === 200 && isolatedList.json.contacts?.length === 0 && !isolatedList.json.contacts?.some((c: any) => c.id === contactId), JSON.stringify(isolatedList.json));

const wrongOrgFetch = await api(`/orgs/${primary.orgId}/crm`, { token: secondary.token });
check("cross-org CRM access is rejected", wrongOrgFetch.status === 403, JSON.stringify(wrongOrgFetch.json));

const wrongBrainFetch = await api(`/orgs/${primary.orgId}/brain-package`, { token: secondary.token });
check("cross-org brain package access is rejected", wrongBrainFetch.status === 403, JSON.stringify(wrongBrainFetch.json));

const del = await api(`/orgs/${primary.orgId}/crm/contacts/${contactId}`, { method: "DELETE", token: primary.token });
check("contact delete succeeds", del.status === 200, JSON.stringify(del.json));

const afterDelete = await api(`/orgs/${primary.orgId}/crm`, { token: primary.token });
check("deleted contact no longer appears", afterDelete.status === 200 && !afterDelete.json.contacts?.some((c: any) => c.id === contactId), JSON.stringify(afterDelete.json));

console.log(`\nCRM TEST SUMMARY: ${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
