import { getAccessDecision, listClientAccess } from "./client-access-state.js";

export type PangolinDesiredState = "enabled" | "read_only" | "disabled";
export type PangolinGatewayEnforcement = "allow_route" | "disable_route";

export type PangolinRoutePlan = {
  clientId: string;
  business: string;
  privateRoute: string;
  gateway: "Pangolin";
  accessStatus: "active" | "past_due" | "revoked";
  paymentStatus: "paid" | "due" | "failed";
  desiredState: PangolinDesiredState;
  mode: "full" | "read_only" | "blocked";
  gatewayEnforcement: PangolinGatewayEnforcement;
  appEnforcement: "full" | "read_only" | "blocked";
  enforcementNote: string;
  modules: string[];
  reason: string;
  liveChangeRequired: false;
  liveChangesAllowed: false;
};

function desiredStateForMode(allowed: boolean, mode: PangolinRoutePlan["mode"]): PangolinDesiredState {
  if (!allowed || mode === "blocked") return "disabled";
  if (mode === "read_only") return "read_only";
  return "enabled";
}

function gatewayEnforcementForMode(
  allowed: boolean,
  mode: PangolinRoutePlan["mode"],
): PangolinGatewayEnforcement {
  return !allowed || mode === "blocked" ? "disable_route" : "allow_route";
}

function enforcementNoteForMode(allowed: boolean, mode: PangolinRoutePlan["mode"]) {
  if (!allowed || mode === "blocked") {
    return "Pangolin should block route reachability; PhantomForce also blocks workspace requests.";
  }

  if (mode === "read_only") {
    return "Pangolin keeps the route reachable; PhantomForce module handlers enforce read-only access.";
  }

  return "Pangolin keeps the route reachable; PhantomForce module handlers allow full entitled access.";
}

export function listPangolinDryRunPlan() {
  const plans: PangolinRoutePlan[] = listClientAccess().map((record) => {
    const decision = getAccessDecision(record.id);
    const mode = decision.mode as PangolinRoutePlan["mode"];
    const desiredState = desiredStateForMode(decision.allowed, mode);

    return {
      clientId: record.id,
      business: record.business,
      privateRoute: record.privateRoute,
      gateway: record.gateway,
      accessStatus: record.accessStatus,
      paymentStatus: record.paymentStatus,
      desiredState,
      mode,
      gatewayEnforcement: gatewayEnforcementForMode(decision.allowed, mode),
      appEnforcement: mode,
      enforcementNote: enforcementNoteForMode(decision.allowed, mode),
      modules: decision.modules,
      reason: decision.reason,
      liveChangeRequired: false,
      liveChangesAllowed: false,
    };
  });

  return {
    dryRun: true,
    provider: "Pangolin" as const,
    liveChangesAllowed: false,
    approvalRequiredForLiveChanges: true,
    generatedAt: new Date().toISOString(),
    summary: {
      total: plans.length,
      enabled: plans.filter((plan) => plan.desiredState === "enabled").length,
      readOnly: plans.filter((plan) => plan.desiredState === "read_only").length,
      disabled: plans.filter((plan) => plan.desiredState === "disabled").length,
    },
    plans,
  };
}
