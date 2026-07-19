/* P1 verification: database auth, organizations, memberships, roles,
   invitations, org switching, tenant isolation, audit, entitlements.
   Runs against a live server started with PHANTOMFORCE_AUTH_PROVIDER=database
   and the dev seed identities. Every check hits the REAL API. */
const BASE = process.env.BASE ?? "http://127.0.0.1:5391";
const PASSWORD = "phantom-dev-password";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${String(detail).slice(0, 140)}` : ""}`);
  ok ? pass++ : fail++;
};

async function api(path, { method = "GET", token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function login(email, password = PASSWORD) {
  const { status, json } = await api("/auth/login", { method: "POST", body: { email, password } });
  return { status, token: json.token, session: json.session, json };
}

/* ---- 1. login flows ---- */
const jordan = await login("jordan@phantomforce.local");
check("super-admin login succeeds", jordan.status === 200 && !!jordan.token);
check("super-admin session has isSuperAdmin + canManageAccess", jordan.session?.isSuperAdmin === true && jordan.session?.canManageAccess === true);

const owner = await login("owner@chicagoshots.local");
check("org owner login succeeds", owner.status === 200 && !!owner.token);
check("org owner is NOT platform admin", owner.session?.canManageAccess === false && owner.session?.isSuperAdmin === false);
check("org owner has orgRole=owner scoped to their org", owner.session?.orgRole === "owner" && owner.session?.orgId === "dev-org-chicagoshots");
check("org owner clientId pins tenant scope", owner.session?.clientId === "dev-org-chicagoshots");

const employee = await login("employee@chicagoshots.local");
check("employee login succeeds with orgRole=member", employee.status === 200 && employee.session?.orgRole === "member");

const client = await login("client@chicagoshots.local");
check("client login succeeds with orgRole=client", client.status === 200 && client.session?.orgRole === "client");
check("client role never gets the write bit", client.session?.subscriptionActive === false);

const badLogin = await login("jordan@phantomforce.local", "wrong-password");
check("wrong password rejected 401", badLogin.status === 401);
const noUser = await login("nobody@nowhere.local");
check("unknown user rejected 401 (uniform)", noUser.status === 401);

/* ---- 2. /auth/me ---- */
const me = await api("/auth/me", { token: owner.token });
check("/auth/me returns user + activeOrg + entitlements", me.json.user?.email === "owner@chicagoshots.local" && me.json.activeOrg?.id === "dev-org-chicagoshots" && me.json.entitlements?.planKey === "professional");

/* ---- 3. tenant isolation (the aggressive part) ---- */
const crossMembers = await api("/orgs/dev-org-phantomforce/members", { token: owner.token });
check("owner of org B CANNOT list org A members (403)", crossMembers.status === 403);
const crossAudit = await api("/orgs/dev-org-phantomforce/audit", { token: owner.token });
check("owner of org B CANNOT read org A audit (403)", crossAudit.status === 403);
const crossEnt = await api("/orgs/dev-org-phantomforce/entitlements", { token: owner.token });
check("owner of org B CANNOT read org A entitlements (403)", crossEnt.status === 403);
const crossInvite = await api("/orgs/dev-org-phantomforce/invitations", { method: "POST", token: owner.token, body: { email: "sneak@evil.local", role: "admin" } });
check("owner of org B CANNOT invite into org A (403)", crossInvite.status === 403);
const crossSwitch = await api("/auth/switch-org", { method: "POST", token: owner.token, body: { orgId: "dev-org-phantomforce" } });
check("owner of org B CANNOT switch into org A (403)", crossSwitch.status === 403);
const employeeManage = await api("/orgs/dev-org-chicagoshots/invitations", { method: "POST", token: employee.token, body: { email: "x@y.local", role: "member" } });
check("employee (member) cannot manage own org (403)", employeeManage.status === 403);
const noToken = await api("/orgs");
check("no token -> 401", noToken.status === 401);
const forged = await api("/orgs", { token: jordan.token.slice(0, -4) + "AAAA" });
check("tampered token -> 401", forged.status === 401);

/* ---- 4. super-admin reach + org switching ---- */
const allOrgs = await api("/orgs", { token: jordan.token });
check("super-admin sees all orgs", allOrgs.json.organizations?.length >= 2, JSON.stringify(allOrgs.json.organizations?.map((o) => o.id)));
const jordanSwitch = await api("/auth/switch-org", { method: "POST", token: jordan.token, body: { orgId: "dev-org-chicagoshots" } });
check("super-admin can switch into any org", jordanSwitch.status === 200 && jordanSwitch.json.session?.orgId === "dev-org-chicagoshots");
await api("/auth/switch-org", { method: "POST", token: jordan.token, body: { orgId: "dev-org-phantomforce" } });

/* ---- 5. invitations end-to-end ---- */
const inviteEmail = `newhire-${Date.now()}@chicagoshots.local`;
const invite = await api("/orgs/dev-org-chicagoshots/invitations", { method: "POST", token: owner.token, body: { email: inviteEmail, role: "member" } });
check("org owner can create invitation, raw token returned once", invite.status === 200 && !!invite.json.token);
const accept = await api("/auth/invitations/accept", { method: "POST", body: { token: invite.json.token, name: "New Hire", password: "new-hire-password-1" } });
check("invitation accept creates account + membership", accept.status === 200 && accept.json.orgId === "dev-org-chicagoshots");
const reAccept = await api("/auth/invitations/accept", { method: "POST", body: { token: invite.json.token, password: "whatever-123" } });
check("invitation cannot be accepted twice", reAccept.status === 400);
const newHire = await login(inviteEmail, "new-hire-password-1");
check("invited user can log in", newHire.status === 200 && newHire.session?.orgId === "dev-org-chicagoshots");
const members = await api("/orgs/dev-org-chicagoshots/members", { token: owner.token });
check("new member appears in member list", members.json.members?.some((m) => m.email === inviteEmail));

/* ---- 6. role management + audit ---- */
const newHireId = members.json.members.find((m) => m.email === inviteEmail)?.userId;
const promote = await api(`/orgs/dev-org-chicagoshots/members/${newHireId}/role`, { method: "POST", token: owner.token, body: { role: "admin" } });
check("owner can promote member -> admin", promote.status === 200);
const selfOwner = await api(`/orgs/dev-org-chicagoshots/members/${newHireId}/role`, { method: "POST", token: newHire.token, body: { role: "owner" } });
check("org admin cannot grant owner role (owner-only)", selfOwner.status === 403);
const ownerId = members.json.members.find((m) => m.email === "owner@chicagoshots.local")?.userId;
const demoteLastOwner = await api(`/orgs/dev-org-chicagoshots/members/${ownerId}/role`, { method: "POST", token: owner.token, body: { role: "member" } });
check("cannot demote the last owner", demoteLastOwner.status === 403);
const audit = await api("/orgs/dev-org-chicagoshots/audit", { token: owner.token });
const auditTypes = (audit.json.events ?? []).map((e) => e.eventType);
check("audit trail records invitation + role change", auditTypes.includes("invitation.created") && auditTypes.includes("invitation.accepted") && auditTypes.includes("membership.role_changed"), auditTypes.slice(0, 6).join(","));

/* ---- 7. entitlements + manual plan admin ---- */
const ent = await api("/orgs/dev-org-chicagoshots/entitlements", { token: owner.token });
check("entitlements resolve plan + usage metrics", ent.json.entitlements?.planKey === "professional" && Array.isArray(ent.json.metrics));
const plans = await api("/admin/plans", { token: jordan.token });
const planKeys = (plans.json.plans ?? []).map((plan) => plan.key);
check(
  "super-admin lists plan catalog",
  ["free", "starter", "professional", "elite", "enterprise", "internal"].every((key) => planKeys.includes(key)),
  planKeys.join(","),
);
const plansDenied = await api("/admin/plans", { token: owner.token });
check("org owner CANNOT list admin plans (403)", plansDenied.status === 403);

const suspend = await api("/admin/orgs/dev-org-chicagoshots/plan", { method: "POST", token: jordan.token, body: { planKey: "starter", status: "suspended", note: "test suspension" } });
check("super-admin can suspend an org's plan", suspend.status === 200 && suspend.json.entitlements?.effectiveStatus === "suspended");
const suspendedMe = await api("/auth/me", { token: owner.token });
check("plan changes invalidate session cache immediately", suspendedMe.json.entitlements?.planKey === "starter" && suspendedMe.json.entitlements?.canWrite === false);
const writeWhileSuspended = await api("/orgs/dev-org-chicagoshots/invitations", { method: "POST", token: owner.token, body: { email: "blocked@x.local", role: "member" } });
check("suspended org: owner writes blocked by paywall (403)", writeWhileSuspended.status === 403, JSON.stringify(writeWhileSuspended.json).slice(0, 120));
const restore = await api("/admin/orgs/dev-org-chicagoshots/plan", { method: "POST", token: jordan.token, body: { planKey: "professional", status: "active", note: "restore" } });
check("super-admin restores plan", restore.status === 200 && restore.json.entitlements?.canWrite === true);

/* ---- 8. CRM, proposal, and approval lifecycle + tenant isolation ---- */
const foreignTenantId = "dev-org-phantomforce";
const ownerTenantId = "dev-org-chicagoshots";
const safetyFlagsAreClosed = (json) =>
  json.provider_called === false &&
  json.outbound_action_executed === false &&
  json.public_exposure_changed === false;

const tamperedTenantRequests = await Promise.all([
  api(`/api/crm/leads?tenant_id=${foreignTenantId}`, { token: owner.token }),
  api("/api/proposals", {
    method: "POST",
    token: owner.token,
    body: { tenant_id: foreignTenantId, proposal: { client: "Rejected cross-tenant proposal" } },
  }),
  api("/api/workspace-approvals", {
    method: "POST",
    token: owner.token,
    body: { tenant_id: foreignTenantId, approval: { title: "Rejected cross-tenant approval" } },
  }),
  api(`/api/managed-growth/report?tenant_id=${foreignTenantId}`, { token: owner.token }),
]);
check(
  "workspace APIs reject an explicit nonmember tenant instead of silently writing to the active organization",
  tamperedTenantRequests.every(({ status, json }) => status === 403 && json.code === "TENANT_MEMBERSHIP_REQUIRED"),
);

const leadCreate = await api("/api/crm/leads", {
  method: "POST",
  token: owner.token,
  body: {
    tenant_id: ownerTenantId,
    lead: {
      name: "Database auth lifecycle lead",
      company: "ChicagoShots lifecycle proof",
      source: "Disposable regression test",
      status: "new",
      value: 1500,
      next: "Prepare an approval-only proposal.",
      notes: "Created in a disposable database. No outreach is performed.",
    },
  },
});
const leadId = leadCreate.json.lead?.id;
check(
  "CRM create writes to the explicitly authorized organization",
  leadCreate.status === 200 && leadCreate.json.tenant_id === ownerTenantId && leadCreate.json.lead?.tenantId === ownerTenantId,
);
check("CRM create keeps provider/outbound/public actions closed", safetyFlagsAreClosed(leadCreate.json));

const leadUpdate = await api(`/api/crm/leads/${leadId}`, {
  method: "POST",
  token: owner.token,
  body: { tenant_id: ownerTenantId, patch: { status: "follow-up", value: 2000 } },
});
check(
  "CRM edit persists inside the pinned tenant",
  leadUpdate.status === 200 && leadUpdate.json.lead?.status === "follow-up" && leadUpdate.json.lead?.value === 2000 && leadUpdate.json.tenant_id === ownerTenantId,
);

const proposalCreate = await api("/api/proposals", {
  method: "POST",
  token: owner.token,
  body: {
    tenant_id: ownerTenantId,
    proposal: {
      client: "ChicagoShots lifecycle proof",
      contact: "Approval-only test contact",
      pkg: "core",
      price: 2000,
      status: "draft",
      pain: "Needs a dependable content and operations workflow.",
      scope: ["Workflow setup", "Approval queue", "Weekly report"],
      timeline: "Two-week setup sprint",
      leadId,
    },
  },
});
const proposalId = proposalCreate.json.proposal?.id;
check(
  "proposal create stays in the owner's tenant and links the CRM lead",
  proposalCreate.status === 200 && proposalCreate.json.tenant_id === ownerTenantId && proposalCreate.json.proposal?.leadId === leadId,
);
check("proposal create keeps provider/outbound/public actions closed", safetyFlagsAreClosed(proposalCreate.json));

const proposalUpdate = await api(`/api/proposals/${proposalId}`, {
  method: "POST",
  token: owner.token,
  body: { tenant_id: ownerTenantId, patch: { status: "sent-ready", price: 2500 } },
});
check(
  "proposal edit persists an approval-ready state without sending",
  proposalUpdate.status === 200 && proposalUpdate.json.proposal?.status === "sent-ready" && proposalUpdate.json.proposal?.price === 2500 && safetyFlagsAreClosed(proposalUpdate.json),
);

const approvalCreate = await api("/api/workspace-approvals", {
  method: "POST",
  token: owner.token,
  body: {
    tenant_id: ownerTenantId,
    approval: {
      type: "proposal-review",
      title: "Approve lifecycle proposal",
      detail: "Approval proves state only. It must not send or publish anything.",
      ref: proposalId,
      status: "pending",
      requestedBy: "Database auth regression",
    },
  },
});
const approvalId = approvalCreate.json.approval?.id;
check(
  "approval create is tenant-pinned and starts pending",
  approvalCreate.status === 200 && approvalCreate.json.tenant_id === ownerTenantId && approvalCreate.json.approval?.status === "pending",
);
check(
  "workspace approval is state-only and cannot execute external work",
  approvalCreate.json.approval_execution_implemented === false && safetyFlagsAreClosed(approvalCreate.json),
);

const memberDecision = await api(`/api/workspace-approvals/${approvalId}`, {
  method: "POST",
  token: employee.token,
  body: { patch: { status: "approved", decision: "approve" } },
});
check("ordinary member cannot decide workspace approvals (403)", memberDecision.status === 403);

const ownerDecision = await api(`/api/workspace-approvals/${approvalId}`, {
  method: "POST",
  token: owner.token,
  body: { tenant_id: ownerTenantId, patch: { status: "approved", decision: "approve", ownerNotes: "Approved for local proof only." } },
});
check(
  "organization owner can decide their approval without executing it",
  ownerDecision.status === 200 && ownerDecision.json.approval?.status === "approved" && ownerDecision.json.approval_execution_implemented === false && safetyFlagsAreClosed(ownerDecision.json),
);

const [leadRefresh, proposalRefresh, approvalRefresh] = await Promise.all([
  api(`/api/crm/leads?tenant_id=${ownerTenantId}`, { token: owner.token }),
  api(`/api/proposals?tenant_id=${ownerTenantId}`, { token: owner.token }),
  api(`/api/workspace-approvals?tenant_id=${ownerTenantId}`, { token: owner.token }),
]);
check(
  "refresh restores the owner's CRM, proposal, and approval records",
  leadRefresh.json.tenant_id === ownerTenantId &&
    leadRefresh.json.document?.leads?.some((lead) => lead.id === leadId && lead.status === "follow-up") &&
    proposalRefresh.json.document?.proposals?.some((proposal) => proposal.id === proposalId && proposal.status === "sent-ready") &&
    approvalRefresh.json.document?.approvals?.some((approval) => approval.id === approvalId && approval.status === "approved"),
);

const foreignLeadCreate = await api("/api/crm/leads", {
  method: "POST",
  token: jordan.token,
  body: { tenant_id: foreignTenantId, lead: { name: "Foreign tenant proof", company: "PhantomForce isolated record", value: 750 } },
});
const foreignLeadId = foreignLeadCreate.json.lead?.id;
check("platform owner can explicitly create a record in another managed tenant", foreignLeadCreate.status === 200 && foreignLeadCreate.json.tenant_id === foreignTenantId);
check(
  "org owner cannot read a foreign tenant record by requesting its tenant id",
  !leadRefresh.json.document?.leads?.some((lead) => lead.id === foreignLeadId) &&
    (await api(`/api/crm/leads?tenant_id=${foreignTenantId}`, { token: owner.token })).status === 403,
);

const growthReport = await api(`/api/managed-growth/report?tenant_id=${ownerTenantId}`, { token: owner.token });
check(
  "managed growth report stays inside the authorized tenant and performs no provider or outbound action",
  growthReport.status === 200 && growthReport.json.tenant_id === ownerTenantId && growthReport.json.provider_called === false && growthReport.json.outbound_action_executed === false,
);

const [approvalDelete, proposalDelete, leadDelete, foreignLeadDelete] = await Promise.all([
  api(`/api/workspace-approvals/${approvalId}?tenant_id=${ownerTenantId}`, { method: "DELETE", token: owner.token }),
  api(`/api/proposals/${proposalId}?tenant_id=${ownerTenantId}`, { method: "DELETE", token: owner.token }),
  api(`/api/crm/leads/${leadId}?tenant_id=${ownerTenantId}`, { method: "DELETE", token: owner.token }),
  api(`/api/crm/leads/${foreignLeadId}?tenant_id=${foreignTenantId}`, { method: "DELETE", token: jordan.token }),
]);
check(
  "lifecycle cleanup deletes only the intended tenant records",
  [approvalDelete, proposalDelete, leadDelete, foreignLeadDelete].every(({ status }) => status === 200),
);
const cleanupRefresh = await api(`/api/crm/leads?tenant_id=${ownerTenantId}`, { token: owner.token });
check("deleted CRM lead stays deleted after refresh", !cleanupRefresh.json.document?.leads?.some((lead) => lead.id === leadId));

/* ---- 9. logout + revocation ---- */
const logout = await api("/auth/logout", { method: "POST", token: newHire.token });
check("logout revokes the session", logout.status === 200 && logout.json.revoked === true);
await new Promise((r) => setTimeout(r, 100));
const afterLogout = await api("/auth/me", { token: newHire.token });
check("revoked token no longer authenticates (401)", afterLogout.status === 401);

console.log(fail ? `${fail} FAILURES (${pass} passed)` : `ALL ${pass} PASS`);
process.exit(fail ? 1 : 0);
