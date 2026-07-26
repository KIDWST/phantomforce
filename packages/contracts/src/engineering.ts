import { z } from "zod";

const RelativePathSchema = z.string().min(1).max(500);
const OperationBaseSchema = z.object({
  id: z.string().min(1).max(100),
  summary: z.string().min(1).max(500),
});

export const EngineeringReadOperationSchema = z.discriminatedUnion("kind", [
  OperationBaseSchema.extend({
    kind: z.literal("repo_status"),
  }),
  OperationBaseSchema.extend({
    kind: z.literal("search_text"),
    query: z.string().min(1).max(500),
    path: RelativePathSchema.default("."),
    maxResults: z.number().int().min(1).max(200).default(50),
  }),
  OperationBaseSchema.extend({
    kind: z.literal("list_files"),
    path: RelativePathSchema.default("."),
    depth: z.number().int().min(0).max(5).default(2),
    maxEntries: z.number().int().min(1).max(500).default(200),
  }),
  OperationBaseSchema.extend({
    kind: z.literal("read_text_file"),
    path: RelativePathSchema,
    maxBytes: z.number().int().min(1).max(262_144).default(65_536),
  }),
  OperationBaseSchema.extend({
    kind: z.literal("inspect_package_scripts"),
    path: RelativePathSchema.default("package.json"),
  }),
  OperationBaseSchema.extend({
    kind: z.literal("git_diff"),
    staged: z.boolean().default(false),
    path: RelativePathSchema.optional(),
  }),
  OperationBaseSchema.extend({
    kind: z.literal("git_log"),
    limit: z.number().int().min(1).max(50).default(10),
  }),
  OperationBaseSchema.extend({
    kind: z.literal("find_tests"),
    query: z.string().max(300).default(""),
    maxResults: z.number().int().min(1).max(200).default(50),
  }),
  OperationBaseSchema.extend({
    kind: z.literal("inspect_services"),
    namePattern: z.string().max(100).default("phantom|hermes|termina"),
  }),
  OperationBaseSchema.extend({
    kind: z.literal("inspect_listening_ports"),
    ports: z.array(z.number().int().min(1).max(65_535)).max(32).default([]),
  }),
]);
export type EngineeringReadOperation = z.infer<typeof EngineeringReadOperationSchema>;

export const EngineeringFileOperationSchema = z.discriminatedUnion("kind", [
  OperationBaseSchema.extend({
    kind: z.literal("edit_text_file"),
    path: RelativePathSchema,
    expectedSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    expectedText: z.string().min(1).max(262_144),
    replacementText: z.string().max(262_144),
  }),
  OperationBaseSchema.extend({
    kind: z.literal("create_text_file"),
    path: RelativePathSchema,
    expectedAbsent: z.literal(true),
    content: z.string().max(262_144),
  }),
  OperationBaseSchema.extend({
    kind: z.literal("append_text_file"),
    path: RelativePathSchema,
    expectedSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    content: z.string().min(1).max(65_536),
  }),
  OperationBaseSchema.extend({
    kind: z.enum(["rename_file", "move_file"]),
    fromPath: RelativePathSchema,
    toPath: RelativePathSchema,
    expectedSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    expectedDestinationAbsent: z.literal(true),
  }),
  OperationBaseSchema.extend({
    kind: z.literal("create_directory"),
    path: RelativePathSchema,
    expectedAbsent: z.literal(true),
  }),
  OperationBaseSchema.extend({
    kind: z.literal("delete_fixture_file"),
    path: RelativePathSchema,
    expectedSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  }),
]);
export type EngineeringFileOperation = z.infer<typeof EngineeringFileOperationSchema>;

export const EngineeringCommandOperationSchema = z.discriminatedUnion("kind", [
  OperationBaseSchema.extend({
    kind: z.literal("run_npm_script"),
    script: z.string().min(1).max(120),
    args: z.array(z.string().max(300)).max(20).default([]),
    timeoutMs: z.number().int().min(1_000).max(600_000).default(120_000),
  }),
  OperationBaseSchema.extend({
    kind: z.enum(["run_typescript_build", "run_typecheck"]),
    workspace: z.string().min(1).max(160).optional(),
    timeoutMs: z.number().int().min(1_000).max(600_000).default(180_000),
  }),
  OperationBaseSchema.extend({
    kind: z.literal("run_powershell_script"),
    path: RelativePathSchema,
    args: z.array(z.string().max(300)).max(20).default([]),
    timeoutMs: z.number().int().min(1_000).max(600_000).default(180_000),
  }),
  OperationBaseSchema.extend({
    kind: z.literal("run_secret_scan"),
    strict: z.boolean().default(true),
    timeoutMs: z.number().int().min(1_000).max(600_000).default(180_000),
  }),
  OperationBaseSchema.extend({
    kind: z.literal("git_add"),
    paths: z.array(RelativePathSchema).min(1).max(50),
    timeoutMs: z.number().int().min(1_000).max(120_000).default(30_000),
  }),
  OperationBaseSchema.extend({
    kind: z.literal("git_commit"),
    message: z.string().min(1).max(200),
    timeoutMs: z.number().int().min(1_000).max(120_000).default(60_000),
  }),
]);
export type EngineeringCommandOperation = z.infer<typeof EngineeringCommandOperationSchema>;

export const EngineeringOperationSchema = z.union([
  EngineeringReadOperationSchema,
  EngineeringFileOperationSchema,
  EngineeringCommandOperationSchema,
]);
export type EngineeringOperation = z.infer<typeof EngineeringOperationSchema>;

export const EngineeringTaskPlanSchema = z.object({
  version: z.literal(1),
  workspace: z.string().min(1).max(200),
  summary: z.string().min(1).max(1_000),
  operations: z.array(EngineeringOperationSchema).min(1).max(20),
  verification: z.object({
    inspectDiff: z.boolean().default(true),
    requireCleanRollback: z.boolean().default(true),
  }).default({ inspectDiff: true, requireCleanRollback: true }),
}).superRefine((plan, ctx) => {
  if (JSON.stringify(plan).length > 524_288) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [],
      message: "engineering plan exceeds the 512 KiB approval-payload limit",
    });
  }
  const ids = new Set<string>();
  plan.operations.forEach((operation, index) => {
    if (ids.has(operation.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["operations", index, "id"],
        message: "operation IDs must be unique",
      });
    }
    ids.add(operation.id);
  });
  const repositoryMutation = plan.operations.find(
    (operation) => operation.kind === "git_add" || operation.kind === "git_commit",
  );
  if (repositoryMutation && plan.operations.length !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["operations"],
      message: `${repositoryMutation.kind} requires its own separately approved single-operation plan`,
    });
  }
});
export type EngineeringTaskPlan = z.infer<typeof EngineeringTaskPlanSchema>;

export const READ_ONLY_ENGINEERING_KINDS: ReadonlySet<EngineeringOperation["kind"]> = new Set([
  "repo_status",
  "search_text",
  "list_files",
  "read_text_file",
  "inspect_package_scripts",
  "git_diff",
  "git_log",
  "find_tests",
  "inspect_services",
  "inspect_listening_ports",
]);

export function engineeringPlanIsReadOnly(plan: EngineeringTaskPlan) {
  return plan.operations.every((operation) => READ_ONLY_ENGINEERING_KINDS.has(operation.kind));
}
