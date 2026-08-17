export const IDENTITY_CONTRACT_VERSION = 1;

const FIXTURES = Object.freeze({
  "ai-demo-owner-token": { subjectId: "ai-demo-owner", workspaceId: "ai-demo-workspace", role: "owner", displayName: "Portfolio Owner" },
  "ai-demo-reviewer-token": { subjectId: "ai-demo-reviewer", workspaceId: "ai-demo-workspace", role: "reviewer", displayName: "Evidence Reviewer" },
  "ai-demo-outsider-token": { subjectId: "ai-demo-outsider", workspaceId: "ai-outside-workspace", role: "owner", displayName: "Isolation Fixture" }
});

const capabilitiesFor = (role) => role === "owner"
  ? ["artifact:read", "artifact:write", "analysis:run", "analysis:review", "consent:manage", "artifact:delete"]
  : role === "reviewer" ? ["artifact:read", "artifact:write", "analysis:run", "analysis:review"] : ["artifact:read"];

export class LocalIdentityAdapter {
  constructor({ now = () => new Date().toISOString() } = {}) { this.now = now; this.kind = "local_fixture"; }
  authenticate(token) {
    const fixture = FIXTURES[String(token || "").trim()]; if (!fixture) return null;
    return {
      actorId: fixture.subjectId, subjectId: fixture.subjectId, workspaceId: fixture.workspaceId, role: fixture.role, displayName: fixture.displayName,
      memberships: [{ workspaceId: fixture.workspaceId, role: fixture.role }], capabilities: capabilitiesFor(fixture.role),
      authenticationStrength: "local_demo", sessionExpiresAt: "2099-01-01T00:00:00.000Z", sessionId: `local:${fixture.subjectId}`,
      identityAssertion: { adapter: "local_fixture", assertedAt: this.now(), contractVersion: IDENTITY_CONTRACT_VERSION }
    };
  }
}

export class ProductionIdentityAdapter {
  constructor() { this.kind = "production_disabled"; this.enabled = false; }
  authenticate() { throw new Error("PRODUCTION_IDENTITY_ADAPTER_DISABLED"); }
}

export const IdentityContract = Object.freeze({
  version: IDENTITY_CONTRACT_VERSION,
  requiredFields: ["subjectId", "memberships", "role", "capabilities", "authenticationStrength", "sessionExpiresAt", "sessionId", "identityAssertion"]
});
