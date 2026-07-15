import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { AccessSession } from "../access/session.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const storePath = process.env.PHANTOMFORCE_PHANTOMPLAY_PATH || resolve(repoRoot, ".phantom", "phantomplay.json");
const retryableWriteCodes = new Set(["EPERM", "EACCES", "EBUSY"]);

// 5-tier scheme. The 3 original values ("everyone" | "teen" | "mature") are
// kept byte-identical so all pre-existing games' contentRating fields stay
// valid with zero migration. "toddler" and "everyone10" are new, inserted
// between "everyone" and "teen" in severity (see `ratingRank` below).
export type PhantomPlayRating = "toddler" | "everyone" | "everyone10" | "teen" | "mature";
export type PhantomPlaySubmissionStatus = "draft" | "submitted" | "changes_requested" | "approved" | "rejected" | "disabled";
export type PhantomPlayEngineProfile = {
  tier: string;
  minVersion: string;
};

// Content descriptors are additive tags alongside the single contentRating —
// e.g. a "teen" game might carry ["competitive_play", "online_interaction",
// "in_game_chat"]. Optional/omitted on all pre-existing games; treat missing
// as [].
export type PhantomPlayContentDescriptor =
  | "cartoon_action"
  | "fantasy_conflict"
  | "mild_destruction"
  | "intense_action"
  | "competitive_play"
  | "online_interaction"
  | "user_generated_content"
  | "music"
  | "strategic_complexity"
  | "simulated_economy"
  | "in_game_chat"
  | "voice_chat"
  | "educational_content"
  | "no_reading_required"
  | "flashing_lights"
  | "horror_themes";

export type PhantomPlayGame = {
  id: string;
  title: string;
  summary: string;
  description: string;
  category: string;
  tags: string[];
  contentRating: PhantomPlayRating;
  // Optional — omitted on all pre-existing games, treat missing as [].
  contentDescriptors?: PhantomPlayContentDescriptor[];
  // Optional free-text summaries of a game's multiplayer/chat surface, for
  // display next to the rating (e.g. "Local co-op, no networking" or
  // "Cross-network relay rooms, text chat disabled"). Omitted on all
  // pre-existing games.
  multiplayerDescriptor?: string;
  chatDescriptor?: string;
  developer: string;
  developerAvatar?: string;
  kind: "built_in" | "community";
  launchUrl: string;
  thumbnail: string;
  featured: boolean;
  version: string;
  controls: string;
  progressSupport: boolean;
  scoreSupport: boolean;
  engine?: PhantomPlayEngineProfile;
};

const PHANTOMPLAY_ART_VERSION = "phantomplay-art-20260712";
export const PHANTOMPLAY_ENGINE = {
  version: "2.0-large-map",
  saveStateBytes: 262_144,
  largeMap: { chunkSize: 1024, maxLoadedChunks: 64, streaming: true },
  protocols: ["ready", "score", "progress", "complete", "paused", "exit", "settings", "save-state", "load-state"],
} as const;
const artUrl = (file: string) => `/app/assets/phantomplay/${file}?v=${PHANTOMPLAY_ART_VERSION}`;
const TAK_AVATAR = artUrl("tak-avatar.webp");
const GAME_ART_BY_SLUG: Record<string, string> = {
  "neon-drift": artUrl("neon-drift-cover.webp"),
  "signal-match": artUrl("signal-match-cover.webp"),
  "focus-stack": artUrl("focus-stack-cover.webp"),
  "word-weld": artUrl("word-weld-cover.webp"),
  "reflex-grid": artUrl("reflex-grid-cover.webp"),
  "penalty-kick": artUrl("penalty-kick-cover.webp"),
  "rift-frenzy": artUrl("neon-drift-cover.webp"),
  "serpent-surge": artUrl("reflex-grid-cover.webp"),
};
const CATEGORY_ART: Record<string, string> = {
  Arcade: GAME_ART_BY_SLUG["neon-drift"],
  Puzzle: GAME_ART_BY_SLUG["signal-match"],
  Focus: GAME_ART_BY_SLUG["focus-stack"],
  Strategy: GAME_ART_BY_SLUG["reflex-grid"],
  Sports: GAME_ART_BY_SLUG["penalty-kick"],
  Creative: GAME_ART_BY_SLUG["word-weld"],
};

type PlaySession = {
  id: string;
  gameId: string;
  startedAt: string;
  updatedAt: string;
  endedAt: string | null;
  seconds: number;
  score: number | null;
  progress: number;
  state: Record<string, string | number | boolean | null>;
};

// Coarse audience type for this profile. Drives the DEFAULT of
// preferences.allowedRatings when a profile is first created (adult = every
// tier; child/toddler = every tier except "mature", per the "no Mature
// exposure by default for child profiles" rule). Does not itself gate
// anything after creation — allowedRatings is the actual enforcement set.
export type PhantomPlayProfileType = "adult" | "child" | "toddler";

// PIN-gates a child/toddler profile's own ability to widen its rating
// exposure. pinHash/pinSalt are sha256(salt + pin) — never store a plaintext
// PIN. When enabled and the acting session is not a workspace/platform admin,
// preferences.allowedRatings + profileType changes require a matching PIN.
export type PhantomPlayGuardianLock = {
  enabled: boolean;
  pinHash: string | null;
  pinSalt: string | null;
  updatedAt: string;
};

type PlayerProfile = {
  tenantId: string;
  actorId: string;
  favorites: string[];
  sessions: PlaySession[];
  profileType: PhantomPlayProfileType;
  guardianLock: PhantomPlayGuardianLock;
  preferences: {
    contentRating: PhantomPlayRating;
    // "Game Rating Exposure": the actual per-profile allow-set. A rating
    // absent from this array is hidden from this profile's catalog no matter
    // what `contentRating` (the legacy single ceiling) says — both must pass.
    allowedRatings: PhantomPlayRating[];
    sound: boolean;
    reducedMotion: boolean;
    allowCommunityGames: boolean;
  };
  updatedAt: string;
};

type PhantomPlayRoomMode = "friends" | "classroom";
type PhantomPlayRoomStatus = "open" | "locked" | "ended" | "expired";
type PhantomPlayRoomParticipant = {
  actorId: string;
  label: string;
  role: "host" | "player";
  status: "online" | "left";
  joinedAt: string;
  lastSeenAt: string;
};

// Per-participant ready-check, keyed by actorId. A missing key means "not
// marked ready" (same as `false`) — never assume ready for an absent key.
export type PhantomPlayRoomReadyStates = Record<string, boolean>;

// Host-set caps on the room. `maxHumans` defaults to 3 (kept well under
// `maxPlayers`, which already caps at 8/30 for friends/classroom) — a room
// only needs a higher maxHumans when a specific game's design calls for it,
// so callers pass an explicit value rather than relying on maxPlayers alone.
export type PhantomPlayRoomHostControls = {
  allowBotFill: boolean;
  maxHumans: number;
};

// A game-defined bot seat. `difficulty` is a free-text label the game
// interprets itself (the platform never simulates bot behavior).
export type PhantomPlayRoomBotSlot = {
  slotId: string;
  difficulty: string;
};

export type PhantomPlayRoom = {
  id: string;
  code: string;
  tenantId: string;
  hostActorId: string;
  hostLabel: string;
  gameId: string;
  gameTitle: string;
  mode: PhantomPlayRoomMode;
  status: PhantomPlayRoomStatus;
  maxPlayers: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  participants: PhantomPlayRoomParticipant[];
  // Generic JSON-serializable match-state envelope. The platform never reads
  // or interprets its contents — each game defines its own internal shape.
  // Written only via updatePhantomPlayRoomMatchState (host-authoritative).
  matchState: unknown;
  readyStates: PhantomPlayRoomReadyStates;
  hostControls: PhantomPlayRoomHostControls;
  botSlots: PhantomPlayRoomBotSlot[];
  // Seconds a participant may remain `status: "online"` with a stale
  // lastSeenAt before API consumers should treat them as effectively
  // disconnected. Purely advisory to consumers — the server never
  // auto-removes a participant for exceeding this window.
  reconnectGraceSeconds: number;
  safety: {
    transport: "workspace_relay";
    joinPolicy: "signed_in_same_tenant_code";
    publicDiscovery: false;
    directPeerConnection: false;
    inboundDevicePorts: false;
    chat: false;
    voice: false;
    externalGameNetworking: false;
    inviteTtlMinutes: number;
    contentPolicy: "everyone_rating_required" | "profile_content_setting";
  };
};

export type PhantomPlaySubmission = {
  id: string;
  tenantId: string;
  developerId: string;
  developerName: string;
  title: string;
  summary: string;
  description: string;
  category: string;
  contentRating: PhantomPlayRating;
  launchUrl: string;
  screenshots: string[];
  tags: string[];
  controls: string;
  dataHandling: string;
  version: string;
  status: PhantomPlaySubmissionStatus;
  featured: boolean;
  moderationNote: string;
  versions: Array<{ version: string; submittedAt: string; notes: string }>;
  createdAt: string;
  updatedAt: string;
};

