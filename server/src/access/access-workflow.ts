import { z } from "zod";

import { accessRepository } from "./access-repository.js";
import {
  getProvisioningBillingMetadata,
  type BillingProviderId,
  type BillingSourceOfTruth,
} from "./billing-provider.js";
import {
  ClientAccessStatusSchema,
  PaymentStatusSchema,
  buildProvisionedClientAccess,
  defaultPrivateRouteForBusiness,
  deriveAccessStatusFromPayment,
  getAccessDecision,
  getClientAccess,
  provisionClientAccess,
  setClientModule,
  updateClientAccess,
  type ClientAccessRecord,
  type ClientAccessStatus,
  type PaymentStatus,
} from "./client-access-state.js";

export const AccessChangeProposalSchema = z.object({
  accessStatus: ClientAccessStatusSchema,
  reason: z.string().min(1),
  proposedBy: z.string().min(1).default("Jordan"),
});

export const AccessModuleSetProposalSchema = z.object({
  moduleKey: z.string().min(1),
  enabled: z.boolean(),
  reason: z.string().min(1),
  proposedBy: z.string().min(1).default("Jordan"),
});

export const AccessModuleSetProposalBodySchema = AccessModuleSetProposalSchema.omit({
  moduleKey: true,
});

export const AccessApprovalDecisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  decidedBy: z.string().min(1).default("Jordan"),
  reason: z.string().optional(),
});

export const ClientProvisionProposalSchema = z.object({
  clientId: z.string().min(1),
  business: z.string().min(1),
  owner: z.string().min(1).default("Client Owner"),
  plan: z.string().min(1),
  source: z.enum(["nexprospex", "manual", "crm"]).default("manual"),
  sourceRecordId: z.string().optional(),
  winStatus: z.enum(["signed_agreement", "payment_received"]),
  paymentStatus: PaymentStatusSchema,
  privateRoute: z.string().min(1).optional(),
  modules: z.array(z.string().min(1)).min(1).default(["Command", "Calendar", "Tasks", "Approvals", "Contacts"]),
  reason: z.string().min(1),
  proposedBy: z.string().min(1).default("Jordan"),
});

export type ClientProvisionProposal = z.infer<typeof ClientProvisionProposalSchema>;
export type AccessActionStatus = "pending_approval" | "approved" | "rejected" | "executed";

export type AccessChangeAction = {
  id: string;
  type: "client.access.update";
  clientId: string;
  business: string;
  proposedBy: string;
  rationale: string;
  requestedStatus: ClientAccessStatus;
  previousStatus: ClientAccessStatus;
  status: AccessActionStatus;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
};

export type AccessModuleSetAction = {
  id: string;
  type: "client.module.set";
  clientId: string;
  business: string;
  proposedBy: string;
  rationale: string;
  moduleKey: string;
  enabled: boolean;
  previousEnabled: boolean;
  status: AccessActionStatus;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
};

export type ClientProvisionAction = {
  id: string;
  type: "client.provision";
  clientId: string;
  business: string;
  proposedBy: string;
  rationale: string;
  source: "nexprospex" | "manual" | "crm";
  sourceRecordId?: string;
  winStatus: "signed_agreement" | "payment_received";
  billingProvider: BillingProviderId;
  billingSourceOfTruth: BillingSourceOfTruth;
  paymentStatus: PaymentStatus;
  accessStatus: ClientAccessStatus;
  owner: string;
  plan: string;
  privateRoute: string;
  modules: string[];
  previousExists: boolean;
  status: AccessActionStatus;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
};

export type AccessWorkflowAction = AccessChangeAction | AccessModuleSetAction | ClientProvisionAction;

export type AccessApproval = {
  id: string;
  actionId: string;
  clientId: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  reason?: string;
};

export type AccessAuditEvent = {
  id: string;
  actor: string;
  eventType:
    | "client.access.proposed"
    | "client.access.approved"
    | "client.access.rejected"
    | "client.module.proposed"
    | "client.module.approved"
    | "client.module.rejected"
    | "client.provision.proposed"
    | "client.provision.approved"
    | "client.provision.rejected";
  clientId: string;
  business: string;
  previousStatus?: ClientAccessStatus;
  nextStatus?: ClientAccessStatus;
  moduleKey?: string;
  previousEnabled?: boolean;
  nextEnabled?: boolean;
  paymentStatus?: PaymentStatus;
  source?: "nexprospex" | "manual" | "crm";
  billingProvider?: BillingProviderId;
  billingSourceOfTruth?: BillingSourceOfTruth;
  reason: string;
  actionId: string;
  approvalId?: string;
  createdAt: string;
};

