import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

export type MediaLabImageConnectorKind =
  | "browser_editor"
  | "local_cli"
  | "local_library"
  | "provider_bridge"
  | "workflow_connector";

export type MediaLabImageConnectorState =
  | "active"
  | "available"
  | "needs_install"
  | "planned"
  | "gated";

export type MediaLabImageConnector = {
  id: string;
  label: string;
  kind: MediaLabImageConnectorKind;
  state: MediaLabImageConnectorState;
  role: string;
  capabilities: string[];
  executable?: string | null;
  detected_path?: string | null;
  admin_only: boolean;
  user_visible: boolean;
  notes: string;
};

export type MediaLabImageToolchainStatus = {
  service: "PhantomForce Media Lab Image Studio";
  generated_at: string;
  summary: {
    connectors_total: number;
    active_or_available: number;
    browser_tools_active: number;
    local_cli_available: number;
    provider_bridges_gated: number;
  };
  connectors: MediaLabImageConnector[];
  groups: Record<MediaLabImageConnectorKind, MediaLabImageConnector[]>;
  recommended_stack: string[];
  safety_flags: {
    status_only: true;
    provider_called: false;
    paid_job_called: false;
    upload_performed: false;
    external_send_performed: false;
    credentials_read: false;
    destructive_action: false;
  };
};

type CliToolDefinition = {
  id: string;
  label: string;
  executable: string;
  knownPaths?: string[];
  role: string;
  capabilities: string[];
  notes: string;
};

const BROWSER_CONNECTORS: MediaLabImageConnector[] = [
  {
    id: "phantom-local-generator",
    label: "Prompt image draft",
    kind: "browser_editor",
    state: "active",
    role: "Create visible image drafts directly in chat and Media Lab.",
    capabilities: ["prompt-to-image draft", "chat preview", "Media Lab asset record"],
    admin_only: false,
    user_visible: true,
    notes: "Runs in the browser with deterministic local SVG/canvas output. No provider call.",
  },
  {
    id: "canvas-crop-export",
    label: "Crop and PNG export",
    kind: "browser_editor",
    state: "active",
    role: "Save edited image previews with selected crop and look baked into PNG.",
    capabilities: ["1:1", "4:5", "9:16", "16:9", "PNG export"],
    admin_only: false,
    user_visible: true,
    notes: "Client-side canvas export. No upload.",
  },
  {
    id: "look-engine",
    label: "AI-style visual tweaks",
    kind: "browser_editor",
    state: "active",
    role: "Fast creative looks before heavier provider or local processing.",
    capabilities: ["studio", "punch", "cinematic", "neon", "clean", "mono"],
    admin_only: false,
    user_visible: true,
    notes: "CSS/canvas filter stack for instant local iteration.",
  },
  {
    id: "variant-maker",
    label: "Variant maker",
    kind: "browser_editor",
    state: "active",
    role: "Duplicate and re-seed concepts without starting a paid job.",
    capabilities: ["alternate concept", "same crop", "same look"],
    admin_only: false,
    user_visible: true,
    notes: "Local concept generation only.",
  },
];

