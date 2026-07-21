/*
 * social-customer-view.ts — the truthful, sanitized customer projection of
 * social connection status.
 *
 * P0 CONTEXT: the customer-facing /social-analytics/status endpoint used to
 * return the full connector status, including OAuth infrastructure that must
 * never reach an ordinary workspace user — provider callback URLs, developer
 * console URLs, the *names* of the server-only credential environment
 * variables (via missingAppEnv / oauthRequired), and redirect URIs. It also
 * had no truthful connection-state model: a saved handle set enabled=true and
 * read as "linked".
 *
 * This module is intentionally DEPENDENCY-FREE and PURE so it can be unit
 * tested in plain Node with no database, no Fastify, and no provider network.
 * It takes the already-computed internal status object and projects a
 * customer-safe view that:
 *   - contains ZERO credentials, tokens, redirect URIs, callback URLs,
 *     console URLs, or environment-variable names;
 *   - reports a truthful connectionStatus per the state model;
 *   - counts LIVE and READY honestly (a saved handle is neither).
 *
 * The forbidden-key guard at the bottom is exercised by the test suite and is
 * also applied defensively at runtime so a future field addition upstream can
 * never silently leak.
 */

export type CustomerConnectionStatus =
  | "PLATFORM_UNCONFIGURED"
  | "PROVIDER_REVIEW_PENDING"
  | "AVAILABLE_TO_CONNECT"
  | "CONNECTING"
  | "ASSET_SELECTION_REQUIRED"
  | "CONNECTED"
  | "LIMITED_PERMISSIONS"
  | "DEGRADED"
  | "REAUTH_REQUIRED"
  | "DISCONNECTED";

export type CustomerCapabilityStatus = "NONE" | "IDENTITY_ONLY" | "ANALYTICS_READY" | "PUBLISH_READY" | "FULL";

export type CustomerProviderView = {
  provider: string;
  name: string;
  globallyAvailable: boolean;
  connectionStatus: CustomerConnectionStatus;
  capabilityStatus: CustomerCapabilityStatus;
  displayName: string;
  username: string;
  avatarUrl: string;
  selectedAssetName: string;
  grantedCapabilities: string[];
  reconnectRequired: boolean;
  /** Truthful reference to a public handle the user typed; never implies auth. */
  savedHandleReference: string;
  /** The single customer-facing action label from the approved vocabulary. */
  action: "Connect account" | "Connected" | "Reconnect" | "Permission required" | "Connection expired" | "Temporarily unavailable" | "Disconnect";
  /** Plain-language, non-technical status message. No provider payloads. */
  customerMessage: string;
};

export type CustomerSocialStatus = {
  mode: "customer_safe";
  featureFlag: string;
  providers: CustomerProviderView[];
  counts: {
    /** Valid/refreshable auth + verified identity + any required asset selection. */
    live: number;
    /** LIVE and holding the scopes/capabilities the shown feature needs. */
    ready: number;
    available: number;
    total: number;
  };
};

/* The minimal shape this projection needs from the internal connector row.
   Deliberately narrow so unrelated internal fields cannot flow through. */
export type InternalConnectorRow = {
  id: string;
  name: string;
  oauthConfigured: boolean;          // provider app credentials present server-side
  live: boolean;                     // internal "authorized token exists"
  handle: string;                    // may be a typed public handle OR a provider identity
  savedConnection: {
    connected?: boolean;
    accountName?: string;
    accountHandle?: string;
    avatarUrl?: string;
    selectedAssetName?: string;
    tokenExpired?: boolean;
    reauthRequired?: boolean;
    degraded?: boolean;
    grantedScopes?: string[];
    verifiedIdentity?: boolean;
    requiresAssetSelection?: boolean;
    assetSelected?: boolean;
    analyticsReady?: boolean;
    publishReady?: boolean;
    providerReviewPending?: boolean;
  } | null;
  /** A public handle the user typed that is NOT a provider authorization. */
  typedHandleReference?: string;
};

const FEATURE_FLAG_NAME = "SOCIAL_CONNECT_V2";

function actionFor(status: CustomerConnectionStatus): CustomerProviderView["action"] {
  switch (status) {
    case "PLATFORM_UNCONFIGURED":
    case "PROVIDER_REVIEW_PENDING":
      return "Temporarily unavailable";
    case "CONNECTED":
    case "LIMITED_PERMISSIONS":
      return "Connected";
    case "REAUTH_REQUIRED":
      return "Permission required";
    case "DEGRADED":
      return "Reconnect";
    case "DISCONNECTED":
    default:
      return "Connect account";
  }
}

function messageFor(status: CustomerConnectionStatus, name: string): string {
  switch (status) {
    case "PLATFORM_UNCONFIGURED":
      return `${name} connections are temporarily unavailable. Nothing is needed from you.`;
    case "PROVIDER_REVIEW_PENDING":
      return `${name} is being finished by our team and will be available soon.`;
    case "CONNECTED":
      return `${name} is connected.`;
    case "LIMITED_PERMISSIONS":
      return `${name} is connected, but some permissions are still needed for every feature.`;
    case "REAUTH_REQUIRED":
      return `${name} needs you to grant permission again to keep working.`;
    case "DEGRADED":
      return `${name} is having temporary trouble. Reconnecting usually fixes it.`;
    case "DISCONNECTED":
    default:
      return `Connect your ${name} account to enable approved features.`;
  }
}

