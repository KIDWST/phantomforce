export type BeatForgeDaw = "ableton" | "fl-studio" | "logic" | "reaper" | "studio-one" | "generic-midi";
export type BeatForgeSoundRole = "kick" | "snare" | "clap" | "hat" | "open_hat" | "perc" | "808" | "bass" | "melody" | "fx";

export type BeatForgeKitSound = {
  name: string;
  role: BeatForgeSoundRole;
  note?: string;
  path?: string;
};

export type BeatForgePreviewInput = {
  beatName?: string;
  beatPath?: string;
  bpm?: number;
  key?: string;
  daw?: BeatForgeDaw;
  kitName?: string;
  kitSounds?: BeatForgeKitSound[];
  stylePrompt?: string;
};

export type BeatForgeLane = {
  id: string;
  role: BeatForgeSoundRole;
  label: string;
  dawTrackName: string;
  midiNote: string;
  pattern: string;
  kitSound: string;
  confidence: number;
};

export type BeatForgePreview = {
  product: "BeatForge";
  mode: "deterministic_preview";
  beat: {
    name: string;
    path: string;
    bpm: number;
    key: string;
    daw: BeatForgeDaw;
  };
  kit: {
    name: string;
    mapped: number;
    missingRoles: BeatForgeSoundRole[];
  };
  arrangement: Array<{
    section: string;
    bars: string;
    instruction: string;
  }>;
  lanes: BeatForgeLane[];
  dawChecklist: string[];
  exportPlan: string[];
  safety: {
    writesFiles: false;
    mutatesDaw: false;
    uploadsAudio: false;
    startsPlugins: false;
    note: string;
  };
};

const ROLES: BeatForgeSoundRole[] = ["kick", "snare", "clap", "hat", "open_hat", "perc", "808", "bass", "melody", "fx"];

const ROLE_DEFAULTS: Record<BeatForgeSoundRole, { note: string; pattern: string; label: string }> = {
  kick: { note: "C1", pattern: "1, 1.3, 2.4, 3.1, 3.4", label: "Kick backbone" },
  snare: { note: "D1", pattern: "2, 4", label: "Snare backbeat" },
  clap: { note: "D#1", pattern: "2, 4 with late ghost layer", label: "Clap layer" },
  hat: { note: "F#1", pattern: "1/8 grid with 1/16 pickup rolls", label: "Closed hat grid" },
  open_hat: { note: "A#1", pattern: "offbeat at 1.3 and 3.3", label: "Open hat lift" },
  perc: { note: "G1", pattern: "syncopated response after snare", label: "Perc bounce" },
  "808": { note: "C2", pattern: "root notes follow kick anchors", label: "808 glide line" },
  bass: { note: "C2", pattern: "root support under hook sections", label: "Bass support" },
  melody: { note: "C4", pattern: "looped 4-bar phrase with hook variation", label: "Melody guide" },
  fx: { note: "C5", pattern: "transitions before hook and outro", label: "FX transitions" },
};

function clean(value: unknown, max = 180) {
  return String(value ?? "").replace(/[<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function safeBpm(value: unknown) {
  const bpm = Number(value);
  return Number.isFinite(bpm) ? Math.min(220, Math.max(55, Math.round(bpm))) : 140;
}

function safeDaw(value: unknown): BeatForgeDaw {
  const daw = clean(value, 40).toLowerCase().replace(/\s+/g, "-");
  return ["ableton", "fl-studio", "logic", "reaper", "studio-one", "generic-midi"].includes(daw) ? daw as BeatForgeDaw : "generic-midi";
}

function normalizeRole(value: unknown): BeatForgeSoundRole | null {
  const role = clean(value, 30).toLowerCase().replace(/\s+/g, "_");
  if (role === "openhat") return "open_hat";
  if (role === "sub" || role === "sub_bass") return "808";
  return ROLES.includes(role as BeatForgeSoundRole) ? role as BeatForgeSoundRole : null;
}

function normalizeSounds(input: unknown): BeatForgeKitSound[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 64).map((item) => {
    const source = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const role = normalizeRole(source.role);
    const name = clean(source.name, 90);
    if (!role || !name) return null;
    return {
      name,
      role,
      note: clean(source.note, 16) || undefined,
      path: clean(source.path, 500) || undefined,
    };
  }).filter(Boolean) as BeatForgeKitSound[];
}

function chooseSound(sounds: BeatForgeKitSound[], role: BeatForgeSoundRole) {
  return sounds.find((sound) => sound.role === role) || null;
}

export function buildBeatForgePreview(input: BeatForgePreviewInput | Record<string, unknown> = {}): BeatForgePreview {
  const bpm = safeBpm(input.bpm);
  const daw = safeDaw(input.daw);
  const kitSounds = normalizeSounds(input.kitSounds);
  const beatName = clean(input.beatName, 90) || "Imported beat";
  const kitName = clean(input.kitName, 90) || "Attached kit";
  const stylePrompt = clean(input.stylePrompt, 220);
  const preferredRoles: BeatForgeSoundRole[] = ["kick", "snare", "hat", "open_hat", "perc", "808", "melody", "fx"];
  const lanes = preferredRoles.map((role) => {
    const sound = chooseSound(kitSounds, role);
    const defaults = ROLE_DEFAULTS[role];
    return {
      id: `lane-${role}`,
      role,
      label: defaults.label,
      dawTrackName: `BF ${defaults.label}`,
      midiNote: sound?.note || defaults.note,
      pattern: defaults.pattern,
      kitSound: sound?.name || `Missing ${role.replace("_", " ")} sound`,
      confidence: sound ? 88 : 42,
    };
  });
  const missingRoles = preferredRoles.filter((role) => !chooseSound(kitSounds, role));
  const hookNote = stylePrompt ? `match the feel of "${stylePrompt}"` : "match the strongest loop from the reference beat";
  return {
    product: "BeatForge",
    mode: "deterministic_preview",
    beat: {
      name: beatName,
      path: clean(input.beatPath, 700) || "local beat path not attached",
      bpm,
      key: clean(input.key, 24) || "unknown",
      daw,
    },
    kit: {
      name: kitName,
      mapped: kitSounds.length,
      missingRoles,
    },
    arrangement: [
      { section: "Intro", bars: "1-8", instruction: "Filter melody guide, keep drums sparse, prepare the drop." },
      { section: "Hook", bars: "9-24", instruction: `Use full kit mapping and ${hookNote}.` },
      { section: "Verse", bars: "25-40", instruction: "Remove open hats and simplify 808 movement for vocal space." },
      { section: "Hook 2", bars: "41-56", instruction: "Bring back full drum grid with one extra perc response." },
      { section: "Outro", bars: "57-64", instruction: "Drop kick first, then melody and FX tail." },
    ],
    lanes,
    dawChecklist: [
      `Create a ${bpm} BPM ${daw} session.`,
      "Import the reference beat on a muted guide track.",
      `Load kit folder: ${kitName}.`,
      "Create one MIDI track per BeatForge lane.",
      "Map each lane note to the selected kit sound.",
      "Rebuild sections from the arrangement map, then human-review timing before export.",
    ],
    exportPlan: [
      "Export MIDI lane pack.",
      "Export sampler preset notes.",
      "Export arrangement checklist.",
      "Do not render audio until the owner confirms the recreated pattern.",
    ],
    safety: {
      writesFiles: false,
      mutatesDaw: false,
      uploadsAudio: false,
      startsPlugins: false,
      note: "Preview only. BeatForge does not open the DAW, write files, upload audio, or start plugins from this endpoint.",
    },
  };
}