const accessActions = new Map<string, AccessWorkflowAction>();
const accessApprovals = new Map<string, AccessApproval>();
const accessAuditEvents: AccessAuditEvent[] = [];

let initialized = false;

export async function initializeAccessWorkflowState() {
  if (initialized) return;

  const workflowSnapshot = await accessRepository.loadAccessWorkflow();
  accessActions.clear();
  accessApprovals.clear();
  accessAuditEvents.splice(0, accessAuditEvents.length, ...workflowSnapshot.auditEvents);

  for (const action of workflowSnapshot.actions) {
    accessActions.set(action.id, action);
  }

  for (const approval of workflowSnapshot.approvals) {
    accessApprovals.set(approval.id, approval);
  }

  initialized = true;
}

async function persistWorkflow() {
  await accessRepository.saveAccessWorkflow({
    actions: listAccessActions(),
    approvals: listAccessApprovals(),
    auditEvents: listAccessAuditEvents(),
  });
}

function makeId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function now() {
  return new Date().toISOString();
}

function appendAudit(event: Omit<AccessAuditEvent, "id" | "createdAt">) {
  const auditEvent: AccessAuditEvent = {
    id: makeId("audit"),
    createdAt: now(),
    ...event,
  };

  accessAuditEvents.unshift(auditEvent);

  return auditEvent;
}

