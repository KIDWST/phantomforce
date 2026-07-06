import { z } from "zod";

export const ActionSurfaceSchema = z.enum(["internal", "external"]);
export type ActionSurface = z.infer<typeof ActionSurfaceSchema>;

export const ActionPolicySchema = z.object({
  surface: ActionSurfaceSchema,
  reversible: z.boolean(),
  requiresApproval: z.boolean(),
});
export type ActionPolicy = z.infer<typeof ActionPolicySchema>;

export const ActionBaseSchema = z.object({
  id: z.string().uuid().optional(),
  orgId: z.string().uuid().optional(),
  type: z.string(),
  proposedBy: z.enum(["ai", "user", "system"]).default("ai"),
  rationale: z.string().min(1),
  createdAt: z.string().datetime().optional(),
  policy: ActionPolicySchema,
});

export const EmailDraftActionSchema = ActionBaseSchema.extend({
  type: z.literal("email.draft"),
  policy: z.object({
    surface: z.literal("internal"),
    reversible: z.literal(true),
    requiresApproval: z.literal(true),
  }),
  payload: z.object({
    to: z.array(z.string().email()).min(1),
    subject: z.string().min(1),
    body: z.string().min(1),
    threadId: z.string().optional(),
  }),
});
export type EmailDraftAction = z.infer<typeof EmailDraftActionSchema>;

export const EmailSendActionSchema = ActionBaseSchema.extend({
  type: z.literal("email.send"),
  policy: z.object({
    surface: z.literal("external"),
    reversible: z.literal(false),
    requiresApproval: z.literal(true),
  }),
  payload: z
    .object({
      draftId: z.string().optional(),
      to: z.array(z.string().email()).min(1).optional(),
      subject: z.string().min(1).optional(),
      body: z.string().min(1).optional(),
    })
    .refine((payload) => Boolean(payload.draftId || (payload.to && payload.subject && payload.body)), {
      message: "Provide draftId or full message payload.",
    }),
});
export type EmailSendAction = z.infer<typeof EmailSendActionSchema>;

export const CalendarEventProposeActionSchema = ActionBaseSchema.extend({
  type: z.literal("calendar.event.propose"),
  policy: z.object({
    surface: z.literal("internal"),
    reversible: z.literal(true),
    requiresApproval: z.literal(true),
  }),
  payload: z.object({
    title: z.string().min(1),
    start: z.string().datetime(),
    end: z.string().datetime(),
    attendees: z.array(z.string().email()).default([]),
    description: z.string().optional(),
  }),
});
export type CalendarEventProposeAction = z.infer<typeof CalendarEventProposeActionSchema>;

export const CalendarEventCommitActionSchema = ActionBaseSchema.extend({
  type: z.literal("calendar.event.commit"),
  policy: z.object({
    surface: z.literal("external"),
    reversible: z.literal(true),
    requiresApproval: z.literal(true),
  }),
  payload: z.object({
    proposalId: z.string().uuid(),
  }),
});
export type CalendarEventCommitAction = z.infer<typeof CalendarEventCommitActionSchema>;

export const NoteCreateActionSchema = ActionBaseSchema.extend({
  type: z.literal("note.create"),
  policy: z.object({
    surface: z.literal("internal"),
    reversible: z.literal(true),
    requiresApproval: z.literal(false),
  }),
  payload: z.object({
    title: z.string().min(1),
    body: z.string().min(1),
    tags: z.array(z.string()).default([]),
  }),
});
export type NoteCreateAction = z.infer<typeof NoteCreateActionSchema>;

export const TaskCreateActionSchema = ActionBaseSchema.extend({
  type: z.literal("task.create"),
  policy: z.object({
    surface: z.literal("internal"),
    reversible: z.literal(true),
    requiresApproval: z.literal(false),
  }),
  payload: z.object({
    title: z.string().min(1),
    due: z.string().datetime().optional(),
    priority: z.enum(["low", "medium", "high"]).default("medium"),
    project: z.string().optional(),
  }),
});
export type TaskCreateAction = z.infer<typeof TaskCreateActionSchema>;

export const ContactUpsertActionSchema = ActionBaseSchema.extend({
  type: z.literal("contact.upsert"),
  policy: z.object({
    surface: z.literal("internal"),
    reversible: z.literal(true),
    requiresApproval: z.literal(false),
  }),
  payload: z.object({
    contactId: z.string().uuid().optional(),
    name: z.string().min(1),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    organization: z.string().optional(),
  }),
});
export type ContactUpsertAction = z.infer<typeof ContactUpsertActionSchema>;

