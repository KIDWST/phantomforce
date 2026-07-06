import type { ClientAccessRecord } from "../access/client-access-state.js";
import {
  resolveConnectorCredentialBoundary,
  type ConnectorCredentialBoundary,
} from "./credential-boundary.js";

export type CalendarConnectorEvent = {
  id: string;
  title: string;
  startsAt: string;
  status: "scheduled" | "open" | "hold";
};

export type CalendarReadModel = {
  connectorId: "calendar";
  provider: "local-demo-calendar" | "none";
  live: false;
  available: boolean;
  credentialBoundary: ConnectorCredentialBoundary;
  events: CalendarConnectorEvent[];
  stats: {
    priorityBlocks: number;
    nextDeadline: string;
  };
  fetchedAt: string;
};

function localCalendarEvents(record: ClientAccessRecord): CalendarConnectorEvent[] {
  return [
    {
      id: `${record.id}-calendar-delivery-review`,
      title: `${record.business} delivery review`,
      startsAt: "2026-06-26T15:00:00.000Z",
      status: "scheduled",
    },
    {
      id: `${record.id}-calendar-follow-up-window`,
      title: `${record.business} follow-up window`,
      startsAt: "2026-06-27T16:30:00.000Z",
      status: "open",
    },
  ];
}

export async function readClientCalendar(record: ClientAccessRecord): Promise<CalendarReadModel> {
  const credentialBoundary = resolveConnectorCredentialBoundary(
    "calendar",
    record.connectorCredentials.calendar,
  );

  if (credentialBoundary.status !== "available") {
    return {
      connectorId: "calendar",
      provider: credentialBoundary.provider,
      live: false,
      available: false,
      credentialBoundary,
      events: [],
      stats: {
        priorityBlocks: 0,
        nextDeadline: "Calendar credential reference missing",
      },
      fetchedAt: new Date().toISOString(),
    };
  }

  const events = localCalendarEvents(record);

  return {
    connectorId: "calendar",
    provider: credentialBoundary.provider,
    live: false,
    available: true,
    credentialBoundary,
    events,
    stats: {
      priorityBlocks: events.length,
      nextDeadline: events[0]?.title ?? "No scheduled calendar records",
    },
    fetchedAt: new Date().toISOString(),
  };
}