function capabilityStatusFor(row: InternalConnectorRow, connected: boolean): CustomerCapabilityStatus {
  const c = row.savedConnection;
  if (!connected || !c) return "NONE";
  const publish = !!c.publishReady;
  const analytics = !!c.analyticsReady;
  if (publish && analytics) return "FULL";
  if (publish) return "PUBLISH_READY";
  if (analytics) return "ANALYTICS_READY";
  return "IDENTITY_ONLY";
}

function grantedCapabilitiesFor(row: InternalConnectorRow, connected: boolean): string[] {
  const c = row.savedConnection;
  if (!connected || !c) return [];
  const caps: string[] = ["canConnect", "canReadIdentity"];
  if (c.analyticsReady) caps.push("canReadAnalytics");
  if (c.publishReady) caps.push("canPublishText", "canPublishImage");
  return caps;
}

/**
 * Derive the truthful connection state for one provider. A saved public handle
 * is NEVER treated as a connection: only a real stored connection with a
 * verified provider identity can advance past DISCONNECTED.
 */
export function deriveConnectionStatus(row: InternalConnectorRow): CustomerConnectionStatus {
  if (!row.oauthConfigured) return "PLATFORM_UNCONFIGURED";
  const c = row.savedConnection;
  if (c?.providerReviewPending) return "PROVIDER_REVIEW_PENDING";
  const hasRealConnection = !!c && !!c.connected;
  if (!hasRealConnection) return "AVAILABLE_TO_CONNECT";
  if (c!.reauthRequired) return "REAUTH_REQUIRED";
  if (c!.tokenExpired) return "REAUTH_REQUIRED";
  if (c!.degraded) return "DEGRADED";
  if (c!.requiresAssetSelection && !c!.assetSelected) return "ASSET_SELECTION_REQUIRED";
  if (!c!.verifiedIdentity) return "AVAILABLE_TO_CONNECT";
  if (!c!.analyticsReady && !c!.publishReady) return "LIMITED_PERMISSIONS";
  return "CONNECTED";
}

function projectProvider(row: InternalConnectorRow): CustomerProviderView {
  const status = deriveConnectionStatus(row);
  const connected = status === "CONNECTED" || status === "LIMITED_PERMISSIONS";
  const c = row.savedConnection;
  const action =
    status === "AVAILABLE_TO_CONNECT" ? "Connect account"
      : status === "ASSET_SELECTION_REQUIRED" ? "Connect account"
        : actionFor(status);
  return {
    provider: row.id,
    name: row.name,
    globallyAvailable: !!row.oauthConfigured,
    connectionStatus: status,
    capabilityStatus: capabilityStatusFor(row, connected),
    displayName: connected ? String(c?.accountName || "") : "",
    username: connected ? String(c?.accountHandle || "") : "",
    avatarUrl: connected ? String(c?.avatarUrl || "") : "",
    selectedAssetName: connected ? String(c?.selectedAssetName || "") : "",
    grantedCapabilities: grantedCapabilitiesFor(row, connected),
    reconnectRequired: status === "REAUTH_REQUIRED" || status === "DEGRADED",
    savedHandleReference: String(row.typedHandleReference || ""),
    action,
    customerMessage: messageFor(status, row.name),
  };
}

/**
 * Keys that must NEVER appear anywhere in a customer-facing social payload.
 * Applied recursively as a defensive runtime guard AND asserted by tests.
 */
export const FORBIDDEN_CUSTOMER_KEYS = [
  "callbackurl", "consoleurl", "redirecturi", "recommendedredirecturi",
  "missingappenv", "oauthrequired", "idenv", "secretenv",
  "clientid", "client_id", "clientsecret", "client_secret",
  "appid", "app_id", "appsecret", "app_secret", "clientkey", "client_key",
  "accesstoken", "access_token", "refreshtoken", "refresh_token",
  "bearer", "codeverifier", "code_verifier", "statehash", "state_hash",
];

export function assertNoForbiddenKeys(value: unknown, path = "$"): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoForbiddenKeys(item, `${path}[${i}]`));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const norm = key.toLowerCase().replace(/[^a-z_]/g, "");
    if (FORBIDDEN_CUSTOMER_KEYS.includes(norm)) {
      throw new Error(`Forbidden customer-facing key "${key}" at ${path}`);
    }
    assertNoForbiddenKeys(child, `${path}.${key}`);
  }
}

/** Build the sanitized, truthful customer view from internal connector rows. */
export function buildCustomerSocialStatus(rows: InternalConnectorRow[]): CustomerSocialStatus {
  const providers = rows.map(projectProvider);
  const live = providers.filter((p) => p.connectionStatus === "CONNECTED" || p.connectionStatus === "LIMITED_PERMISSIONS").length;
  const ready = providers.filter((p) => p.capabilityStatus === "ANALYTICS_READY" || p.capabilityStatus === "PUBLISH_READY" || p.capabilityStatus === "FULL").length;
  const available = providers.filter((p) => p.connectionStatus === "AVAILABLE_TO_CONNECT").length;
  const status: CustomerSocialStatus = {
    mode: "customer_safe",
    featureFlag: FEATURE_FLAG_NAME,
    providers,
    counts: { live, ready, available, total: providers.length },
  };
  // Defensive: never emit a forbidden field even if projection changes upstream.
  assertNoForbiddenKeys(status);
  return status;
}