// Append-only audit trail for rating-relevant changes: a game's
// contentRating/contentDescriptors changing, or a profile's
// allowedRatings/guardianLock changing via an admin or guardian action.
// Never written to by ordinary player actions (favoriting, playing, etc).
export type PhantomPlayRatingChangeEntry = {
  id: string;
  actorId: string;
  ts: string;
  gameId?: string;
  profileId?: string;
  field: "contentRating" | "contentDescriptors" | "allowedRatings" | "guardianLock" | "profileType";
  previousValue: unknown;
  newValue: unknown;
  reason: string;
};

// Per-game admin override of contentRating/contentDescriptors. Built-in
// games are a source-defined constant array (PHANTOMPLAY_BUILT_IN_GAMES); we
// never mutate that array in place. An override here is merged on top of a
// game (built-in or community) wherever the catalog is assembled. Exported
// so other modules (e.g. phantomplay-v2.ts's own catalog-consuming surfaces)
// can merge/read the same overrides read-only, matching V2's existing
// read-only-of-V1-store pattern.
export type PhantomPlayGameOverride = {
  contentRating?: PhantomPlayRating;
  contentDescriptors?: PhantomPlayContentDescriptor[];
  updatedAt: string;
};

// Pure merge helper, reusable outside this module's store shape.
export function mergeGameRatingOverride(game: PhantomPlayGame, override?: PhantomPlayGameOverride): PhantomPlayGame {
  if (!override) return game;
  return {
    ...game,
    contentRating: override.contentRating ?? game.contentRating,
    contentDescriptors: override.contentDescriptors ?? game.contentDescriptors,
  };
}

// True when `rating` is visible under a profile's "Game Rating Exposure"
// allow-set. An empty/missing allow-set is treated as unrestricted (matches
// the "adult" default / pre-feature-backfill behavior) rather than hiding
// everything, so a caller that hasn't loaded a profile's set yet fails open
// to "show" rather than silently hiding the whole catalog.
export function isRatingAllowed(rating: PhantomPlayRating, allowedRatings: PhantomPlayRating[] | undefined | null): boolean {
  if (!allowedRatings || !allowedRatings.length) return true;
  return allowedRatings.includes(rating);
}

type PhantomPlayStore = {
  version: 1;
  profiles: Record<string, PlayerProfile>;
  rooms: PhantomPlayRoom[];
  submissions: PhantomPlaySubmission[];
  ratingChangeHistory: PhantomPlayRatingChangeEntry[];
  gameOverrides: Record<string, PhantomPlayGameOverride>;
};

const TAK_CREATOR = "Tak";

export const PHANTOMPLAY_BUILT_IN_GAMES: PhantomPlayGame[] = [
  {
    id: "neon-drift",
    title: "Neon Drift",
    summary: "Auto-fire spaceship shooter with waves, powerups, and shield saves.",
    description: "A real arcade shooter: fly fast, fire nonstop, collect rapid fire, spread shot, shield, magnet, and repair powerups, then push deeper into harder waves.",
    category: "Arcade",
    tags: ["shooter", "powerups", "arcade", "touch"],
    contentRating: "everyone",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/neon-drift.html?v=1.2.4",
    thumbnail: GAME_ART_BY_SLUG["neon-drift"],
    featured: true,
    version: "1.2.4",
    controls: "WASD/arrow keys to fly. Auto-fire is always on.",
    progressSupport: true,
    scoreSupport: true,
    engine: { tier: "arcade-large-map", minVersion: PHANTOMPLAY_ENGINE.version },
  },
  {
    id: "signal-match",
    title: "Signal Match",
    summary: "Find the matching signals before the grid resets.",
    description: "A calm memory game with short rounds, a visible score, keyboard support, and saved best scores.",
    category: "Puzzle",
    tags: ["memory", "flash", "puzzle", "touch"],
    contentRating: "everyone",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/signal-match.html?v=1.1.1",
    thumbnail: GAME_ART_BY_SLUG["signal-match"],
    featured: true,
    version: "1.1.1",
    controls: "Click, tap, or use Tab + Enter",
    progressSupport: true,
    scoreSupport: true,
  },
  {
    id: "focus-stack",
    title: "Focus Stack",
    summary: "Drop each layer cleanly and build the tallest signal tower.",
    description: "A timing game designed for quick intentional breaks, with visible score, resumable progress, and a local best score.",
    category: "Focus",
    tags: ["timing", "focus", "quick", "touch"],
    contentRating: "everyone",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/focus-stack.html?v=1.1.1",
    thumbnail: GAME_ART_BY_SLUG["focus-stack"],
    featured: false,
    version: "1.1.1",
    controls: "Space, Enter, click, or tap",
    progressSupport: true,
    scoreSupport: true,
  },
  {
    id: "word-weld",
    title: "Word Weld",
    summary: "Build as many words as you can from one shifting signal rack.",
    description: "A quick word-building game with tap, keyboard, score, timer, and clean reset controls.",
    category: "Creative",
    tags: ["word", "creative", "quick", "touch"],
    contentRating: "everyone",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/word-weld.html?v=1.0.0",
    thumbnail: GAME_ART_BY_SLUG["word-weld"],
    featured: true,
    version: "1.0.0",
    controls: "Keyboard, tap letters, Enter to submit",
    progressSupport: true,
    scoreSupport: true,
  },
  {
    id: "reflex-grid",
    title: "Reflex Grid",
    summary: "Hit the live cells before the grid burns out.",
    description: "A fast aim-and-reaction grid for short focus breaks, with mistakes, streaks, and a real finish.",
    category: "Strategy",
    tags: ["reaction", "strategy", "touch", "aim"],
    contentRating: "everyone",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/reflex-grid.html?v=1.0.0",
    thumbnail: GAME_ART_BY_SLUG["reflex-grid"],
    featured: true,
    version: "1.0.0",
    controls: "Click, tap, or use number keys",
    progressSupport: true,
    scoreSupport: true,
  },
  {
    id: "penalty-kick",
    title: "Penalty Kick",
    summary: "Pick your lane, time the strike, and beat the keeper.",
    description: "A touch-friendly sports timing game with five shots, visible score, keeper reads, and saved score.",
    category: "Sports",
    tags: ["sports", "timing", "soccer", "touch"],
    contentRating: "everyone",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/penalty-kick.html?v=1.0.1",
    thumbnail: GAME_ART_BY_SLUG["penalty-kick"],
    featured: false,
    version: "1.0.1",
    controls: "Choose a lane, then tap shoot at the sweet spot",
    progressSupport: true,
    scoreSupport: true,
  },
  {
    id: "rift-frenzy",
    title: "Rift Frenzy",
    summary: "Grow from reef bait to apex hunter in a neon multiplayer-style fish arena.",
    description: "A modern eat-smaller-fish arena with rival schools, growth stages, boost windows, danger reads, and touch-friendly movement. It feels like a live arena even when running as a safe built-in sandbox.",
    category: "Arcade",
    tags: ["fish", "arena", "growth", "io", "touch"],
    contentRating: "everyone",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/rift-frenzy.html?v=1.0.5",
    thumbnail: GAME_ART_BY_SLUG["rift-frenzy"],
    featured: true,
    version: "1.0.5",
    controls: "Move with WASD/arrow keys or touch-drag. Eat smaller fish, avoid bigger rivals, boost with Space.",
    progressSupport: true,
    scoreSupport: true,
    engine: { tier: "arena-large-map", minVersion: PHANTOMPLAY_ENGINE.version },
  },
  {
    id: "serpent-surge",
    title: "Serpent Surge",
    summary: "A fast snake arena with rivals, pickups, cutoffs, boost trails, and storm pressure.",
    description: "A PhantomPlay take on snake arena games: orbit energy, grow long, bait rival serpents, use boost carefully, and survive a closing storm ring without any external networking.",
    category: "Strategy",
    tags: ["snake", "arena", "io", "survival", "touch"],
    contentRating: "everyone",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/serpent-surge.html?v=1.0.4",
    thumbnail: GAME_ART_BY_SLUG["serpent-surge"],
    featured: true,
    version: "1.0.4",
    controls: "Steer with mouse, touch, WASD, or arrows. Hold Space or touch pressure to boost.",
    progressSupport: true,
    scoreSupport: true,
    engine: { tier: "arena-large-map", minVersion: PHANTOMPLAY_ENGINE.version },
  },
  {
    id: "color-rush",
    title: "Color Rush",
    summary: "Catch only the target color as the tiles fall faster.",
    description: "Four falling columns and a rotating target color. Catch the right hue, ignore the rest, keep three lives.",
    category: "Arcade",
    tags: ["reaction", "color", "keyboard", "touch"],
    contentRating: "everyone",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/color-rush.html",
    thumbnail: CATEGORY_ART["Arcade"],
    featured: false,
    version: "1.0.0",
    controls: "A/S/D/F or tap a column",
    progressSupport: true,
    scoreSupport: true,
  },
  {
    id: "tile-flow",
    title: "Tile Flow",
    summary: "Rotate the pipes to connect the signal end to end.",
    description: "Eight hand-verified solvable levels. Turn each tile until the flow reaches the exit.",
    category: "Puzzle",
    tags: ["logic", "calm", "keyboard", "touch"],
    contentRating: "everyone",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/tile-flow.html",
    thumbnail: CATEGORY_ART["Puzzle"],
    featured: false,
    version: "1.0.0",
    controls: "Click/tap to rotate, arrows to move",
    progressSupport: true,
    scoreSupport: true,
  },
  {
    id: "tower-tactics",
    title: "Tower Tactics",
    summary: "Slide and merge matching tiles to build the highest number.",
    description: "A tight 4x4 merge puzzle. Plan your slides — the board fills fast when you stop thinking ahead.",
    category: "Strategy",
    tags: ["merge", "strategy", "keyboard", "touch"],
    contentRating: "everyone",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/tower-tactics.html",
    thumbnail: CATEGORY_ART["Strategy"],
    featured: false,
    version: "1.0.0",
    controls: "Arrow keys or swipe",
    progressSupport: true,
    scoreSupport: true,
  },
  {
    id: "breath-pacer",
    title: "Breath Pacer",
    summary: "Match your breath to the pacer and reset in two minutes.",
    description: "A box-breathing companion. Follow the expanding ring through inhale, hold, exhale, hold and score your timing.",
    category: "Focus",
    tags: ["calm", "breathing", "wellness", "touch"],
    contentRating: "everyone",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/breath-pacer.html",
    thumbnail: CATEGORY_ART["Focus"],
    featured: false,
    version: "1.0.0",
    controls: "Tap or press Space on each phase",
    progressSupport: true,
    scoreSupport: true,
  },
  {
    id: "court-vision",
    title: "Court Vision",
    summary: "Read the arc and power to sink the free throw.",
    description: "A physics free-throw shooter. The distance and rim grow with every make; three misses ends the game.",
    category: "Sports",
    tags: ["sports", "physics", "timing", "touch"],
    contentRating: "everyone",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/court-vision.html",
    thumbnail: CATEGORY_ART["Sports"],
    featured: false,
    version: "1.0.0",
    controls: "Tap or press Space to shoot",
    progressSupport: true,
    scoreSupport: true,
  },
  {
    id: "pixel-bloom",
    title: "Pixel Bloom",
    summary: "Bloom a symmetric neon mandala — no timer, no pressure.",
    description: "A calm creative toy. Place petals that mirror four ways; build combos as the pattern fills.",
    category: "Creative",
    tags: ["calm", "creative", "relax", "touch"],
    contentRating: "everyone",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/pixel-bloom.html",
    thumbnail: CATEGORY_ART["Creative"],
    featured: false,
    version: "1.0.0",
    controls: "Tap cells or arrows + Space",
    progressSupport: true,
    scoreSupport: true,
  },
  {
    id: "circuit-serpent",
    title: "Circuit Serpent",
    summary: "Grow the serpent — eat packets, dodge walls and your own tail.",
    description: "Classic snake on a 17x17 circuit board. Speed climbs every five packets; one crash ends the run.",
    category: "Arcade",
    tags: ["snake", "classic", "reaction", "touch"],
    contentRating: "everyone",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/circuit-serpent.html",
    thumbnail: CATEGORY_ART["Arcade"],
    featured: false,
    version: "1.0.0",
    controls: "Arrows/WASD, swipe, or tap screen edges",
    progressSupport: true,
    scoreSupport: true,
  },
  {
    id: "echo-sequence",
    title: "Echo Sequence",
    summary: "Watch the pads light up, then echo the pattern back.",
    description: "A memory-sequence classic with four glowing pads and original tones. One wrong echo ends the run.",
    category: "Focus",
    tags: ["memory", "sequence", "sound", "touch"],
    contentRating: "everyone",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/echo-sequence.html",
    thumbnail: CATEGORY_ART["Focus"],
    featured: true,
    version: "1.0.0",
    controls: "Tap pads or press 1-4",
    progressSupport: true,
    scoreSupport: true,
  },
  {
    id: "signal-sweeper",
    title: "Signal Sweeper",
    summary: "Clear the grid without touching a mine — the numbers tell the truth.",
    description: "Minesweeper with a guaranteed-safe first reveal, flag mode, long-press flagging, and a race-the-clock score.",
    category: "Strategy",
    tags: ["logic", "classic", "mines", "touch"],
    contentRating: "everyone",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/signal-sweeper.html",
    thumbnail: CATEGORY_ART["Strategy"],
    featured: false,
    version: "1.0.0",
    controls: "Tap to reveal, long-press or F to flag",
    progressSupport: true,
    scoreSupport: true,
  },
  {
    id: "neon-breaker",
    title: "Neon Breaker",
    summary: "Break every brick — the angle is yours to control.",
    description: "Breakout with real deflection physics, six brick tiers, and levels that speed up as they clear.",
    category: "Arcade",
    tags: ["classic", "paddle", "levels", "touch"],
    contentRating: "everyone",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/neon-breaker.html",
    thumbnail: CATEGORY_ART["Arcade"],
    featured: true,
    version: "1.0.0",
    controls: "Drag or Arrow keys, Space to launch",
    progressSupport: true,
    scoreSupport: true,
  },
  {
    id: "type-storm",
    title: "Type Storm",
    summary: "Type the falling words before they breach your shields.",
    description: "A typing sprint with 200 words, combo streaks, and a pace that keeps climbing. Three shields, no mercy.",
    category: "Focus",
    tags: ["typing", "speed", "keyboard", "words"],
    contentRating: "everyone",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/type-storm.html",
    thumbnail: CATEGORY_ART["Focus"],
    featured: false,
    version: "1.0.0",
    controls: "Just type — tap first on mobile",
    progressSupport: true,
    scoreSupport: true,
  },
  {
    id: "logic-lights",
    title: "Logic Lights",
    summary: "Turn every light off — each tap flips its neighbors too.",
    description: "Ten hand-guaranteed solvable Lights Out levels with par scores. Beat par, bank the points.",
    category: "Puzzle",
    tags: ["logic", "lights-out", "calm", "touch"],
    contentRating: "everyone",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/logic-lights.html",
    thumbnail: CATEGORY_ART["Puzzle"],
    featured: false,
    version: "1.0.0",
    controls: "Tap cells or arrows + Enter",
    progressSupport: true,
    scoreSupport: true,
  },
];

