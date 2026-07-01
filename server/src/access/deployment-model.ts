export type DeploymentModelAudience = "admin" | "client";

function boolFromEnv(name: string) {
  return ["1", "true", "yes", "on"].includes((process.env[name] ?? "").trim().toLowerCase());
}

function optionalEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function buildDeploymentModelStatus(options: { audience: DeploymentModelAudience }) {
  const publicAppUrl = optionalEnv("PHANTOMFORCE_PUBLIC_APP_URL") ?? "https://app.phantomforce.online";
  const localConnectorEnabled = boolFromEnv("PHANTOMFORCE_LOCAL_CONNECTOR_ENABLED");
  const signedDesktopCompanion = boolFromEnv("PHANTOMFORCE_SIGNED_DESKTOP_COMPANION_READY");
  const productionCloudReady = boolFromEnv("PHANTOMFORCE_PRODUCTION_CLOUD_READY");
  const tenantIsolationReady = boolFromEnv("PHANTOMFORCE_TENANT_ISOLATION_READY");
  const licenseGateReady = boolFromEnv("PHANTOMFORCE_LICENSE_GATE_READY");

  const common = {
    model: "cloud_app_with_optional_local_connector" as const,
    user_facing_product: "PhantomForce" as const,
    user_facing_ai: "PhantomAI" as const,
    public_app_url: publicAppUrl,
    normal_user_surface: "hosted_web_app" as const,
    desktop_companion_role: "optional_local_connector" as const,
    source_code_exposed_to_users: false,
    repo_access_required_for_users: false,
    users_can_modify_product_files: false,
    customer_traffic_should_route_through_jordan_pc: false,
    current_jordan_windows_host_role: "admin_pilot_and_private_connector_only" as const,
    internal_tool_names_hidden_from_clients: true,
    privacy_posture:
      "Customers use the hosted app. Local files and machine actions stay on the customer's own connector when that connector is installed.",
  };

  const clientView = {
    ...common,
    audience: "client" as const,
    control_message: "Your workspace is private to your business. Local machine access is optional and controlled by your installed connector.",
    visible_capabilities: [
      "Ask PhantomAI for work",
      "Review finished artifacts",
      "Approve business actions",
      "Track tasks, bookings, content, reviews, scans, and deliverables",
    ],
    hidden_capabilities: [
      "internal routing",
      "source code",
      "agent tooling names",
      "keys and credentials",
      "server deployment controls",
    ],
    local_connector: {
      available: localConnectorEnabled,
      status: localConnectorEnabled ? "available_when_installed" : "not_installed",
      customer_owned: true,
      outbound_only: true,
      raw_files_uploaded_by_default: false,
      purpose: "Local files, scans, desktop creative tools, and private machine actions.",
    },
  };

  if (options.audience === "client") return clientView;

  return {
    ...common,
    audience: "admin" as const,
    recommended_architecture: "Cloud-first SaaS control plane plus optional customer-owned desktop connector.",
    commercial_posture: productionCloudReady ? "cloud_ready" : "pilot_needs_cloud_hardening",
    production_cloud_ready: productionCloudReady,
    tenant_isolation_ready: tenantIsolationReady,
    license_gate_ready: licenseGateReady,
    signed_desktop_companion_ready: signedDesktopCompanion,
    local_connector_enabled: localConnectorEnabled,
    client_copy_resistance: [
      "Keep orchestration, billing, access control, and provider routing server-side.",
      "Ship no provider keys or source repositories to customers.",
      "Use account, subscription, tenant, and license gates for every valuable capability.",
      "Make desktop companion builds signed, minimal, and useless without a valid PhantomForce account.",
      "Expose PhantomAI outcomes, not Codex, Claude, GLM, n8n, source paths, or internal scripts.",
    ],
    admin_operating_rules: [
      "Jordan's PC may host the admin pilot, but must not become the long-term customer traffic hub.",
      "Every paid customer needs a tenant/workspace, not a clone of the source tree.",
      "Every local action must be connector-scoped to that customer's machine and outbound-only.",
      "External sends, billing, deletes, deployments, and provider spend require explicit approval gates.",
    ],
    local_connector: {
      enabled: localConnectorEnabled,
      recommended_transport: "outbound_only",
      customer_owned: true,
      stores_customer_files_locally: true,
      raw_files_uploaded_by_default: false,
      source_code_shipped: false,
      role: "Desktop bridge for local files, scans, Resolve/Reaper/PhantomCut, and private machine actions.",
      production_requirements: [
        "signed installer",
        "per-tenant device registration",
        "license check",
        "revocation path",
        "audit receipts",
        "least-privilege action allowlist",
      ],
    },
    safety_flags: {
      read_only_status: true,
      provider_called: false,
      external_network_call_performed: false,
      deployment_changed: false,
      credential_read: false,
      customer_data_mutated: false,
    },
  };
}
