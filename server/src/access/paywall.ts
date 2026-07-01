/*
 * paywall.ts — the subscription/entitlement gate for the PhantomForce dashboard.
 *
 * Funnel (user-facing wording never mentions the gateway/Pangolin — that is our
 * plumbing): public site "Download PhantomForce" -> dashboard "log in / create
 * account" -> the app -> THIS gate.
 *
 * Security model — the gate is SERVER-SIDE and un-bypassable:
 *   - The server alone decides free-vs-paid. The browser can never assert it.
 *   - Free plan = VIEW ONLY. Every mutating/write action is refused server-side,
 *     so hiding buttons in the UI is only cosmetics on top of a real gate.
 *   - Write access requires the owner, or a subscription that was granted by a
 *     TRUSTED server process (payment webhook / owner grant) — never the client.
 *
 * Launch posture: free accounts get in and can view everything; they cannot
 * change anything. Flip nothing to "launch free": that is already the default.
 */

export type PaywallTier = "free" | "pro";

/** The minimal, server-trusted view of a session the gate needs. */
export type PaywallSession = {
  id: string;
  canManageAccess?: boolean;
  /**
   * Whether this account has paid access. This MUST only ever be set by a
   * trusted server process (a payment-provider webhook or an owner grant) after
   * verifying payment — never from a client-supplied value.
   */
  subscriptionActive?: boolean;
};

export type PaywallDecision = {
  /** allowed into the app at all (view). */
  entitled: boolean;
  canView: boolean;
  /** allowed to perform mutating/write actions. */
  canWrite: boolean;
  tier: PaywallTier;
  reason: string;
};

// Optional launch promo: grant write to every signed-in account. Server-side env
// only, defaults OFF, so the secure default is "free = view only".
function freeWriteForAll(): boolean {
  return process.env.PHANTOM_FREE_WRITE === "true";
}

/**
 * The single source of truth for dashboard entitlement. Fail closed: an
 * unauthenticated caller gets nothing. Everyone signed in may view; only the
 * owner, an active subscriber, or an explicit free-write promo may write.
 */
export function getPaywallDecision(session?: PaywallSession | null): PaywallDecision {
  if (!session || !session.id) {
    return {
      entitled: false,
      canView: false,
      canWrite: false,
      tier: "free",
      reason: "Not signed in — no dashboard access.",
    };
  }

  const owner = session.canManageAccess === true;
  const subscribed = session.subscriptionActive === true;
  const promo = freeWriteForAll();
  const write = owner || subscribed || promo;

  return {
    entitled: true,
    canView: true,
    canWrite: write,
    tier: write ? "pro" : "free",
    reason: owner
      ? "Operator/owner — full access."
      : subscribed
        ? "Active subscription — full access."
        : promo
          ? "Free-write launch promo — full access."
          : "Free plan — view only. Upgrade to make changes.",
  };
}

/** True only if this session may perform a mutating/write action. */
export function canWrite(session?: PaywallSession | null): boolean {
  return getPaywallDecision(session).canWrite;
}

/** True if this session may access (view) the dashboard at all. */
export function isEntitled(session?: PaywallSession | null): boolean {
  return getPaywallDecision(session).entitled;
}
