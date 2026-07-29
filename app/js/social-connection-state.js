/* Normalize the admin connector payload and the customer-safe Social Connect
   v2 payload into one UI shape. */

const CONNECTED_STATES = new Set(["CONNECTED", "LIMITED_PERMISSIONS"]);

export function socialConnectorsFromResponse(payload = {}) {
  const legacy = payload?.social_analytics?.connectors;
  if (Array.isArray(legacy)) return legacy;
  const providers = payload?.social_connections?.providers;
  if (!Array.isArray(providers)) return [];

  return providers.map((provider) => {
    const configured = CONNECTED_STATES.has(provider.connectionStatus);
    return {
      id: provider.provider,
      name: provider.name,
      configured,
      live: configured,
      oauthConfigured: Boolean(provider.globallyAvailable),
      handle: provider.username || provider.savedHandleReference || "",
      reason: provider.customerMessage || "",
      connectionStatus: provider.connectionStatus,
      capabilityStatus: provider.capabilityStatus,
      action: provider.action,
      savedConnection: configured ? {
        connected: true,
        accountName: provider.displayName || "",
        accountHandle: provider.username || "",
        avatarUrl: provider.avatarUrl || "",
        selectedAssetName: provider.selectedAssetName || "",
        grantedScopes: provider.grantedCapabilities || [],
      } : null,
    };
  });
}

export function socialPreflightFromResponse(payload = {}, connectors = socialConnectorsFromResponse(payload)) {
  if (payload?.social_analytics?.oauthPreflight) return payload.social_analytics.oauthPreflight;
  return {
    readyCount: connectors.filter((connector) => connector.oauthConfigured).length,
    authorizedCount: connectors.filter((connector) => connector.configured).length,
    totalCount: connectors.length,
    platforms: connectors.map((connector) => ({
      id: connector.id,
      name: connector.name,
      oauthAppReady: connector.oauthConfigured,
      accountAuthorized: connector.configured,
      canStartOAuth: connector.oauthConfigured && !connector.configured,
      canSync: connector.configured,
      nextAction: connector.configured ? "sync_live_feed" : connector.oauthConfigured ? "connect_signed_in_account" : "temporarily_unavailable",
      nextLabel: connector.configured ? "Sync live feed" : connector.oauthConfigured ? "Connect account" : "Temporarily unavailable",
      nextDetail: connector.reason,
    })),
  };
}
