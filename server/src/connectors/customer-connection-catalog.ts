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

export function customerConnectionCatalog(tenantId: string) {
  return CATALOG.map((definition) => {
    const request = latestCustomerConnectionRequest(tenantId, definition.id);
    return {
      ...definition,
      state: request?.state === "completed" ? "connected" : request?.state === "requested" ? "requested" : "disconnected",
      action: request?.state === "completed" ? "Manage" : "Connect",
      customerMessage: request?.state === "requested"
        ? "Your connection request is saved. Continue from this same Connect button when secure sign-in opens. Nothing else is needed from you."
        : "Choose Connect. PhantomForce handles the secure provider handoff and account protection.",
      requestedAt: request?.requestedAt || null,
      connected: request?.state === "completed",
      secretsExposed: false,
    };
  });
}

export function startCustomerConnection(options: { tenantId: string; connectorId: CustomerConnectorId; actor: string }) {
  const definition = CATALOG.find((item) => item.id === options.connectorId);
  if (!definition) throw new Error("unsupported_customer_connector");
  const request = requestCustomerConnection(options);
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
    authorizationUrl: null,
    customerMessage: "Connection requested. Nothing else is needed from you. PhantomForce will present secure provider sign-in here when it is available.",
    externalActionExecuted: false,
    secretsExposed: false,
  };
}
