import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import type {
  MediaLabCategorySummary,
  MediaLabEffect,
  MediaLabEffectCategory,
  MediaLabEffectsQuery,
  MediaLabLibrarySummary,
  MediaLabPackSummary,
} from "@phantomforce/contracts";

const DEFAULT_ASSET_ROOT = "G:\\Motionarray download";
const SOURCE_PROVIDER = "Motion Array" as const;

export const mediaLabLicenseBoundary = {
  sourceProvider: SOURCE_PROVIDER,
  rawDownloadAllowed: false,
  allowedUse:
    "Use licensed source assets inside PhantomForce production workflows and rendered final client projects.",
  blockedUse:
    "Do not expose raw ZIPs, stock files, templates, effects, or extractable source media as a public downloadable library.",
  reviewRequiredBeforePublicCloud: true,
} as const;

const categoryOrder: MediaLabEffectCategory[] = [
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
];

type FileCandidate = {
  absolutePath: string;
  relativePath: string;
  fileName: string;
  sizeBytes: number;
};

type MediaLabLibrary = {
  summary: MediaLabLibrarySummary;
  effects: MediaLabEffect[];
  warnings: string[];
};

function resolveAssetRoot() {
  return (
    process.env.PHANTOMFORCE_MEDIA_ASSET_ROOT ??
    process.env.PHANTOMFORCE_ASSET_LIBRARY_ROOT ??
    DEFAULT_ASSET_ROOT
  );
}

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;

  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function normalizePortablePath(value: string) {
  return value.replace(/\\/g, "/");
}

function makeId(relativePath: string) {
  return createHash("sha1").update(normalizePortablePath(relativePath).toLowerCase()).digest("hex").slice(0, 14);
}

