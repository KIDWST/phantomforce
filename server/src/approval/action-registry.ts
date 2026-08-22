import type { ActionType, PhantomForceAction } from "@phantomforce/contracts";
import { proposeWorkAction } from "../workforce/work-graph.js";

export type ActionExecutionResult = {
  ok: boolean;
  message: string;
  data?: unknown;
};

export type ActionExecutionContext = {
  tenantId: string;
  actor: string;
  idempotencyKey: string;
  correlationId?: string;
};

export type ActionHandler<TAction extends PhantomForceAction = PhantomForceAction> = {
  type: ActionType;
  sideEffect: "none" | "internal" | "external" | "falcon";
  execute: (action: TAction, context: ActionExecutionContext) => Promise<ActionExecutionResult>;
};

const notImplemented = async (action: PhantomForceAction, _context: ActionExecutionContext): Promise<ActionExecutionResult> => ({
  ok: false,
  message: `${action.type} is registered as a contract but does not have an execution handler yet.`,
});

const executeThroughWorkGraph = async (action: PhantomForceAction, context: ActionExecutionContext): Promise<ActionExecutionResult> => {
  const result = await proposeWorkAction({
    tenantId: context.tenantId,
    actor: context.actor,
    action,
    idempotencyKey: context.idempotencyKey,
    correlationId: context.correlationId,
  });
  const executed = result.result.action;
  return {
    ok: executed.status === "verified_complete" || executed.status === "awaiting_approval",
    message: executed.receipt?.summary || `${executed.type} is ${executed.status}.`,
    data: { action: executed, replayed: result.result.replayed },
  };
};

/* Presence in the registry is NOT proof an action can run. Callers deciding
   "can I do this?" must ask this because unsupported action types remain
   contract-only. Supported internal and preparation actions execute through
   the tenant work graph; external effects terminate truthfully as blocked
   until a verified connector executor exists. */
export function isActionImplemented(handler: ActionHandler | undefined): boolean {
  return Boolean(handler) && handler!.execute !== notImplemented;
}

export const actionRegistry: Partial<Record<ActionType, ActionHandler>> = {
  "task.create": {
    type: "task.create",
    sideEffect: "internal",
    execute: executeThroughWorkGraph,
  },
  "note.create": {
    type: "note.create",
    sideEffect: "internal",
    execute: executeThroughWorkGraph,
  },
  "contact.upsert": {
    type: "contact.upsert",
    sideEffect: "internal",
    execute: executeThroughWorkGraph,
  },
  "email.draft": {
    type: "email.draft",
    sideEffect: "internal",
    execute: executeThroughWorkGraph,
  },
  "email.send": {
    type: "email.send",
    sideEffect: "external",
    execute: executeThroughWorkGraph,
  },
  "calendar.event.propose": {
    type: "calendar.event.propose",
    sideEffect: "internal",
    execute: executeThroughWorkGraph,
  },
  "calendar.event.commit": {
    type: "calendar.event.commit",
    sideEffect: "external",
    execute: executeThroughWorkGraph,
  },
  "approval.decision": {
    type: "approval.decision",
    sideEffect: "internal",
    execute: notImplemented,
  },
  "client.access.update": {
    type: "client.access.update",
    sideEffect: "internal",
    execute: notImplemented,
  },
  "client.module.set": {
    type: "client.module.set",
    sideEffect: "internal",
    execute: notImplemented,
  },
  "client.provision": {
    type: "client.provision",
    sideEffect: "internal",
    execute: notImplemented,
  },
};
