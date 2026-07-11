import { z } from "zod";

export const MediaLabEffectCategorySchema = z.enum([
  "transitions",
  "titles",
  "text_templates",
  "logo_templates",
  "overlays",
  "mockups",
  "sports",
  "macros",
  "templates",
  "software",
  "uncategorized",
]);
export type MediaLabEffectCategory = z.infer<typeof MediaLabEffectCategorySchema>;

export const MediaLabLicenseStatusSchema = z.enum([
  "motion_array_project_use_only",
  "needs_rights_review",
  "blocked_software_package",
]);
export type MediaLabLicenseStatus = z.infer<typeof MediaLabLicenseStatusSchema>;

export const MediaLabExposureModeSchema = z.enum([
  "metadata_only",
  "rendered_derivative_only",
  "blocked",
]);
export type MediaLabExposureMode = z.infer<typeof MediaLabExposureModeSchema>;

export const MediaLabLicenseBoundarySchema = z.object({
  sourceProvider: z.literal("Motion Array"),
  rawDownloadAllowed: z.literal(false),
  allowedUse: z.string().min(1),
  blockedUse: z.string().min(1),
  reviewRequiredBeforePublicCloud: z.literal(true),
});
export type MediaLabLicenseBoundary = z.infer<typeof MediaLabLicenseBoundarySchema>;

export const MediaLabEffectSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  category: MediaLabEffectCategorySchema,
  tags: z.array(z.string().min(1)),
  sourceProvider: z.literal("Motion Array"),
  sourcePack: z.string().min(1),
  sourceFolder: z.string().min(1),
  sourceRelativePath: z.string().min(1),
  fileName: z.string().min(1),
  fileExtension: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  sizeLabel: z.string().min(1),
  licenseStatus: MediaLabLicenseStatusSchema,
  exposureMode: MediaLabExposureModeSchema,
  allowedUse: z.string().min(1),
  rawDownloadAllowed: z.literal(false),
  cloudPackReady: z.boolean(),
});
export type MediaLabEffect = z.infer<typeof MediaLabEffectSchema>;

export const MediaLabCategorySummarySchema = z.object({
  category: MediaLabEffectCategorySchema,
  count: z.number().int().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
  sizeLabel: z.string().min(1),
});
export type MediaLabCategorySummary = z.infer<typeof MediaLabCategorySummarySchema>;

export const MediaLabPackSummarySchema = z.object({
  sourceFolder: z.string().min(1),
  count: z.number().int().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
  sizeLabel: z.string().min(1),
});
export type MediaLabPackSummary = z.infer<typeof MediaLabPackSummarySchema>;

export const MediaLabLibrarySummarySchema = z.object({
  generatedAt: z.string().datetime(),
  sourceProvider: z.literal("Motion Array"),
  sourceRootConfigured: z.boolean(),
  totalAssets: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  totalSizeLabel: z.string().min(1),
  cloudReadyAssets: z.number().int().nonnegative(),
  rawDownloadAllowed: z.literal(false),
  categories: z.array(MediaLabCategorySummarySchema),
  packs: z.array(MediaLabPackSummarySchema),
  licenseBoundary: MediaLabLicenseBoundarySchema,
});
export type MediaLabLibrarySummary = z.infer<typeof MediaLabLibrarySummarySchema>;

export const MediaLabEffectsQuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
  category: MediaLabEffectCategorySchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});
export type MediaLabEffectsQuery = z.infer<typeof MediaLabEffectsQuerySchema>;