const ratingRank: Record<PhantomPlayRating, number> = { toddler: 0, everyone: 1, everyone10: 2, teen: 3, mature: 4 };
const ALL_RATINGS: PhantomPlayRating[] = ["toddler", "everyone", "everyone10", "teen", "mature"];
const clean = (value: unknown, max = 500) => String(value ?? "").trim().replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max);
const now = () => new Date().toISOString();
const clamp = (value: unknown, min: number, max: number) => Math.max(min, Math.min(max, Number(value) || 0));
const safeRating = (value: unknown): PhantomPlayRating =>
  value === "mature" || value === "teen" || value === "everyone10" || value === "toddler" ? value : "everyone";
const safeProfileType = (value: unknown): PhantomPlayProfileType => value === "child" || value === "toddler" ? value : "adult";
// Adult profiles default to every tier. Child/toddler profiles default to
// every tier EXCEPT "mature" — the brief's "no Mature exposure by default
// for child profiles" rule. Toddler is further restricted to the two
// gentlest tiers by default (Toddler Space separation is a later UI step;
// this is the data-model half of it).
function defaultAllowedRatings(profileType: PhantomPlayProfileType): PhantomPlayRating[] {
  if (profileType === "adult") return [...ALL_RATINGS];
  if (profileType === "toddler") return ["toddler", "everyone"];
  return ["toddler", "everyone", "everyone10", "teen"];
}
function safeAllowedRatings(value: unknown, fallback: PhantomPlayRating[]): PhantomPlayRating[] {
  if (!Array.isArray(value)) return fallback;
  const cleaned = [...new Set(value.filter((item): item is PhantomPlayRating => ALL_RATINGS.includes(item as PhantomPlayRating)))];
  return cleaned.length ? cleaned : fallback;
}

// Guardian PIN is never stored in plaintext — only sha256(salt + pin).
function hashGuardianPin(pin: string, pinSalt: string) {
  return createHash("sha256").update(`${pinSalt}:${pin}`).digest("hex");
}
function verifyGuardianPin(lock: PhantomPlayGuardianLock, pin: unknown): boolean {
  if (!lock.pinHash || !lock.pinSalt) return false;
  const candidate = clean(pin, 32);
  return candidate.length > 0 && hashGuardianPin(candidate, lock.pinSalt) === lock.pinHash;
}

