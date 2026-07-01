/*
 * paywall.ts — the subscription gate for the PhantomForce dashboard.
 *
 * Funnel: public site "Download PhantomForce" -> Pangolin gateway (sign up /
 * log in with a built-in account) -> the dashboard -> THIS paywall.
 *
 * Launch posture: FREE. `PHANTOM_PAYWALL_MODE` defaults to "free", so every
 * signed-in account gets full access while we build the audience. The gate is
 * real and in place — flip `PHANTOM_PAYWALL_MODE=paid` (once billing/subscription
 * records exist) to start enforcing it. No account data or payment is touched
 * here; this only answers "is this session entitled to the app right now?".
 */

export type PaywallMode = "free" | "paid";
export type PaywallTier = "free" | "pro";

/** A minimal view of the gateway/dashboard session the gate needs. */
export type PaywallSession = {
  id: string;
  canManageAccess?: boolean;
  /** Reserved for paid mode once real subscriptions are wired. */
  subscriptionActive?: boolean;
};

export type PaywallState = {
  mode: PaywallMode;
  /** true while the paywall lets every signed-in account through (free launch). */
  open: boolean;
  /** may this session use the paid app right now? */
  entitled: boolean;
  tier: PaywallTier;
  reason: string;
};

// Read at call time (not cached) so config/tests can flip it without a reload.
function currentMode(): PaywallMode {
  return process.env.PHANTOM_PAYWALL_MODE === "paid" ? "paid" : "free";
}

export function getPaywallMode(): PaywallMode {
  return currentMode();
}

/**
 * Decide entitlement for a dashboard session. Fail closed for anonymous callers:
 * you must be signed in through the gateway before the paywall is even asked.
 */
export function getPaywallState(session?: PaywallSession | null): PaywallState {
  const mode = currentMode();

  if (!session) {
    return {
      mode,
      open: mode === "free",
      entitled: false,
      tier: "free",
      reason: "No authenticated session — sign in through the dashboard gateway first.",
    };
  }

  // The operator/owner always has access regardless of billing.
  if (session.canManageAccess) {
    return { mode, open: mode === "free", entitled: true, tier: "pro", reason: "Operator/owner access." };
  }

  if (mode === "free") {
    return {
      mode,
      open: true,
      entitled: true,
      tier: "free",
      reason: "Free launch — the paywall is open; every signed-in account has full access for now.",
    };
  }

  // Paid mode: real subscription records are not wired yet, so members are not
  // entitled until billing lands. Reserved `subscriptionActive` flips this on.
  if (session.subscriptionActive) {
    return { mode, open: false, entitled: true, tier: "pro", reason: "Active subscription." };
  }

  return {
    mode,
    open: false,
    entitled: false,
    tier: "free",
    reason: "Paid mode — an active subscription is required (billing integration pending).",
  };
}

export function isEntitled(session?: PaywallSession | null): boolean {
  return getPaywallState(session).entitled;
}