export function listAccessActions() {
  return Array.from(accessActions.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function listAccessApprovals() {
  return Array.from(accessApprovals.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function listAccessAuditEvents() {
  return accessAuditEvents;
}

export async function proposeAccessChange(
  clientId: string,
  accessStatus: ClientAccessStatus,
  reason: string,
  proposedBy: string,
) {
  const record = getClientAccess(clientId);

  if (!record) {
    return undefined;
  }

  const actionId = makeId("act");
  const approvalId = makeId("appr");
  const createdAt = now();
  const action: AccessChangeAction = {
    id: actionId,
    type: "client.access.update",
    clientId,
    business: record.business,
    proposedBy,
    rationale: reason,
    requestedStatus: accessStatus,
    previousStatus: record.accessStatus,
    status: "pending_approval",
    createdAt,
  };
  const approval: AccessApproval = {
    id: approvalId,
    actionId,
    clientId,
    status: "pending",
    createdAt,
  };

  accessActions.set(actionId, action);
  accessApprovals.set(approvalId, approval);

  const auditEvent = appendAudit({
    actor: proposedBy,
    eventType: "client.access.proposed",
    clientId,
    business: record.business,
    previousStatus: record.accessStatus,
    nextStatus: accessStatus,
    reason,
    actionId,
    approvalId,
  });
  await persistWorkflow();

  return {
    action,
    approval,
    auditEvent,
    record,
    decision: getAccessDecision(clientId),
  };
}

function hasModule(record: ClientAccessRecord, moduleKey: string) {
  const requested = moduleKey.trim().toLowerCase();
  return record.modules.some((module) => module.trim().toLowerCase() === requested);
}

export async function proposeModuleSet(
  clientId: string,
  moduleKey: string,
  enabled: boolean,
  reason: string,
  proposedBy: string,
) {
  const record = getClientAccess(clientId);

  if (!record) {
    return undefined;
  }

  const actionId = makeId("act");
  const approvalId = makeId("appr");
  const createdAt = now();
  const action: AccessModuleSetAction = {
    id: actionId,
    type: "client.module.set",
    clientId,
    business: record.business,
    proposedBy,
    rationale: reason,
    moduleKey,
    enabled,
    previousEnabled: hasModule(record, moduleKey),
    status: "pending_approval",
    createdAt,
  };
  const approval: AccessApproval = {
    id: approvalId,
    actionId,
    clientId,
    status: "pending",
    createdAt,
  };

  accessActions.set(actionId, action);
  accessApprovals.set(approvalId, approval);

  const auditEvent = appendAudit({
    actor: proposedBy,
    eventType: "client.module.proposed",
    clientId,
    business: record.business,
    moduleKey,
    previousEnabled: action.previousEnabled,
    nextEnabled: enabled,
    reason,
    actionId,
    approvalId,
  });
  await persistWorkflow();

  return {
    action,
    approval,
    auditEvent,
    record,
    decision: getAccessDecision(clientId),
  };
}

export function dryRunClientProvision(input: ClientProvisionProposal) {
  const previousRecord = getClientAccess(input.clientId);
  const accessStatus = deriveAccessStatusFromPayment(input.paymentStatus);
  const privateRoute = input.privateRoute ?? defaultPrivateRouteForBusiness(input.business);
  const billing = getProvisioningBillingMetadata();
  const record = buildProvisionedClientAccess(
    {
      clientId: input.clientId,
      business: input.business,
      owner: input.owner,
      plan: input.plan,
      paymentStatus: input.paymentStatus,
      privateRoute,
      modules: input.modules,
    },
    input.reason,
  );

  return {
    ...billing,
    clientId: input.clientId,
    business: input.business,
    source: input.source,
    sourceRecordId: input.sourceRecordId,
    winStatus: input.winStatus,
    paymentStatus: input.paymentStatus,
    accessStatus,
    privateRoute,
    modules: input.modules,
    willCreate: !previousRecord,
    willUpdate: Boolean(previousRecord),
    previousAccessStatus: previousRecord?.accessStatus,
    previousPaymentStatus: previousRecord?.paymentStatus,
    workspaceAllowedAfterApproval: accessStatus === "active",
    record,
    reason:
      accessStatus === "active"
        ? "Paid provisioning will create an active client workspace."
        : "Unpaid provisioning creates a blocked workspace until payment is marked paid.",
  };
}

export async function proposeClientProvision(input: ClientProvisionProposal) {
  const plan = dryRunClientProvision(input);
  const actionId = makeId("act");
  const approvalId = makeId("appr");
  const createdAt = now();
  const action: ClientProvisionAction = {
    id: actionId,
    type: "client.provision",
    clientId: input.clientId,
    business: input.business,
    proposedBy: input.proposedBy,
    rationale: input.reason,
    source: input.source,
    sourceRecordId: input.sourceRecordId,
    winStatus: input.winStatus,
    billingProvider: plan.billingProvider,
    billingSourceOfTruth: plan.billingSourceOfTruth,
    paymentStatus: input.paymentStatus,
    accessStatus: plan.accessStatus,
    owner: input.owner,
    plan: input.plan,
    privateRoute: plan.privateRoute,
    modules: input.modules,
    previousExists: plan.willUpdate,
    status: "pending_approval",
    createdAt,
  };
  const approval: AccessApproval = {
    id: approvalId,
    actionId,
    clientId: input.clientId,
    status: "pending",
    createdAt,
  };

  accessActions.set(actionId, action);
  accessApprovals.set(approvalId, approval);

  const auditEvent = appendAudit({
    actor: input.proposedBy,
    eventType: "client.provision.proposed",
    clientId: input.clientId,
    business: input.business,
    nextStatus: plan.accessStatus,
    paymentStatus: input.paymentStatus,
    source: input.source,
    billingProvider: plan.billingProvider,
    billingSourceOfTruth: plan.billingSourceOfTruth,
    reason: input.reason,
    actionId,
    approvalId,
  });
  await persistWorkflow();

  return {
    action,
    approval,
    auditEvent,
    plan,
  };
}

export async function decideAccessApproval(
  approvalId: string,
  decision: "approve" | "reject",
  decidedBy: string,
  reason?: string,
) {
  const approval = accessApprovals.get(approvalId);

  if (!approval) {
    return undefined;
  }

  const action = accessActions.get(approval.actionId);

  if (!action) {
    return undefined;
  }

  if (approval.status !== "pending") {
    const record = getClientAccess(approval.clientId);
    return {
      action,
      approval,
      record,
      decision: record ? getAccessDecision(record.id) : undefined,
      auditEvent: undefined,
      alreadyDecided: true,
    };
  }

  const decidedAt = now();
  const status = decision === "approve" ? "approved" : "rejected";
  const updatedApproval: AccessApproval = {
    ...approval,
    status,
    decidedAt,
    decidedBy,
    reason,
  };
  accessApprovals.set(approvalId, updatedApproval);

  if (action.type === "client.provision") {
    const updatedAction: ClientProvisionAction = {
      ...action,
      status: decision === "approve" ? "approved" : "rejected",
      decidedAt,
      decidedBy,
    };
    accessActions.set(action.id, updatedAction);

    if (decision === "reject") {
      const auditEvent = appendAudit({
        actor: decidedBy,
        eventType: "client.provision.rejected",
        clientId: action.clientId,
        business: action.business,
        nextStatus: action.accessStatus,
        paymentStatus: action.paymentStatus,
        source: action.source,
        billingProvider: action.billingProvider,
        billingSourceOfTruth: action.billingSourceOfTruth,
        reason: reason ?? action.rationale,
        actionId: action.id,
        approvalId,
      });
      await persistWorkflow();

      return {
        action: updatedAction,
        approval: updatedApproval,
        record: getClientAccess(action.clientId),
        decision: getClientAccess(action.clientId) ? getAccessDecision(action.clientId) : undefined,
        auditEvent,
        alreadyDecided: false,
      };
    }

    const record = await provisionClientAccess(
      {
        clientId: action.clientId,
        business: action.business,
        owner: action.owner,
        plan: action.plan,
        paymentStatus: action.paymentStatus,
        privateRoute: action.privateRoute,
        modules: action.modules,
      },
      reason ?? action.rationale,
    );
    const executedAction: ClientProvisionAction = {
      ...updatedAction,
      status: "executed",
    };
    accessActions.set(action.id, executedAction);

    const auditEvent = appendAudit({
      actor: decidedBy,
      eventType: "client.provision.approved",
      clientId: action.clientId,
      business: action.business,
      nextStatus: action.accessStatus,
      paymentStatus: action.paymentStatus,
      source: action.source,
      billingProvider: action.billingProvider,
      billingSourceOfTruth: action.billingSourceOfTruth,
      reason: reason ?? action.rationale,
      actionId: action.id,
      approvalId,
    });
    await persistWorkflow();

    return {
      action: executedAction,
      approval: updatedApproval,
      record,
      decision: getAccessDecision(action.clientId),
      auditEvent,
      alreadyDecided: false,
    };
  }

  if (action.type === "client.module.set") {
    const updatedAction: AccessModuleSetAction = {
      ...action,
      status: decision === "approve" ? "approved" : "rejected",
      decidedAt,
      decidedBy,
    };
    accessActions.set(action.id, updatedAction);

    if (decision === "reject") {
      const record = getClientAccess(action.clientId);
      const auditEvent = appendAudit({
        actor: decidedBy,
        eventType: "client.module.rejected",
        clientId: action.clientId,
        business: action.business,
        moduleKey: action.moduleKey,
        previousEnabled: action.previousEnabled,
        nextEnabled: action.enabled,
        reason: reason ?? action.rationale,
        actionId: action.id,
        approvalId,
      });
      await persistWorkflow();

      return {
        action: updatedAction,
        approval: updatedApproval,
        record,
        decision: record ? getAccessDecision(record.id) : undefined,
        auditEvent,
        alreadyDecided: false,
      };
    }

    const record = await setClientModule(action.clientId, action.moduleKey, action.enabled, reason ?? action.rationale);
    const executedAction: AccessModuleSetAction = {
      ...updatedAction,
      status: "executed",
    };
    accessActions.set(action.id, executedAction);

    const auditEvent = appendAudit({
      actor: decidedBy,
      eventType: "client.module.approved",
      clientId: action.clientId,
      business: action.business,
      moduleKey: action.moduleKey,
      previousEnabled: action.previousEnabled,
      nextEnabled: action.enabled,
      reason: reason ?? action.rationale,
      actionId: action.id,
      approvalId,
    });
    await persistWorkflow();

    return {
      action: executedAction,
      approval: updatedApproval,
      record: record as ClientAccessRecord,
      decision: getAccessDecision(action.clientId),
      auditEvent,
      alreadyDecided: false,
    };
  }

  const updatedAction: AccessChangeAction = {
    ...action,
    status: decision === "approve" ? "approved" : "rejected",
    decidedAt,
    decidedBy,
  };
  accessActions.set(action.id, updatedAction);

  if (decision === "reject") {
    const record = getClientAccess(action.clientId);
    const auditEvent = appendAudit({
      actor: decidedBy,
      eventType: "client.access.rejected",
      clientId: action.clientId,
      business: action.business,
      previousStatus: action.previousStatus,
      nextStatus: action.requestedStatus,
      reason: reason ?? action.rationale,
      actionId: action.id,
      approvalId,
    });
    await persistWorkflow();

    return {
      action: updatedAction,
      approval: updatedApproval,
      record,
      decision: record ? getAccessDecision(record.id) : undefined,
      auditEvent,
      alreadyDecided: false,
    };
  }

  const record = await updateClientAccess(action.clientId, action.requestedStatus, reason ?? action.rationale);
  const executedAction: AccessChangeAction = {
    ...updatedAction,
    status: "executed",
  };
  accessActions.set(action.id, executedAction);

  const auditEvent = appendAudit({
    actor: decidedBy,
    eventType: "client.access.approved",
    clientId: action.clientId,
    business: action.business,
    previousStatus: action.previousStatus,
    nextStatus: action.requestedStatus,
    reason: reason ?? action.rationale,
    actionId: action.id,
    approvalId,
  });
  await persistWorkflow();

  return {
    action: executedAction,
    approval: updatedApproval,
    record: record as ClientAccessRecord,
    decision: getAccessDecision(action.clientId),
    auditEvent,
    alreadyDecided: false,
  };
}