// Append-only; see PhantomPlayRatingChangeEntry for the shape.
function appendRatingChangeHistory(store: PhantomPlayStore, entry: Omit<PhantomPlayRatingChangeEntry, "id" | "ts">) {
  store.ratingChangeHistory = Array.isArray(store.ratingChangeHistory) ? store.ratingChangeHistory : [];
  store.ratingChangeHistory.unshift({ id: `rating-change-${randomUUID()}`, ts: now(), ...entry });
  store.ratingChangeHistory = store.ratingChangeHistory.slice(0, 2000);
}
const safeVersion = (value: unknown) => /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(clean(value, 40)) ? clean(value, 40) : "1.0.0";
const ROOM_TTL_MINUTES = 90;
const ROOM_RECONNECT_GRACE_SECONDS = 45;
const ROOM_DEFAULT_MAX_HUMANS = 3;
const ROOM_MATCH_STATE_MAX_BYTES = 65_536;
const ROOM_MAX_BOT_SLOTS = 12;
const privateHost = (hostname: string) => {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || [".localhost", ".local", ".internal", ".lan", ".home"].some((suffix) => host.endsWith(suffix)) || host === "0.0.0.0" || host === "::1") return true;
  if (/^(10|127|169\.254|192\.168)\./.test(host)) return true;
  const private172 = host.match(/^172\.(\d{1,3})\./);
  if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return true;
  const carrier100 = host.match(/^100\.(\d{1,3})\./);
  if (carrier100 && Number(carrier100[1]) >= 64 && Number(carrier100[1]) <= 127) return true;
  if (/^198\.(18|19)\./.test(host)) return true;
  return /^(fc|fd|fe80):/i.test(host);
};
const publicHttpsUrl = (value: unknown) => {
  const raw = clean(value, 700);
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password && !privateHost(url.hostname) ? raw : "";
  } catch { return ""; }
};
const safeUrl = (value: unknown) => {
  const url = clean(value, 700);
  if (!url) return "";
  if (url.startsWith("/app/games/community/")) return url;
  return publicHttpsUrl(url);
};
const safeScreenshot = (value: unknown) => {
  const url = clean(value, 700);
  if (url.startsWith("/app/")) return url;
  return publicHttpsUrl(url);
};

function slugifyGame(value: unknown) {
  return clean(value, 180).toLowerCase()
    .replace(/^community:/u, "")
    .replace(/['']/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function artSlugFor(game: Pick<PhantomPlayGame, "id" | "title">) {
  const idSlug = slugifyGame(game.id);
  if (GAME_ART_BY_SLUG[idSlug]) return idSlug;
  const titleSlug = slugifyGame(game.title);
  return GAME_ART_BY_SLUG[titleSlug] ? titleSlug : "";
}

function isPlaceholderThumbnail(value: unknown) {
  const thumbnail = clean(value, 700);
  return !thumbnail || thumbnail.includes("/app/assets/poses/") || thumbnail.includes("brand-phantom") || thumbnail.includes("mode-dark");
}

function thumbnailFor(game: PhantomPlayGame) {
  const slug = artSlugFor(game);
  if (slug) return GAME_ART_BY_SLUG[slug];
  if (isPlaceholderThumbnail(game.thumbnail)) return CATEGORY_ART[game.category] || GAME_ART_BY_SLUG["neon-drift"];
  return game.thumbnail;
}

function developerNameFor(game: PhantomPlayGame) {
  return game.kind === "built_in" || artSlugFor(game) || game.developer === "Phantom Labs" ? "Tak" : (game.developer || "Tak");
}

// Merges an admin rating-override (contentRating/contentDescriptors) on top
// of a catalog entry, if one exists. Never mutates PHANTOMPLAY_BUILT_IN_GAMES
// or PHANTOMPLAY_V2_GAMES themselves — overrides live only in the JSON store.
function applyGameOverride(store: PhantomPlayStore, game: PhantomPlayGame): PhantomPlayGame {
  return mergeGameRatingOverride(game, store.gameOverrides?.[game.id]);
}

function normalizeGameArt(game: PhantomPlayGame): PhantomPlayGame {
  const developer = developerNameFor(game);
  return {
    ...game,
    developer,
    developerAvatar: developer === "Tak" ? (game.developerAvatar || TAK_AVATAR) : game.developerAvatar,
    thumbnail: thumbnailFor(game),
  };
}

function tenantIdFor(session: AccessSession, requested?: unknown) {
  const own = session.orgId || session.clientId || session.id || "phantomforce";
  if (!session.canManageAccess) return clean(own, 100) || "phantomforce";
  return clean(requested, 100) || clean(own, 100) || "phantomforce";
}

function actorIdFor(session: AccessSession) {
  return clean(session.userId || session.id, 120) || "anonymous";
}

function actorLabelFor(session: AccessSession) {
  return clean(session.label || session.userId || session.id, 90) || "Player";
}

function profileKey(tenantId: string, actorId: string) {
  return `${tenantId}::${actorId}`;
}

function freshProfile(tenantId: string, actorId: string, profileType: PhantomPlayProfileType = "adult"): PlayerProfile {
  return {
    tenantId,
    actorId,
    favorites: [],
    sessions: [],
    profileType,
    guardianLock: { enabled: false, pinHash: null, pinSalt: null, updatedAt: now() },
    preferences: {
      contentRating: "teen",
      allowedRatings: defaultAllowedRatings(profileType),
      sound: true,
      reducedMotion: false,
      allowCommunityGames: true,
    },
    updatedAt: now(),
  };
}

// Backfills rooms persisted before matchState/readyStates/hostControls/
// botSlots/reconnectGraceSeconds existed, so an older store file never
// crashes a reader that assumes these fields are present.
function normalizeRoomShape(room: Partial<PhantomPlayRoom> & Record<string, unknown>): PhantomPlayRoom {
  const maxPlayers = Number.isFinite(room.maxPlayers) ? (room.maxPlayers as number) : 8;
  const hostControls = room.hostControls && typeof room.hostControls === "object" && !Array.isArray(room.hostControls)
    ? (room.hostControls as Partial<PhantomPlayRoomHostControls>)
    : {};
  return {
    ...(room as PhantomPlayRoom),
    matchState: Object.prototype.hasOwnProperty.call(room, "matchState") ? room.matchState : null,
    readyStates: room.readyStates && typeof room.readyStates === "object" && !Array.isArray(room.readyStates) ? (room.readyStates as PhantomPlayRoomReadyStates) : {},
    hostControls: {
      allowBotFill: hostControls.allowBotFill === true,
      maxHumans: Number.isFinite(hostControls.maxHumans) ? Math.floor(clamp(hostControls.maxHumans, 1, Math.max(maxPlayers, 1))) : Math.min(ROOM_DEFAULT_MAX_HUMANS, Math.max(maxPlayers, 1)),
    },
    botSlots: Array.isArray(room.botSlots) ? (room.botSlots as PhantomPlayRoomBotSlot[]).slice(0, ROOM_MAX_BOT_SLOTS) : [],
    reconnectGraceSeconds: Number.isFinite(room.reconnectGraceSeconds) ? Math.max(5, Math.floor(room.reconnectGraceSeconds as number)) : ROOM_RECONNECT_GRACE_SECONDS,
  };
}

async function readStore(): Promise<PhantomPlayStore> {
  try {
    const parsed = JSON.parse(await readFile(storePath, "utf8")) as Partial<PhantomPlayStore>;
    return {
      version: 1,
      profiles: parsed.profiles && typeof parsed.profiles === "object" ? parsed.profiles : {},
      rooms: Array.isArray(parsed.rooms) ? parsed.rooms.map((room) => normalizeRoomShape(room as PhantomPlayRoom)) : [],
      submissions: Array.isArray(parsed.submissions) ? parsed.submissions : [],
      ratingChangeHistory: Array.isArray(parsed.ratingChangeHistory) ? parsed.ratingChangeHistory : [],
      gameOverrides: parsed.gameOverrides && typeof parsed.gameOverrides === "object" ? parsed.gameOverrides : {},
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, profiles: {}, rooms: [], submissions: [], ratingChangeHistory: [], gameOverrides: {} };
    throw error;
  }
}

let writes = Promise.resolve();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function replaceStoreFile(temp: string, target: string) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await rename(temp, target);
      return;
    } catch (error) {
      lastError = error;
      const code = String((error as NodeJS.ErrnoException).code || "");
      if (!retryableWriteCodes.has(code)) {
        throw error;
      }
      await sleep(40 * (attempt + 1));
    }
  }

  try {
    await copyFile(temp, target);
    await unlink(temp).catch(() => undefined);
  } catch (fallbackError) {
    throw lastError instanceof Error ? lastError : fallbackError;
  }
}

