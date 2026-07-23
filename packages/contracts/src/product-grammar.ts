import { z } from "zod";

export const CanonicalOperationStatusSchema = z.enum([
  "draft",
  "queued",
  "executing",
  "verifying",
  "needs-approval",
  "scheduled",
  "verified",
  "live",
  "published",
  "paid",
  "connected",
  "partial",
  "failed",
  "cancelled",
  "rejected",
  "expired",
  "unavailable",
  "stale",
  "test",
  "unknown",
]);
export type CanonicalOperationStatus = z.infer<typeof CanonicalOperationStatusSchema>;

export const VerificationEvidenceSchema = z.object({
  status: z.enum(["verified", "unverified", "failed"]),
  checkedAt: z.string().datetime(),
  method: z.string().min(1),
  summary: z.string().min(1),
  references: z.array(z.string().min(1)).default([]),
});
export type VerificationEvidence = z.infer<typeof VerificationEvidenceSchema>;

export const ActionReceiptSchema = z.object({
  id: z.string().min(1),
  actor: z.object({
    type: z.enum(["user", "agent", "system", "provider"]),
    id: z.string().min(1),
    label: z.string().min(1).optional(),
  }),
  orgId: z.string().min(1),
  workspaceId: z.string().min(1),
  module: z.string().min(1),
  objectType: z.string().min(1),
  objectId: z.string().min(1),
  action: z.string().min(1),
  timestamp: z.string().datetime(),
  inputHash: z.string().min(1).optional(),
  payloadHash: z.string().min(1).optional(),
  previousState: z.unknown().optional(),
  nextState: z.unknown(),
  status: CanonicalOperationStatusSchema,
  runId: z.string().min(1).optional(),
  approvalId: z.string().min(1).optional(),
  providerRef: z.string().min(1).optional(),
  buildRef: z.string().min(1).optional(),
  deploymentRef: z.string().min(1).optional(),
  verification: VerificationEvidenceSchema,
  summary: z.string().min(1),
  recovery: z.object({
    label: z.string().min(1),
    href: z.string().min(1),
  }).optional(),
});
export type ActionReceipt = z.infer<typeof ActionReceiptSchema>;

const TERMINAL_CLAIMS = new Set<CanonicalOperationStatus>([
  "verified",
  "live",
  "published",
  "paid",
  "connected",
]);

export function assertVerifiedTerminalStatus(receipt: ActionReceipt): ActionReceipt {
  if (TERMINAL_CLAIMS.has(receipt.status) && receipt.verification.status !== "verified") {
    throw new Error(`${receipt.status} requires verified evidence.`);
  }
  return receipt;
}

export function parseActionReceipt(value: unknown): ActionReceipt {
  return assertVerifiedTerminalStatus(ActionReceiptSchema.parse(value));
}
