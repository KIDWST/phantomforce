import { createHmac } from "node:crypto";
import {
  latestCustomerConnectionRequest,
  requestCustomerConnection,
  type CustomerConnectorId,
} from "./connection-request-store.js";

const CATALOG = [
  { id: "finance-bank", group: "Accounting", name: "Bank account", detail: "Secure transaction sync" },
  { id: "finance-card", group: "Accounting", name: "Credit card", detail: "Secure card transaction sync" },
  { id: "payments-stripe", group: "Payments", name: "Stripe", detail: "Payments and payout activity" },
  { id: "calendar-google", group: "Calendar", name: "Google Calendar", detail: "Appointments and availability" },
  { id: "calendar-outlook", group: "Calendar", name: "Outlook Calendar", detail: "Appointments and availability" },
  { id: "calendar-calendly", group: "Calendar", name: "Calendly", detail: "Bookings and event types" },
  { id: "calendar-icloud", group: "Calendar", name: "Apple / iCloud", detail: "Events and availability" },
  { id: "email-gmail", group: "Email", name: "Gmail", detail: "Approved sends and replies" },
  { id: "email-outlook", group: "Email", name: "Outlook Email", detail: "Approved sends and replies" },
  { id: "email-proton", group: "Email", name: "Proton Mail", detail: "Approved sends and replies" },
  { id: "email-other", group: "Email", name: "Other email", detail: "Secure mail connection" },
  { id: "crm-hubspot", group: "CRM", name: "HubSpot", detail: "Contacts, lifecycle, and activity" },
] as const satisfies ReadonlyArray<{ id: CustomerConnectorId; group: string; name: string; detail: string }>;

function brokerBaseUrl() {
  const value = process.env.PHANTOMFORCE_CONNECTION_BROKER_URL?.trim() || "";
  if (!/^https:\/\//i.test(value) && !/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i.test(value)) return "";
  return value;
}

function brokerState(options: { tenantId: string; connectorId: CustomerConnectorId; requestId: string }) {
  const secret = process.env.PHANTOMFORCE_CONNECTION_BROKER_SECRET?.trim()
    || process.env.PHANTOMFORCE_SESSION_SECRET?.trim()
    || "";
  if (!secret) {
    throw Object.assign(new Error("The account connection broker needs server configuration."), {
      statusCode: 503,
      code: "CONNECTION_BROKER_CONFIGURATION_REQUIRED",
    });
  }
  const payload = Buffer.from(JSON.stringify({ ...options, issuedAt: Date.now() }), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function customerConnectionCatalog(tenantId: string) {
  const brokerConfigured = Boolean(brokerBaseUrl() && (process.env.PHANTOMFORCE_CONNECTION_BROKER_SECRET?.trim() || process.env.PHANTOMFORCE_SESSION_SECRET?.trim()));
  return CATALOG.map((definition) => {
    const request = latestCustomerConnectionRequest(tenantId, definition.id);
    const connected = request?.state === "completed";
    return {
      ...definition,
      state: connected ? "connected" : brokerConfigured ? "available" : "configuration_required",
      action: connected ? "Manage" : brokerConfigured ? "Connect" : "Needs configuration",
      customerMessage: connected
        ? "Connected through the secure account broker."
        : brokerConfigured
          ? "Choose Connect to open the provider's secure sign-in."
          : "The secure account broker must be configured by the platform owner before sign-in can open.",
      requestedAt: request?.requestedAt || null,
      connected,
      brokerConfigured,
      secretsExposed: false,
    };
  });
}

export function startCustomerConnection(options: { tenantId: string; connectorId: CustomerConnectorId; actor: string }) {
  const definition = CATALOG.find((item) => item.id === options.connectorId);
  if (!definition) throw new Error("unsupported_customer_connector");
  const baseUrl = brokerBaseUrl();
  if (!baseUrl) {
    throw Object.assign(new Error("This connection needs platform broker configuration before secure sign-in can open."), {
      statusCode: 503,
      code: "CONNECTION_BROKER_CONFIGURATION_REQUIRED",
    });
  }
  const request = requestCustomerConnection(options);
  const authorizationUrl = new URL(baseUrl);
  authorizationUrl.searchParams.set("connector", options.connectorId);
  authorizationUrl.searchParams.set("state", brokerState({ tenantId: options.tenantId, connectorId: options.connectorId, requestId: request.id }));
  return {
    connector: { ...definition },
    state: "requested" as const,
    request: {
      id: request.id,
      connectorId: request.connectorId,
      state: request.state,
      requestedAt: request.requestedAt,
      attempts: request.attempts,
    },
    authorizationUrl: authorizationUrl.toString(),
    customerMessage: "Secure provider sign-in opened. Finish the provider's approval, then return here to refresh status.",
    externalActionExecuted: false,
    secretsExposed: false,
  };
}