const CLI_TOOLS: CliToolDefinition[] = [
  {
    id: "rembg",
    label: "Background remover",
    executable: "rembg.exe",
    knownPaths: [
      join(process.env.LOCALAPPDATA ?? "", "Programs", "Python", "Python312", "Scripts", "rembg.exe"),
      join(process.env.APPDATA ?? "", "Python", "Python312", "Scripts", "rembg.exe"),
    ],
    role: "True local background removal for product/person cutouts.",
    capabilities: ["remove background", "transparent PNG", "batch cutouts"],
    notes: "Detected locally when rembg.exe is on PATH or in the Python Scripts folder.",
  },
  {
    id: "ffmpeg",
    label: "FFmpeg",
    executable: "ffmpeg.exe",
    role: "Image sequence, GIF/video assembly, thumbnails, and transcodes.",
    capabilities: ["image sequence", "GIF/video", "thumbnail extraction", "metadata"],
    notes: "Used as a local media utility only.",
  },
  {
    id: "ffprobe",
    label: "FFprobe",
    executable: "ffprobe.exe",
    role: "Probe media dimensions, codecs, frames, and duration.",
    capabilities: ["metadata", "validation", "proof"],
    notes: "Read-only metadata helper.",
  },
  {
    id: "imagemagick",
    label: "ImageMagick",
    executable: "magick.exe",
    role: "Advanced resize, crop, composite, format conversion, and batch transforms.",
    capabilities: ["resize", "composite", "format conversion", "batch edits"],
    notes: "Optional local CLI power layer.",
  },
  {
    id: "python",
    label: "Python imaging lane",
    executable: "python.exe",
    role: "Pillow/OpenCV scripting lane for custom image operations.",
    capabilities: ["custom transforms", "automation", "batch processing"],
    notes: "Presence only; library availability is checked separately in future passes.",
  },
  {
    id: "exiftool",
    label: "ExifTool",
    executable: "exiftool.exe",
    role: "Metadata cleanup and audit before client delivery.",
    capabilities: ["metadata read", "metadata cleanup", "privacy audit"],
    notes: "Optional privacy/proof utility.",
  },
  {
    id: "pngquant",
    label: "PNGQuant",
    executable: "pngquant.exe",
    role: "Compress PNG deliverables without changing the creative workflow.",
    capabilities: ["PNG compression", "web optimization"],
    notes: "Optional web delivery utility.",
  },
  {
    id: "cwebp",
    label: "WebP encoder",
    executable: "cwebp.exe",
    role: "Create modern web assets for websites/stores.",
    capabilities: ["WebP export", "web optimization"],
    notes: "Optional web delivery utility.",
  },
  {
    id: "gifski",
    label: "GIF maker",
    executable: "gifski.exe",
    role: "Create high-quality GIF previews from image/video frames.",
    capabilities: ["GIF export", "motion previews"],
    notes: "Optional motion asset utility.",
  },
  {
    id: "realesrgan",
    label: "Upscale lane",
    executable: "realesrgan-ncnn-vulkan.exe",
    role: "Local image upscaling when installed.",
    capabilities: ["upscale", "cleanup"],
    notes: "Optional local enhancement utility.",
  },
];

const PLANNED_CONNECTORS: MediaLabImageConnector[] = [
  {
    id: "higgsfield-image-bridge",
    label: "Premium generation bridge",
    kind: "provider_bridge",
    state: "gated",
    role: "Commercial image/video generation after explicit paid-run approval.",
    capabilities: ["image generation", "image-to-video", "marketing creative"],
    admin_only: true,
    user_visible: false,
    notes: "Readiness only here. This endpoint never calls Higgsfield or spends credits.",
  },
  {
    id: "phantomcut-edit-bridge",
    label: "PhantomCut bridge",
    kind: "workflow_connector",
    state: "available",
    role: "Open finished images/videos into the broader Media Lab workflow.",
    capabilities: ["asset handoff", "proof record", "editor launch"],
    admin_only: false,
    user_visible: true,
    notes: "Workflow routing only; no Resolve timeline write from this status layer.",
  },
  {
    id: "drive-asset-vault",
    label: "Asset vault",
    kind: "workflow_connector",
    state: "planned",
    role: "Save approved assets into the correct client vault later.",
    capabilities: ["folder routing", "approval receipts", "client asset library"],
    admin_only: true,
    user_visible: false,
    notes: "Planned connector. No Google Drive write from this layer.",
  },
  {
    id: "social-export-pack",
    label: "Social export pack",
    kind: "workflow_connector",
    state: "planned",
    role: "Package output sizes for posts, stories, thumbnails, and web.",
    capabilities: ["platform crops", "export naming", "delivery checklist"],
    admin_only: false,
    user_visible: true,
    notes: "Packaging layer first; posting remains separate and approved.",
  },
];