export const ApprovalDecisionActionSchema = ActionBaseSchema.extend({
  type: z.literal("approval.decision"),
  policy: z.object({
    surface: z.literal("internal"),
    reversible: z.literal(false),
    requiresApproval: z.literal(false),
  }),
  payload: z.object({
    targetActionId: z.string().uuid(),
    decision: z.enum(["approve", "reject"]),
    note: z.string().optional(),
  }),
});
export type ApprovalDecisionAction = z.infer<typeof ApprovalDecisionActionSchema>;

export const ClientAccessUpdateActionSchema = ActionBaseSchema.extend({
  type: z.literal("client.access.update"),
  policy: z.object({
    surface: z.literal("internal"),
    reversible: z.literal(true),
    requiresApproval: z.literal(true),
  }),
  payload: z.object({
    targetOrgId: z.string().uuid(),
    accessStatus: z.enum(["active", "past_due", "suspended", "revoked"]),
    paymentStatus: z.enum(["trialing", "paid", "due", "failed", "cancelled"]),
    privateRoute: z.string().min(1).optional(),
    reason: z.string().min(1),
  }),
});
export type ClientAccessUpdateAction = z.infer<typeof ClientAccessUpdateActionSchema>;

export const ClientModuleSetActionSchema = ActionBaseSchema.extend({
  type: z.literal("client.module.set"),
  policy: z.object({
    surface: z.literal("internal"),
    reversible: z.literal(true),
    requiresApproval: z.literal(true),
  }),
  payload: z.object({
    targetOrgId: z.string().uuid(),
    moduleKey: z.string().min(1),
    enabled: z.boolean(),
    reason: z.string().min(1),
  }),
});
export type ClientModuleSetAction = z.infer<typeof ClientModuleSetActionSchema>;

export const ClientProvisionActionSchema = ActionBaseSchema.extend({
  type: z.literal("client.provision"),
  policy: z.object({
    surface: z.literal("internal"),
    reversible: z.literal(true),
    requiresApproval: z.literal(true),
  }),
  payload: z.object({
    clientId: z.string().min(1),
    business: z.string().min(1),
    owner: z.string().min(1),
    plan: z.string().min(1),
    source: z.enum(["nexprospex", "manual", "crm"]),
    sourceRecordId: z.string().optional(),
    winStatus: z.enum(["signed_agreement", "payment_received"]),
    billingProvider: z.literal("manual-json-file").default("manual-json-file"),
    billingSourceOfTruth: z.literal("local-manual-provider").default("local-manual-provider"),
    paymentStatus: z.enum(["paid", "due", "failed"]),
    privateRoute: z.string().min(1).optional(),
    modules: z.array(z.string().min(1)).min(1),
    reason: z.string().min(1),
  }),
});
export type ClientProvisionAction = z.infer<typeof ClientProvisionActionSchema>;

export const ActionSchema = z.union([
  EmailDraftActionSchema,
  EmailSendActionSchema,
  CalendarEventProposeActionSchema,
  CalendarEventCommitActionSchema,
  NoteCreateActionSchema,
  TaskCreateActionSchema,
  ContactUpsertActionSchema,
  ApprovalDecisionActionSchema,
  ClientAccessUpdateActionSchema,
  ClientModuleSetActionSchema,
  ClientProvisionActionSchema,
]);
export type PhantomForceAction = z.infer<typeof ActionSchema>;

export const ACTION_SCHEMAS = {
  "email.draft": EmailDraftActionSchema,
  "email.send": EmailSendActionSchema,
  "calendar.event.propose": CalendarEventProposeActionSchema,
  "calendar.event.commit": CalendarEventCommitActionSchema,
  "note.create": NoteCreateActionSchema,
  "task.create": TaskCreateActionSchema,
  "contact.upsert": ContactUpsertActionSchema,
  "approval.decision": ApprovalDecisionActionSchema,
  "client.access.update": ClientAccessUpdateActionSchema,
  "client.module.set": ClientModuleSetActionSchema,
  "client.provision": ClientProvisionActionSchema,
} as const;

export type ActionType = keyof typeof ACTION_SCHEMAS;
