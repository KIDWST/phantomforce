import { z } from "zod";

export const FalconJobBaseSchema = z.object({
  jobId: z.string().uuid().optional(),
  orgId: z.string().uuid().optional(),
  type: z.string(),
  requiresApproval: z.literal(true),
  reversible: z.boolean(),
  createdAt: z.string().datetime().optional(),
  rationale: z.string().min(1),
});

export const FalconReadFileJobSchema = FalconJobBaseSchema.extend({
  type: z.literal("falcon.read_file"),
  reversible: z.literal(true),
  payload: z.object({
    path: z.string().min(1),
  }),
});
export type FalconReadFileJob = z.infer<typeof FalconReadFileJobSchema>;

export const FalconWriteFileJobSchema = FalconJobBaseSchema.extend({
  type: z.literal("falcon.write_file"),
  reversible: z.literal(false),
  payload: z.object({
    path: z.string().min(1),
    contents: z.string(),
    mode: z.enum(["create", "overwrite"]),
  }),
});
export type FalconWriteFileJob = z.infer<typeof FalconWriteFileJobSchema>;

export const FalconRunCommandJobSchema = FalconJobBaseSchema.extend({
  type: z.literal("falcon.run_command"),
  reversible: z.literal(false),
  payload: z.object({
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    cwd: z.string().min(1),
    timeoutMs: z.number().int().positive().max(120000),
  }),
});
export type FalconRunCommandJob = z.infer<typeof FalconRunCommandJobSchema>;

export const FalconListDirJobSchema = FalconJobBaseSchema.extend({
  type: z.literal("falcon.list_dir"),
  reversible: z.literal(true),
  payload: z.object({
    path: z.string().min(1),
    depth: z.number().int().min(0).max(5).default(1),
  }),
});
export type FalconListDirJob = z.infer<typeof FalconListDirJobSchema>;

export const FalconHealthCheckJobSchema = FalconJobBaseSchema.extend({
  type: z.literal("falcon.health_check"),
  reversible: z.literal(true),
  payload: z.object({}).default({}),
});
export type FalconHealthCheckJob = z.infer<typeof FalconHealthCheckJobSchema>;

export const FalconJobSchema = z.discriminatedUnion("type", [
  FalconReadFileJobSchema,
  FalconWriteFileJobSchema,
  FalconRunCommandJobSchema,
  FalconListDirJobSchema,
  FalconHealthCheckJobSchema,
]);
export type FalconJob = z.infer<typeof FalconJobSchema>;

export const FALCON_JOB_SCHEMAS = {
  "falcon.read_file": FalconReadFileJobSchema,
  "falcon.write_file": FalconWriteFileJobSchema,
  "falcon.run_command": FalconRunCommandJobSchema,
  "falcon.list_dir": FalconListDirJobSchema,
  "falcon.health_check": FalconHealthCheckJobSchema,
} as const;

export type FalconJobType = keyof typeof FALCON_JOB_SCHEMAS;