async function writeStore(store: PhantomPlayStore) {
  const nextWrite = writes.catch(() => undefined).then(async () => {
    await mkdir(dirname(storePath), { recursive: true });
    const temp = `${storePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(store, null, 2), "utf8");
    await replaceStoreFile(temp, storePath);
  });
  writes = nextWrite.catch(() => undefined);
  await nextWrite;
}

function ensureProfile(store: PhantomPlayStore, tenantId: string, actorId: string) {
  const key = profileKey(tenantId, actorId);
  const profile = store.profiles[key] || freshProfile(tenantId, actorId);
  profile.favorites = Array.isArray(profile.favorites) ? profile.favorites.slice(0, 200) : [];
  profile.sessions = Array.isArray(profile.sessions) ? profile.sessions.slice(0, 120) : [];
  // Backfill fields for profiles persisted before this feature existed.
  // Pre-existing profiles are treated as "adult" (unrestricted) so upgrading
  // this server never silently hides games from an already-active account.
  profile.profileType = safeProfileType(profile.profileType);
  if (!profile.guardianLock || typeof profile.guardianLock !== "object") {
    profile.guardianLock = { enabled: false, pinHash: null, pinSalt: null, updatedAt: now() };
  }
  if (!Array.isArray(profile.preferences.allowedRatings) || !profile.preferences.allowedRatings.length) {
    profile.preferences.allowedRatings = defaultAllowedRatings(profile.profileType);
  }
  store.profiles[key] = profile;
  return profile;
}

function communityGames(store: PhantomPlayStore): PhantomPlayGame[] {
  return store.submissions.filter((item) => item.status === "approved" && item.launchUrl).map((item) => normalizeGameArt({
    id: `community:${item.id}`,
    title: item.title,
    summary: item.summary,
    description: item.description,
    category: item.category,
    tags: item.tags,
    contentRating: item.contentRating,
    developer: item.developerName,
    kind: "community",
    launchUrl: item.launchUrl,
    thumbnail: item.screenshots[0] || "/app/assets/poses/mode-dark-ask.webp",
    featured: item.featured,
    version: item.version,
    controls: item.controls,
    progressSupport: true,
    scoreSupport: true,
  }));
}

// Applies BOTH the legacy single-ceiling preference (ratingRank comparison)
// AND the richer per-profile "Game Rating Exposure" allow-set — a game
// hidden by either must not appear. Admin gameOverrides are merged in before
// either filter runs, so an overridden rating is what gets checked.
function catalogFor(store: PhantomPlayStore, profile: PlayerProfile) {
  const all = [...PHANTOMPLAY_BUILT_IN_GAMES, ...(profile.preferences.allowCommunityGames ? communityGames(store) : [])]
    .map((game) => applyGameOverride(store, game))
    .map(normalizeGameArt);
  const allowedRatings = new Set(safeAllowedRatings(profile.preferences.allowedRatings, defaultAllowedRatings(profile.profileType)));
  return all
    .filter((game) => ratingRank[game.contentRating] <= ratingRank[profile.preferences.contentRating])
    .filter((game) => allowedRatings.has(game.contentRating));
}

function historySummary(profile: PlayerProfile) {
  const byGame = new Map<string, { latest: PlaySession; bestScore: number | null; totalSeconds: number }>();
  for (const item of profile.sessions) {
    const current = byGame.get(item.gameId);
    if (!current) {
      byGame.set(item.gameId, { latest: item, bestScore: item.score, totalSeconds: item.seconds });
      continue;
    }
    current.totalSeconds += item.seconds;
    if (item.score !== null) current.bestScore = Math.max(current.bestScore ?? 0, item.score);
    if (current.latest.updatedAt < item.updatedAt) current.latest = item;
  }
  return [...byGame.values()].sort((a, b) => b.latest.updatedAt.localeCompare(a.latest.updatedAt)).map((item) => ({
    gameId: item.latest.gameId,
    lastPlayedAt: item.latest.updatedAt,
    score: item.bestScore,
    progress: item.latest.progress,
    seconds: item.totalSeconds,
    canContinue: item.latest.progress > 0 && item.latest.progress < 100,
  }));
}

function phantomLeaderboards(store: PhantomPlayStore, catalog: PhantomPlayGame[], actorId: string) {
  const gameIds = new Set(catalog.map((game) => game.id));
  const scores: Array<{ gameId: string; gameTitle: string; player: string; score: number; seconds: number; updatedAt: string; isYou: boolean }> = [];
  for (const profile of Object.values(store.profiles)) {
    for (const session of profile.sessions) {
      if (!gameIds.has(session.gameId) || session.score === null) continue;
      const gameTitle = catalog.find((game) => game.id === session.gameId)?.title || session.gameId;
      scores.push({
        gameId: session.gameId,
        gameTitle,
        player: profile.actorId === actorId ? "You" : `Player ${profile.actorId.slice(-4) || "ghost"}`,
        score: session.score,
        seconds: session.seconds,
        updatedAt: session.updatedAt,
        isYou: profile.actorId === actorId,
      });
    }
  }
  const sortScores = (rows: typeof scores) => rows.sort((a, b) => b.score - a.score || a.seconds - b.seconds || b.updatedAt.localeCompare(a.updatedAt));
  const byGame = catalog.map((game) => ({
    gameId: game.id,
    gameTitle: game.title,
    rows: sortScores(scores.filter((row) => row.gameId === game.id)).slice(0, 5),
  })).filter((board) => board.rows.length);
  return { overall: sortScores(scores.slice()).slice(0, 10), byGame };
}

function roomStatus(room: PhantomPlayRoom): PhantomPlayRoomStatus {
  if (room.status === "ended") return "ended";
  if (Date.parse(room.expiresAt) <= Date.now()) return "expired";
  return room.status;
}

function activeParticipantCount(room: PhantomPlayRoom) {
  return room.participants.filter((participant) => participant.status === "online").length;
}

function roomView(room: PhantomPlayRoom) {
  const status = roomStatus(room);
  return {
    ...room,
    status,
    participantCount: activeParticipantCount(room),
    safety: {
      transport: "workspace_relay" as const,
      joinPolicy: "signed_in_same_tenant_code" as const,
      publicDiscovery: false as const,
      directPeerConnection: false as const,
      inboundDevicePorts: false as const,
      chat: false as const,
      voice: false as const,
      externalGameNetworking: false as const,
      inviteTtlMinutes: ROOM_TTL_MINUTES,
      contentPolicy: room.safety?.contentPolicy || (room.mode === "classroom" ? "everyone_rating_required" : "profile_content_setting"),
    },
  };
}

function roomsForSnapshot(store: PhantomPlayStore, tenantId: string, actorId: string, session: AccessSession) {
  return store.rooms
    .filter((room) => room.tenantId === tenantId)
    .filter((room) => ["open", "locked"].includes(roomStatus(room)))
    .filter((room) => session.canManageAccess || room.participants.some((participant) => participant.actorId === actorId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 20)
    .map(roomView);
}

function pruneRooms(store: PhantomPlayStore) {
  store.rooms = (store.rooms || [])
    .filter((room) => room.status !== "ended")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 120);
}

function roomCode(value: unknown) {
  return clean(value, 24).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

function freshRoomCode(store: PhantomPlayStore, tenantId: string) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const code = randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
    if (!store.rooms.some((room) => room.tenantId === tenantId && room.code === code && ["open", "locked"].includes(roomStatus(room)))) return code;
  }
  throw new Error("Could not create a unique private room code.");
}

function findRoom(store: PhantomPlayStore, tenantId: string, code: unknown) {
  const normalized = roomCode(code);
  return normalized ? store.rooms.find((room) => room.tenantId === tenantId && room.code === normalized) : undefined;
}

function todaySeconds(profile: PlayerProfile) {
  const day = new Date().toISOString().slice(0, 10);
  return profile.sessions.filter((item) => item.startedAt.startsWith(day)).reduce((sum, item) => sum + item.seconds, 0);
}

function safePlayState(value: unknown): PlaySession["state"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const state: PlaySession["state"] = {};
  const entries = Object.entries(value as Record<string, unknown>).slice(0, 200);
  for (const [key, raw] of entries) {
    const cleanKey = clean(key, 80);
    if (!cleanKey) continue;
    state[cleanKey] = typeof raw === "string" ? clean(raw, 4000) : typeof raw === "number" || typeof raw === "boolean" || raw === null ? raw : null;
    while (Buffer.byteLength(JSON.stringify(state), "utf8") > PHANTOMPLAY_ENGINE.saveStateBytes) {
      delete state[cleanKey];
      return state;
    }
  }
  return state;
}

export async function getPhantomPlaySnapshot(session: AccessSession, options: { tenantId?: unknown; entitled?: boolean; dailyMinuteLimit?: number; canSubmitGames?: boolean } = {}) {
  const tenantId = tenantIdFor(session, options.tenantId);
  const actorId = actorIdFor(session);
  const store = await readStore();
  const profile = ensureProfile(store, tenantId, actorId);
  const catalog = catalogFor(store, profile);
  const dailyMinuteLimit = Math.max(0, Math.floor(options.dailyMinuteLimit ?? (session.canManageAccess ? 1440 : 60)));
  const usedSeconds = todaySeconds(profile);
  return {
    tenantId,
    actorId,
    access: {
      enabled: options.entitled !== false,
      reason: options.entitled === false ? "plan_restricted" : "available",
      dailyMinuteLimit,
      usedMinutesToday: Math.ceil(usedSeconds / 60),
      remainingMinutesToday: Math.max(0, dailyMinuteLimit - Math.ceil(usedSeconds / 60)),
      canSubmitGames: options.canSubmitGames ?? (session.canManageAccess || session.orgRole === "owner" || session.orgRole === "admin"),
      canModerate: session.canManageAccess || session.isSuperAdmin === true,
    },
    catalog,
    leaderboards: phantomLeaderboards(store, catalog, actorId),
    favorites: profile.favorites,
    history: historySummary(profile),
    preferences: profile.preferences,
    // Exposed the same shape PATCH /api/phantomplay/profile already returns
    // (never pinHash/pinSalt) so the client can render current rating
    // exposure + guardian-lock state without a spurious write-triggering
    // PATCH just to read it.
    profileType: profile.profileType,
    guardianLock: { enabled: profile.guardianLock.enabled },
    engine: PHANTOMPLAY_ENGINE,
    rooms: roomsForSnapshot(store, tenantId, actorId, session),
    submissions: store.submissions.filter((item) => item.developerId === actorId || session.canManageAccess).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    developerSpotlight: catalog.find((game) => game.featured)?.developer || "Tak",
    approvedCommunityCount: communityGames(store).length,
  };
}

export async function updatePhantomPlayProfile(session: AccessSession, input: Record<string, unknown>) {
  const tenantId = tenantIdFor(session, input.tenantId);
  const actorId = actorIdFor(session);
  const store = await readStore();
  const profile = ensureProfile(store, tenantId, actorId);
  const profileId = profileKey(tenantId, actorId);
  const gameId = clean(input.gameId, 180);
  if (input.favorite === true && gameId && !profile.favorites.includes(gameId)) profile.favorites.unshift(gameId);
  if (input.favorite === false && gameId) profile.favorites = profile.favorites.filter((id) => id !== gameId);

  const prefs = input.preferences && typeof input.preferences === "object" && !Array.isArray(input.preferences)
    ? (input.preferences as Record<string, unknown>)
    : {};
  const requestsRatingExposureChange = prefs.allowedRatings !== undefined || input.profileType !== undefined;
  // Platform/workspace admins always bypass the guardian PIN (same "admin
  // always may" precedent as workspace policy / submission moderation
  // elsewhere in this module). Otherwise, an enabled guardian lock requires
  // a matching PIN before allowedRatings or profileType may change.
  const guardianOk = session.canManageAccess || !profile.guardianLock.enabled || verifyGuardianPin(profile.guardianLock, input.guardianPin);
  if (requestsRatingExposureChange && !guardianOk) {
    throw new Error("A guardian PIN is required to change this profile's rating exposure.");
  }

  if (input.profileType !== undefined) {
    const previousValue = profile.profileType;
    const newValue = safeProfileType(input.profileType);
    if (newValue !== previousValue) {
      profile.profileType = newValue;
      appendRatingChangeHistory(store, { actorId, profileId, field: "profileType", previousValue, newValue, reason: clean(input.reason, 240) || "profile_type_update" });
    }
  }

  if (prefs.contentRating !== undefined) profile.preferences.contentRating = safeRating(prefs.contentRating);
  if (typeof prefs.sound === "boolean") profile.preferences.sound = prefs.sound;
  if (typeof prefs.reducedMotion === "boolean") profile.preferences.reducedMotion = prefs.reducedMotion;
  if (typeof prefs.allowCommunityGames === "boolean") profile.preferences.allowCommunityGames = prefs.allowCommunityGames;
  if (prefs.allowedRatings !== undefined) {
    const previousValue = profile.preferences.allowedRatings;
    const newValue = safeAllowedRatings(prefs.allowedRatings, previousValue);
    if (JSON.stringify([...newValue].sort()) !== JSON.stringify([...previousValue].sort())) {
      profile.preferences.allowedRatings = newValue;
      appendRatingChangeHistory(store, { actorId, profileId, field: "allowedRatings", previousValue, newValue, reason: clean(input.reason, 240) || "profile_preference_update" });
    }
  }

  // Guardian lock itself: enabling for the first time (or while already
  // disabled) needs no PIN — that's the guardian's initial setup moment.
  // Disabling it, or changing an already-set PIN, needs the current PIN (or
  // an admin session) so a child profile can't unlock itself.
  if (input.guardianLock && typeof input.guardianLock === "object" && !Array.isArray(input.guardianLock)) {
    const lockInput = input.guardianLock as Record<string, unknown>;
    const previousValue = { enabled: profile.guardianLock.enabled };
    const settingUpFresh = !profile.guardianLock.enabled && !profile.guardianLock.pinHash;
    if (settingUpFresh || guardianOk) {
      const nextEnabled = typeof lockInput.enabled === "boolean" ? lockInput.enabled : profile.guardianLock.enabled;
      const newPin = clean(lockInput.pin, 32);
      if (newPin) {
        const { pinHash, pinSalt } = ((pin: string) => { const salt = randomUUID(); return { pinHash: hashGuardianPin(pin, salt), pinSalt: salt }; })(newPin);
        profile.guardianLock.pinHash = pinHash;
        profile.guardianLock.pinSalt = pinSalt;
      }
      profile.guardianLock.enabled = nextEnabled;
      profile.guardianLock.updatedAt = now();
      if (nextEnabled !== previousValue.enabled) {
        appendRatingChangeHistory(store, { actorId, profileId, field: "guardianLock", previousValue, newValue: { enabled: nextEnabled }, reason: clean(input.reason, 240) || "guardian_lock_update" });
      }
    } else {
      throw new Error("A guardian PIN is required to change the guardian lock.");
    }
  }

  profile.updatedAt = now();
  await writeStore(store);
  return { favorites: profile.favorites, preferences: profile.preferences, profileType: profile.profileType, guardianLock: { enabled: profile.guardianLock.enabled } };
}

export async function startPhantomPlaySession(session: AccessSession, input: Record<string, unknown>, limits: { entitled?: boolean; dailyMinuteLimit?: number } = {}) {
  const tenantId = tenantIdFor(session, input.tenantId);
  const actorId = actorIdFor(session);
  const store = await readStore();
  const profile = ensureProfile(store, tenantId, actorId);
  if (limits.entitled === false) throw new Error("PhantomPlay is not included in this plan.");
  const dailyMinuteLimit = Math.max(0, Math.floor(limits.dailyMinuteLimit ?? (session.canManageAccess ? 1440 : 60)));
  if (todaySeconds(profile) >= dailyMinuteLimit * 60) throw new Error("Today's PhantomPlay time limit has been reached.");
  const gameId = clean(input.gameId, 180);
  const game = catalogFor(store, profile).find((item) => item.id === gameId);
  if (!game) throw new Error("This game is unavailable for this account or content setting.");
  const stamp = now();
  const play: PlaySession = { id: `play-${randomUUID()}`, gameId, startedAt: stamp, updatedAt: stamp, endedAt: null, seconds: 0, score: null, progress: 0, state: {} };
  profile.sessions.unshift(play);
  profile.sessions = profile.sessions.slice(0, 120);
  profile.updatedAt = stamp;
  await writeStore(store);
  return { play, game, remainingMinutesToday: dailyMinuteLimit - Math.ceil(todaySeconds(profile) / 60) };
}

export async function updatePhantomPlaySession(session: AccessSession, playId: string, input: Record<string, unknown>) {
  const tenantId = tenantIdFor(session, input.tenantId);
  const actorId = actorIdFor(session);
  const store = await readStore();
  const profile = ensureProfile(store, tenantId, actorId);
  const play = profile.sessions.find((item) => item.id === playId);
  if (!play) return null;
  play.seconds = Math.min(86400, play.seconds + Math.floor(clamp(input.secondsDelta, 0, 600)));
  if (input.score !== undefined) play.score = Math.max(play.score ?? 0, Math.floor(clamp(input.score, 0, 1_000_000_000)));
  if (input.progress !== undefined) play.progress = Math.floor(clamp(input.progress, 0, 100));
  if (input.state && typeof input.state === "object" && !Array.isArray(input.state)) {
    play.state = safePlayState(input.state);
  }
  if (input.ended === true) play.endedAt = now();
  play.updatedAt = now();
  profile.updatedAt = play.updatedAt;
  await writeStore(store);
  return play;
}

export async function createPhantomPlayRoom(session: AccessSession, input: Record<string, unknown>, limits: { entitled?: boolean } = {}) {
  if (limits.entitled === false) throw new Error("PhantomPlay private rooms are not included in this plan.");
  const tenantId = tenantIdFor(session, input.tenantId);
  const actorId = actorIdFor(session);
  const store = await readStore();
  const profile = ensureProfile(store, tenantId, actorId);
  const gameId = clean(input.gameId, 180);
  const game = catalogFor(store, profile).find((item) => item.id === gameId);
  if (!game) throw new Error("Choose an available PhantomPlay game for this room.");
  const mode: PhantomPlayRoomMode = input.mode === "friends" ? "friends" : "classroom";
  if (mode === "classroom" && game.contentRating !== "everyone") throw new Error("Classroom rooms can only use Everyone-rated games.");
  const maxLimit = mode === "classroom" ? 30 : 8;
  const requestedMax = Number(input.maxPlayers);
  const maxPlayers = Number.isFinite(requestedMax) ? Math.floor(clamp(requestedMax, 2, maxLimit)) : (mode === "classroom" ? 12 : 6);
  const timestamp = now();
  pruneRooms(store);
  const requestedHostControls = input.hostControls && typeof input.hostControls === "object" && !Array.isArray(input.hostControls)
    ? (input.hostControls as Record<string, unknown>)
    : {};
  const room: PhantomPlayRoom = {
    id: `pp-room-${randomUUID()}`,
    code: freshRoomCode(store, tenantId),
    tenantId,
    hostActorId: actorId,
    hostLabel: actorLabelFor(session),
    gameId: game.id,
    gameTitle: game.title,
    mode,
    status: "open",
    maxPlayers,
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: new Date(Date.now() + ROOM_TTL_MINUTES * 60_000).toISOString(),
    participants: [{ actorId, label: actorLabelFor(session), role: "host", status: "online", joinedAt: timestamp, lastSeenAt: timestamp }],
    matchState: null,
    readyStates: {},
    hostControls: {
      allowBotFill: requestedHostControls.allowBotFill === true,
      maxHumans: Number.isFinite(Number(requestedHostControls.maxHumans)) ? Math.floor(clamp(requestedHostControls.maxHumans, 1, maxPlayers)) : Math.min(ROOM_DEFAULT_MAX_HUMANS, maxPlayers),
    },
    botSlots: [],
    reconnectGraceSeconds: ROOM_RECONNECT_GRACE_SECONDS,
    safety: {
      transport: "workspace_relay",
      joinPolicy: "signed_in_same_tenant_code",
      publicDiscovery: false,
      directPeerConnection: false,
      inboundDevicePorts: false,
      chat: false,
      voice: false,
      externalGameNetworking: false,
      inviteTtlMinutes: ROOM_TTL_MINUTES,
      contentPolicy: mode === "classroom" ? "everyone_rating_required" : "profile_content_setting",
    },
  };
  store.rooms.unshift(room);
  await writeStore(store);
  return { room: roomView(room) };
}

export async function getPhantomPlayRoom(session: AccessSession, input: Record<string, unknown>) {
  const tenantId = tenantIdFor(session, input.tenantId);
  const room = findRoom(await readStore(), tenantId, input.code);
  if (!room) return null;
  const actorId = actorIdFor(session);
  if (!session.canManageAccess && !room.participants.some((participant) => participant.actorId === actorId)) return null;
  return roomView(room);
}

export async function joinPhantomPlayRoom(session: AccessSession, input: Record<string, unknown>, limits: { entitled?: boolean } = {}) {
  if (limits.entitled === false) throw new Error("PhantomPlay private rooms are not included in this plan.");
  const tenantId = tenantIdFor(session, input.tenantId);
  const actorId = actorIdFor(session);
  const store = await readStore();
  const room = findRoom(store, tenantId, input.code);
  if (!room) return null;
  const status = roomStatus(room);
  if (status === "expired") {
    room.status = "expired";
    await writeStore(store);
    throw new Error("This room code has expired.");
  }
  if (status !== "open") throw new Error("This private room is not open for joining.");
  const existing = room.participants.find((participant) => participant.actorId === actorId);
  if (!existing && activeParticipantCount(room) >= room.maxPlayers) throw new Error("This private room is full.");
  const timestamp = now();
  if (existing) {
    existing.status = "online";
    existing.lastSeenAt = timestamp;
    existing.label = actorLabelFor(session);
  } else {
    room.participants.push({ actorId, label: actorLabelFor(session), role: "player", status: "online", joinedAt: timestamp, lastSeenAt: timestamp });
  }
  room.updatedAt = timestamp;
  await writeStore(store);
  return { room: roomView(room) };
}

export async function leavePhantomPlayRoom(session: AccessSession, input: Record<string, unknown>) {
  const tenantId = tenantIdFor(session, input.tenantId);
  const actorId = actorIdFor(session);
  const store = await readStore();
  const room = findRoom(store, tenantId, input.code);
  if (!room) return null;
  const participant = room.participants.find((item) => item.actorId === actorId);
  if (!participant && !session.canManageAccess) return null;
  const timestamp = now();
  if (participant) {
    participant.status = "left";
    participant.lastSeenAt = timestamp;
  }
  if (room.hostActorId === actorId || (session.canManageAccess && input.end === true)) room.status = "locked";
  room.updatedAt = timestamp;
  await writeStore(store);
  return { room: roomView(room) };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// Throws if `value` isn't JSON-serializable or exceeds the size budget —
// callers should surface this as a 400, not silently truncate someone's
// authoritative match state.
function safeMatchStateValue(value: unknown): unknown {
  let serialized: string;
  try {
    serialized = JSON.stringify(value ?? null) ?? "null";
  } catch {
    throw new Error("matchState must be JSON-serializable.");
  }
  if (Buffer.byteLength(serialized, "utf8") > ROOM_MATCH_STATE_MAX_BYTES) {
    throw new Error(`matchState is too large (limit ${ROOM_MATCH_STATE_MAX_BYTES} bytes).`);
  }
  return JSON.parse(serialized);
}

function safeBotSlotsInput(value: unknown): PhantomPlayRoomBotSlot[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => isPlainObject(item))
    .map((item) => ({ slotId: clean(item.slotId, 60), difficulty: clean(item.difficulty, 40) }))
    .filter((item) => item.slotId)
    .slice(0, ROOM_MAX_BOT_SLOTS);
}

// Host-authoritative write of a room's generic match-state envelope, plus
// (optionally, in the same call) hostControls/botSlots. "Host-authoritative"
// is a deliberate safety choice: the platform never trusts a non-host
// participant's browser with an authoritative match result, so only the
// current room host (or a workspace/platform admin, matching every other
// admin-override precedent in this module) may call this.
export async function updatePhantomPlayRoomMatchState(session: AccessSession, input: Record<string, unknown>) {
  const tenantId = tenantIdFor(session, input.tenantId);
  const actorId = actorIdFor(session);
  const store = await readStore();
  const room = findRoom(store, tenantId, input.code);
  if (!room) return null;
  const status = roomStatus(room);
  if (status === "ended" || status === "expired") throw new Error("This room is no longer active.");
  if (room.hostActorId !== actorId && !session.canManageAccess) {
    throw new Error("Only the current room host can update match state.");
  }

  if (Object.prototype.hasOwnProperty.call(input, "matchState")) {
    const incoming = safeMatchStateValue(input.matchState);
    const mode = input.mode === "replace" ? "replace" : "merge";
    room.matchState = mode === "merge" && isPlainObject(room.matchState) && isPlainObject(incoming)
      ? { ...room.matchState, ...incoming }
      : incoming;
  }

  if (Object.prototype.hasOwnProperty.call(input, "hostControls") && isPlainObject(input.hostControls)) {
    const requested = input.hostControls as Record<string, unknown>;
    if (typeof requested.allowBotFill === "boolean") room.hostControls.allowBotFill = requested.allowBotFill;
    if (requested.maxHumans !== undefined && Number.isFinite(Number(requested.maxHumans))) {
      room.hostControls.maxHumans = Math.floor(clamp(requested.maxHumans, 1, room.maxPlayers));
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, "botSlots")) {
    room.botSlots = safeBotSlotsInput(input.botSlots);
  }

  room.updatedAt = now();
  await writeStore(store);
  return { room: roomView(room) };
}

// A participant's self-service ready toggle. Any real participant record
// (host or player, regardless of "online"/"left" — matching the reconnect
// window) may flip their own entry; nobody may set another actor's.
export async function setPhantomPlayRoomReady(session: AccessSession, input: Record<string, unknown>) {
  const tenantId = tenantIdFor(session, input.tenantId);
  const actorId = actorIdFor(session);
  const store = await readStore();
  const room = findRoom(store, tenantId, input.code);
  if (!room) return null;
  const status = roomStatus(room);
  if (status === "ended" || status === "expired") throw new Error("This room is no longer active.");
  const participant = room.participants.find((item) => item.actorId === actorId);
  if (!participant) throw new Error("You are not a participant in this room.");
  room.readyStates[actorId] = input.ready === true;
  // This is the only self-service, low-frequency, already-mutating room call
  // a participant makes on a regular cadence, so the client also uses it as
  // a liveness "touch" (re-sending its current ready value unchanged) to
  // keep lastSeenAt fresh for connection-status display — bumping it here
  // avoids adding a second write-triggering route just for a heartbeat.
  participant.lastSeenAt = now();
  room.updatedAt = now();
  await writeStore(store);
  return { room: roomView(room) };
}

function submissionInput(input: Record<string, unknown>) {
  const screenshots = Array.isArray(input.screenshots) ? input.screenshots.map(safeScreenshot).filter(Boolean).slice(0, 6) : [];
  const tags = Array.isArray(input.tags) ? input.tags.map((tag) => clean(tag, 32)).filter(Boolean).slice(0, 12) : [];
  return {
    title: clean(input.title, 90),
    summary: clean(input.summary, 180),
    description: clean(input.description, 3000),
    category: clean(input.category, 60) || "Other",
    contentRating: safeRating(input.contentRating),
    launchUrl: safeUrl(input.launchUrl),
    screenshots,
    tags,
    controls: clean(input.controls, 240),
    dataHandling: clean(input.dataHandling, 600),
    version: safeVersion(input.version),
  };
}

function submissionValidation(input: ReturnType<typeof submissionInput>) {
  const issues: string[] = [];
  if (input.title.length < 2) issues.push("Add a game title.");
  if (input.summary.length < 20) issues.push("Add a clear one-line summary.");
  if (input.description.length < 80) issues.push("Describe the game, audience, and play loop.");
  if (!input.launchUrl) issues.push("Add an HTTPS or approved PhantomPlay launch URL.");
  if (!input.screenshots.length) issues.push("Add at least one screenshot.");
  if (!input.controls) issues.push("Explain the controls.");
  if (!input.dataHandling) issues.push("Explain what player data the game reads or stores.");
  return issues;
}

export async function createPhantomPlaySubmission(session: AccessSession, input: Record<string, unknown>) {
  const tenantId = tenantIdFor(session, input.tenantId);
  const actorId = actorIdFor(session);
  const data = submissionInput(input);
  const submit = input.submit === true;
  const issues = submissionValidation(data);
  if (submit && issues.length) throw new Error(issues.join(" "));
  const store = await readStore();
  const timestamp = now();
  const submission: PhantomPlaySubmission = {
    id: `game-sub-${randomUUID()}`,
    tenantId,
    developerId: actorId,
    developerName: clean(input.developerName || session.label, 90) || "Developer",
    ...data,
    status: submit ? "submitted" : "draft",
    featured: false,
    moderationNote: "",
    versions: [{ version: data.version, submittedAt: timestamp, notes: clean(input.releaseNotes, 600) }],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  store.submissions.unshift(submission);
  await writeStore(store);
  return { submission, issues };
}

export async function updatePhantomPlaySubmission(session: AccessSession, submissionId: string, input: Record<string, unknown>) {
  const actorId = actorIdFor(session);
  const store = await readStore();
  const submission = store.submissions.find((item) => item.id === submissionId);
  if (!submission || (!session.canManageAccess && submission.developerId !== actorId)) return null;
  if (["approved", "disabled"].includes(submission.status) && !session.canManageAccess) throw new Error("Approved games require a new update review.");
  const data = submissionInput({ ...submission, ...input });
  const submit = input.submit === true;
  const issues = submissionValidation(data);
  if (submit && issues.length) throw new Error(issues.join(" "));
  Object.assign(submission, data, { status: submit ? "submitted" : "draft", updatedAt: now(), moderationNote: "" });
  if (!submission.versions.some((item) => item.version === data.version)) submission.versions.unshift({ version: data.version, submittedAt: now(), notes: clean(input.releaseNotes, 600) });
  await writeStore(store);
  return { submission, issues };
}

export async function moderatePhantomPlaySubmission(session: AccessSession, submissionId: string, input: Record<string, unknown>) {
  if (!session.canManageAccess && session.isSuperAdmin !== true) throw new Error("Platform moderation access is required.");
  const decision = clean(input.decision, 40);
  if (!["approved", "rejected", "changes_requested", "disabled"].includes(decision)) throw new Error("Choose approve, reject, request changes, or disable.");
  const store = await readStore();
  const submission = store.submissions.find((item) => item.id === submissionId);
  if (!submission) return null;
  const issues = submissionValidation(submissionInput(submission as unknown as Record<string, unknown>));
  if (decision === "approved" && issues.length) throw new Error(`Cannot approve: ${issues.join(" ")}`);
  submission.status = decision as PhantomPlaySubmissionStatus;
  submission.featured = decision === "approved" && input.featured === true;
  submission.moderationNote = clean(input.note, 1000);
  submission.updatedAt = now();
  await writeStore(store);
  return submission;
}

// Admin/guardian rating-override endpoint's service function. Gated at the
// route layer with the same requireAdminAccessSession precedent used by
// moderatePhantomPlaySubmission above — this function assumes the caller
// already checked platform/workspace admin authority.
//
// target "game": overrides a catalog game's contentRating/contentDescriptors
// (built-in or community) via store.gameOverrides — never mutates
// PHANTOMPLAY_BUILT_IN_GAMES/PHANTOMPLAY_V2_GAMES in place.
//
// target "profile": a guardian/admin action on another actor's profile —
// sets allowedRatings ("Game Rating Exposure"), profileType, and/or the
// guardian-lock enabled flag, bypassing the PIN gate that applies to the
// profile's own self-service updatePhantomPlayProfile calls.
//
// Every effective change is appended to ratingChangeHistory.
export async function applyPhantomPlayRatingOverride(session: AccessSession, input: Record<string, unknown>) {
  const actorId = actorIdFor(session);
  const target = clean(input.target, 20);
  const reason = clean(input.reason, 240) || "admin_rating_override";
  const store = await readStore();

  if (target === "game") {
    const gameId = clean(input.gameId, 180);
    if (!gameId) throw new Error("A gameId is required.");
    const known = [...PHANTOMPLAY_BUILT_IN_GAMES, ...communityGames(store)].find((game) => game.id === gameId);
    if (!known) throw new Error("That game is not in the catalog.");
    const current = applyGameOverride(store, known);
    const nextOverride: PhantomPlayGameOverride = { ...(store.gameOverrides[gameId] || {}), updatedAt: now() };
    if (input.contentRating !== undefined) {
      const newValue = safeRating(input.contentRating);
      if (newValue !== current.contentRating) {
        appendRatingChangeHistory(store, { actorId, gameId, field: "contentRating", previousValue: current.contentRating, newValue, reason });
      }
      nextOverride.contentRating = newValue;
    }
    if (input.contentDescriptors !== undefined) {
      const newValue = (Array.isArray(input.contentDescriptors) ? input.contentDescriptors.map((item) => clean(item, 60)).filter(Boolean).slice(0, 20) : []) as PhantomPlayContentDescriptor[];
      if (JSON.stringify(newValue) !== JSON.stringify(current.contentDescriptors || [])) {
        appendRatingChangeHistory(store, { actorId, gameId, field: "contentDescriptors", previousValue: current.contentDescriptors || [], newValue, reason });
      }
      nextOverride.contentDescriptors = newValue;
    }
    store.gameOverrides[gameId] = nextOverride;
    await writeStore(store);
    return { gameId, override: nextOverride };
  }

  if (target === "profile") {
    const targetTenantId = tenantIdFor(session, input.tenantId);
    const targetActorId = clean(input.actorId, 120);
    if (!targetActorId) throw new Error("An actorId is required.");
    const profile = ensureProfile(store, targetTenantId, targetActorId);
    const profileId = profileKey(targetTenantId, targetActorId);
    if (input.allowedRatings !== undefined) {
      const previousValue = profile.preferences.allowedRatings;
      const newValue = safeAllowedRatings(input.allowedRatings, previousValue);
      if (JSON.stringify([...newValue].sort()) !== JSON.stringify([...previousValue].sort())) {
        profile.preferences.allowedRatings = newValue;
        appendRatingChangeHistory(store, { actorId, profileId, field: "allowedRatings", previousValue, newValue, reason });
      }
    }
    if (input.profileType !== undefined) {
      const previousValue = profile.profileType;
      const newValue = safeProfileType(input.profileType);
      if (newValue !== previousValue) {
        profile.profileType = newValue;
        appendRatingChangeHistory(store, { actorId, profileId, field: "profileType", previousValue, newValue, reason });
      }
    }
    if (input.guardianLockEnabled !== undefined) {
      const previousValue = { enabled: profile.guardianLock.enabled };
      const nextEnabled = input.guardianLockEnabled === true;
      if (nextEnabled !== previousValue.enabled) {
        appendRatingChangeHistory(store, { actorId, profileId, field: "guardianLock", previousValue, newValue: { enabled: nextEnabled }, reason });
      }
      profile.guardianLock.enabled = nextEnabled;
      profile.guardianLock.updatedAt = now();
    }
    profile.updatedAt = now();
    await writeStore(store);
    return { profileId, preferences: profile.preferences, profileType: profile.profileType, guardianLock: { enabled: profile.guardianLock.enabled } };
  }

  throw new Error('target must be "game" or "profile".');
}

export async function getPhantomPlayRatingChangeHistory(limit = 200) {
  const store = await readStore();
  return store.ratingChangeHistory.slice(0, Math.max(0, Math.min(2000, limit)));
}

export async function getPhantomPlayStoreStatus() {
  const store = await readStore();
  return {
    provider: "local_json",
    pathConfigured: Boolean(process.env.PHANTOMFORCE_PHANTOMPLAY_PATH),
    profiles: Object.keys(store.profiles).length,
    rooms: store.rooms.filter((room) => ["open", "locked"].includes(roomStatus(room))).length,
    submissions: store.submissions.length,
    approvedCommunityGames: communityGames(store).length,
    ratingChangeHistoryEntries: store.ratingChangeHistory.length,
    gameOverrides: Object.keys(store.gameOverrides).length,
  };
}