function pathCandidatesForExecutable(executable: string) {
  const pathValue = process.env.PATH ?? "";
  const dirs = pathValue.split(delimiter).filter(Boolean);
  return dirs.map((dir) => join(dir, executable));
}

function findExecutable(definition: CliToolDefinition) {
  const candidates = [
    ...(definition.knownPaths ?? []),
    ...pathCandidatesForExecutable(definition.executable),
  ].filter(Boolean);

  const direct = candidates.find((candidate) => existsSync(candidate));
  if (direct) return direct;

  if (process.platform === "win32") {
    const where = spawnSync("where.exe", [definition.executable], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 1200,
    });
    if (where.status === 0) {
      const first = where.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
      if (first && existsSync(first)) return first;
    }
  }

  return null;
}

function localCliConnector(definition: CliToolDefinition): MediaLabImageConnector {
  const detectedPath = findExecutable(definition);
  return {
    id: definition.id,
    label: definition.label,
    kind: "local_cli",
    state: detectedPath ? "available" : "needs_install",
    role: definition.role,
    capabilities: definition.capabilities,
    executable: definition.executable,
    detected_path: detectedPath,
    admin_only: true,
    user_visible: false,
    notes: definition.notes,
  };
}

function groupConnectors(connectors: MediaLabImageConnector[]) {
  return connectors.reduce<Record<MediaLabImageConnectorKind, MediaLabImageConnector[]>>(
    (groups, connector) => {
      groups[connector.kind].push(connector);
      return groups;
    },
    {
      browser_editor: [],
      local_cli: [],
      local_library: [],
      provider_bridge: [],
      workflow_connector: [],
    },
  );
}

export function getMediaLabImageToolchainStatus(): MediaLabImageToolchainStatus {
  const localCli = CLI_TOOLS.map(localCliConnector);
  const connectors = [...BROWSER_CONNECTORS, ...localCli, ...PLANNED_CONNECTORS];
  const activeOrAvailable = connectors.filter((connector) =>
    connector.state === "active" || connector.state === "available",
  ).length;

  return {
    service: "PhantomForce Media Lab Image Studio",
    generated_at: new Date().toISOString(),
    summary: {
      connectors_total: connectors.length,
      active_or_available: activeOrAvailable,
      browser_tools_active: BROWSER_CONNECTORS.filter((connector) => connector.state === "active").length,
      local_cli_available: localCli.filter((connector) => connector.state === "available").length,
      provider_bridges_gated: connectors.filter((connector) => connector.kind === "provider_bridge" && connector.state === "gated").length,
    },
    connectors,
    groups: groupConnectors(connectors),
    recommended_stack: [
      "Prompt image draft in chat.",
      "Open in Media Lab.",
      "Crop for platform.",
      "Apply look.",
      "Use rembg/local CLI when available for true cutouts.",
      "Save/download PNG.",
      "Escalate to paid provider only through a separate explicit approval.",
    ],
    safety_flags: {
      status_only: true,
      provider_called: false,
      paid_job_called: false,
      upload_performed: false,
      external_send_performed: false,
      credentials_read: false,
      destructive_action: false,
    },
  };
}

export function clientSafeMediaLabImageToolchainStatus(status = getMediaLabImageToolchainStatus()) {
  const visible = status.connectors.filter((connector) => connector.user_visible);
  return {
    service: status.service,
    generated_at: status.generated_at,
    summary: {
      visible_connectors: visible.length,
      active_or_available: visible.filter((connector) =>
        connector.state === "active" || connector.state === "available",
      ).length,
    },
    connectors: visible.map((connector) => ({
      id: connector.id,
      label: connector.label,
      state: connector.state,
      role: connector.role,
      capabilities: connector.capabilities,
    })),
    details_redacted: true,
    safety_flags: status.safety_flags,
  };
}
