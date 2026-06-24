import type { ActionType, PhantomForceAction } from "@phantomforce/contracts";

export type ActionExecutionResult = {
  ok: boolean;
  message: string;
  data?: unknown;
};

export type ActionHandler<TAction extends PhantomForceAction = PhantomForceAction> = {
  type: ActionType;
  sideEffect: "none" | "internal" | "external" | "falcon";
  execute: (action: TAction) => Promise<ActionExecutionResult>;
};

const notImplemented = async (action: PhantomForceAction): Promise<ActionExecutionResult> => ({
  ok: false,
  message: `${action.type} is registered as a contract but does not have an execution handler yet.`,
});

export const actionRegistry: Partial<Record<ActionType, ActionHandler>> = {
  "task.create": {
    type: "task.create",
    sideEffect: "internal",
    execute: notImplemented,
  },
  "note.create": {
    type: "note.create",
    sideEffect: "internal",
    execute: notImplemented,
  },
  "contact.upsert": {
    type: "contact.upsert",
    sideEffect: "internal",
    execute: notImplemented,
  },
  "email.draft": {
    type: "email.draft",
    sideEffect: "external",
    execute: notImplemented,
  },
  "email.send": {
    type: "email.send",
    sideEffect: "external",
    execute: notImplemented,
  },
  "calendar.event.propose": {
    type: "calendar.event.propose",
    sideEffect: "internal",
    execute: notImplemented,
  },
  "calendar.event.commit": {
    type: "calendar.event.commit",
    sideEffect: "external",
    execute: notImplemented,
  },
  "approval.decision": {
    type: "approval.decision",
    sideEffect: "internal",
    execute: notImplemented,
  },
};
