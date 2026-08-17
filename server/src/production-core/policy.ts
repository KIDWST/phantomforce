export type ProductionRole = "owner" | "admin" | "member" | "client" | "system";

export const PRODUCTION_CORE_ACTIONS = [
  "provider.connect",
  "provider.refresh",
  "lead.create",
  "lead.convert",
  "client.archive",
  "campaign.create",
  "content.create",
  "content.revise",
  "media.attach",
  "approval.request",
  "approval.decide",
  "publication.request",
  "job.run",
  "job.retry",
  "organization.suspend",
  "organization.resume",
  "phantom.recommend",
  "followup.create",
] as const;

export type ProductionAction = typeof PRODUCTION_CORE_ACTIONS[number];

const AUTHORING_ACTIONS = new Set<ProductionAction>([
  "lead.create", "lead.convert", "campaign.create", "content.create", "content.revise", "media.attach", "approval.request", "phantom.recommend", "followup.create",
]);
const MANAGER_ACTIONS = new Set<ProductionAction>([
  "provider.connect", "provider.refresh", "client.archive", "approval.decide", "publication.request", "job.run", "job.retry", "organization.suspend", "organization.resume",
]);

export type ProductionPolicyDecision = {
  allowed: boolean;
  action: ProductionAction;
  role: ProductionRole;
  reason: string;
  policy: "production-core-v1";
};

export function evaluateProductionPolicy(role: ProductionRole, action: ProductionAction): ProductionPolicyDecision {
  const allowed = role === "system"
    || role === "owner"
    || (role === "admin" && (AUTHORING_ACTIONS.has(action) || MANAGER_ACTIONS.has(action)))
    || (role === "member" && AUTHORING_ACTIONS.has(action));
  return {
    allowed,
    action,
    role,
    reason: allowed ? "policy_allowed" : MANAGER_ACTIONS.has(action) ? "manager_permission_required" : "role_not_permitted",
    policy: "production-core-v1",
  };
}