function titleFromFileName(fileName: string) {
  return fileName
    .replace(/\.zip$/i, "")
    .replace(/_source_\d+/i, "")
    .replace(/\(\d+\)/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function wordsFrom(value: string) {
  return normalizePortablePath(value)
    .toLowerCase()
    .replace(/\.zip$/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !["source", "pack", "the", "and"].includes(word));
}

function inferCategory(candidate: FileCandidate): MediaLabEffectCategory {
  const portableRelativePath = normalizePortablePath(candidate.relativePath).toLowerCase();
  const searchable = `${portableRelativePath} ${candidate.fileName}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");

  if (searchable.includes("davinci_resolve_studio") || /\bdavinci\b|\bresolve\b/.test(searchable)) {
    return "software";
  }

  if (portableRelativePath.startsWith("macros/") || /\bmacro\b|\bpreset\b|\bdrfx\b/.test(searchable)) {
    return "macros";
  }

  if (/\bsoccer\b|\bsports?\b|\bfootball\b|\bbasketball\b|\broster\b/.test(searchable)) {
    return "sports";
  }

  if (/\bmockup\b|\bdevice\b|\bposter\b|\bscreen\b/.test(searchable)) {
    return "mockups";
  }

  if (/\blogo\b|\bbrand\b|\bmark\b/.test(searchable)) {
    return "logo_templates";
  }

  if (/\btitles?\b|\bintro\b|\bopener\b|\blower.?third\b|\btypography\b/.test(searchable)) {
    return "titles";
  }

  if (/\btext\b|\btype\b|\btypeface\b|\bfont\b|\bchrome\b|\bgothic\b/.test(searchable)) {
    return "text_templates";
  }

  if (/\btransitions?\b|\bleak\b|\bwipe\b|\bglitch\b|\bzoom\b|\bswipe\b|\bstrobe\b/.test(searchable)) {
    return "transitions";
  }

  if (/\belements?\b|\boverlays?\b|\beffects?\b|\bstrokes?\b|\bmarker\b|\bpaper\b|\bobjects?\b|\bshapes?\b|\bsticker\b/.test(searchable)) {
    return "overlays";
  }

  if (/\btemplate\b|\bslideshow\b|\bpromo\b|\breel\b|\bstory\b|\bpack\b/.test(searchable)) {
    return "templates";
  }

  return "uncategorized";
}

function sourceFolderFrom(relativePath: string) {
  const [first] = normalizePortablePath(relativePath).split("/");
  return first && first !== path.basename(relativePath) ? first : "Root";
}

function effectFromCandidate(candidate: FileCandidate): MediaLabEffect {
  const category = inferCategory(candidate);
  const sourceFolder = sourceFolderFrom(candidate.relativePath);
  const blockedSoftware = category === "software";
  const words = Array.from(new Set([category, sourceFolder.toLowerCase(), ...wordsFrom(candidate.fileName)])).slice(0, 10);

  return {
    id: makeId(candidate.relativePath),
    title: titleFromFileName(candidate.fileName),
    category,
    tags: words,
    sourceProvider: SOURCE_PROVIDER,
    sourcePack: titleFromFileName(candidate.fileName),
    sourceFolder,
    sourceRelativePath: normalizePortablePath(candidate.relativePath),
    fileName: candidate.fileName,
    fileExtension: ".zip",
    sizeBytes: candidate.sizeBytes,
    sizeLabel: formatBytes(candidate.sizeBytes),
    licenseStatus: blockedSoftware ? "blocked_software_package" : "motion_array_project_use_only",
    exposureMode: blockedSoftware ? "blocked" : "rendered_derivative_only",
    allowedUse: blockedSoftware
      ? "Blocked from Media Lab cloud-pack publishing; keep software installers out of asset catalogs."
      : mediaLabLicenseBoundary.allowedUse,
    rawDownloadAllowed: false,
    cloudPackReady: false,
  };
}

async function walkZipFiles(root: string, current: string, warnings: string[]): Promise<FileCandidate[]> {
  let entries;

  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch (error) {
    warnings.push(`Unable to read asset folder: ${normalizePortablePath(path.relative(root, current) || ".")}`);
    return [];
  }

  const files: FileCandidate[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(current, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await walkZipFiles(root, absolutePath, warnings)));
      continue;
    }

    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".zip") {
      continue;
    }

    try {
      const info = await stat(absolutePath);
      files.push({
        absolutePath,
        relativePath: path.relative(root, absolutePath),
        fileName: entry.name,
        sizeBytes: info.size,
      });
    } catch {
      warnings.push(`Unable to inspect asset file: ${normalizePortablePath(path.relative(root, absolutePath))}`);
    }
  }

  return files;
}

function summarizeCategories(effects: MediaLabEffect[]): MediaLabCategorySummary[] {
  return categoryOrder
    .map((category) => {
      const matching = effects.filter((effect) => effect.category === category);
      const sizeBytes = matching.reduce((sum, effect) => sum + effect.sizeBytes, 0);

      return {
        category,
        count: matching.length,
        sizeBytes,
        sizeLabel: formatBytes(sizeBytes),
      };
    })
    .filter((summary) => summary.count > 0);
}

function summarizePacks(effects: MediaLabEffect[]): MediaLabPackSummary[] {
  const byFolder = new Map<string, MediaLabEffect[]>();

  for (const effect of effects) {
    byFolder.set(effect.sourceFolder, [...(byFolder.get(effect.sourceFolder) ?? []), effect]);
  }

  return Array.from(byFolder.entries())
    .map(([sourceFolder, matching]) => {
      const sizeBytes = matching.reduce((sum, effect) => sum + effect.sizeBytes, 0);

      return {
        sourceFolder,
        count: matching.length,
        sizeBytes,
        sizeLabel: formatBytes(sizeBytes),
      };
    })
    .sort((left, right) => right.sizeBytes - left.sizeBytes);
}

function buildSummary(effects: MediaLabEffect[], warnings: string[], sourceRootConfigured: boolean): MediaLabLibrarySummary {
  const totalBytes = effects.reduce((sum, effect) => sum + effect.sizeBytes, 0);

  if (effects.some((effect) => effect.category === "software")) {
    warnings.push("Software installer ZIPs were detected and marked blocked for the effects catalog.");
  }

  return {
    generatedAt: new Date().toISOString(),
    sourceProvider: SOURCE_PROVIDER,
    sourceRootConfigured,
    totalAssets: effects.length,
    totalBytes,
    totalSizeLabel: formatBytes(totalBytes),
    cloudReadyAssets: effects.filter((effect) => effect.cloudPackReady).length,
    rawDownloadAllowed: false,
    categories: summarizeCategories(effects),
    packs: summarizePacks(effects),
    licenseBoundary: mediaLabLicenseBoundary,
  };
}

function filterEffects(effects: MediaLabEffect[], query: MediaLabEffectsQuery) {
  const phrase = query.q?.toLowerCase();

  return effects
    .filter((effect) => !query.category || effect.category === query.category)
    .filter((effect) => {
      if (!phrase) return true;
      return `${effect.title} ${effect.sourcePack} ${effect.sourceFolder} ${effect.tags.join(" ")}`
        .toLowerCase()
        .includes(phrase);
    })
    .sort((left, right) => {
      if (left.category === "software" && right.category !== "software") return 1;
      if (right.category === "software" && left.category !== "software") return -1;
      return right.sizeBytes - left.sizeBytes;
    });
}

export async function readMediaLabLibrary(): Promise<MediaLabLibrary> {
  const root = resolveAssetRoot();
  const warnings: string[] = [];

  let rootInfo;

  try {
    rootInfo = await stat(root);
  } catch {
    warnings.push("Media asset root is not reachable. Set PHANTOMFORCE_MEDIA_ASSET_ROOT to the local asset pack.");

    return {
      summary: buildSummary([], warnings, false),
      effects: [],
      warnings,
    };
  }

  if (!rootInfo.isDirectory()) {
    warnings.push("Media asset root is not a directory.");

    return {
      summary: buildSummary([], warnings, false),
      effects: [],
      warnings,
    };
  }

  const candidates = await walkZipFiles(root, root, warnings);
  const effects = candidates.map(effectFromCandidate);

  return {
    summary: buildSummary(effects, warnings, true),
    effects,
    warnings,
  };
}

export async function listMediaLabEffects(query: MediaLabEffectsQuery) {
  const library = await readMediaLabLibrary();
  const effects = filterEffects(library.effects, query).slice(0, query.limit);

  return {
    ...library,
    effects,
  };
}

export async function getMediaLabLibrarySummary() {
  const library = await readMediaLabLibrary();
  return {
    summary: library.summary,
    warnings: library.warnings,
  };
}
