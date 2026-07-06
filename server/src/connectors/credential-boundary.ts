export type ConnectorCredentialBoundary = {
  connectorId: string;
  provider: "local-demo-calendar" | "none";
  credentialMode: "local_demo" | "missing";
  credentialSource: "workspace_reference" | "none";
  credentialRef: string | null;
  workspaceId: string | null;
  scopes: string[];
  status: "available" | "missing";
  readOnly: true;
  liveCredentialsAllowed: false;
  live: false;
  reason: string;
};

export type ConnectorCredentialReference = {
  connectorId: string;
  provider: "local-demo-calendar";
  credentialMode: "local_demo";
  credentialRef: string;
  workspaceId: string;
  scopes: string[];
  status: "available";
  readOnly: true;
  live: false;
  reason: string;
};

export function getLocalDemoCredentialReference(
  connectorId: string,
  workspaceId: string,
): ConnectorCredentialReference {
  return {
    connectorId,
    provider: "local-demo-calendar",
    credentialMode: "local_demo",
    credentialRef: `local-demo:${workspaceId}:${connectorId}`,
    workspaceId,
    scopes: [],
    status: "available",
    readOnly: true,
    live: false,
    reason: "Local demo credential reference: no live credential material is stored.",
  };
}

export function resolveConnectorCredentialBoundary(
  connectorId: string,
  reference: ConnectorCredentialReference | undefined,
): ConnectorCredentialBoundary {
  if (!reference) {
    return {
      connectorId,
      provider: "none",
      credentialMode: "missing",
      credentialSource: "none",
      credentialRef: null,
      workspaceId: null,
      scopes: [],
      status: "missing",
      readOnly: true,
      liveCredentialsAllowed: false,
      live: false,
      reason: "Missing connector credential reference; live connector access fails closed.",
    };
  }

  return {
    connectorId: reference.connectorId,
    provider: reference.provider,
    credentialMode: reference.credentialMode,
    credentialSource: "workspace_reference",
    credentialRef: reference.credentialRef,
    workspaceId: reference.workspaceId,
    scopes: reference.scopes,
    status: reference.status,
    readOnly: reference.readOnly,
    liveCredentialsAllowed: false,
    live: reference.live,
    reason: "Local demo connector: credential reference exists, but no live credentials are loaded or exposed.",
  };
}
