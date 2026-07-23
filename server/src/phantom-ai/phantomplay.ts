import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
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
  installProfile?: "webapp" | "desktop_player" | "developer_full";
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

const PHANTOMPLAY_ART_VERSION = "phantomplay-art-20260721";
export const PHANTOMPLAY_ENGINE = {
  version: "2.2-ascension",
  saveStateBytes: 262_144,
  largeMap: { chunkSize: 1024, maxLoadedChunks: 64, streaming: true },
  screenFlow: ["title", "loadout", "match", "results"],
  localMultiplayer: { supported: true, maxPlayers: 6, splitScreen: true },
  updateChannel: { kind: "web_build", checkSeconds: 60, reinstallRequired: false },
  runtimeProfiles: {
    webapp: {
      targetUser: "standard_user",
      installRequired: false,
      supportsLargeAssets: false,
      privacyMode: "browser_session",
      notes: "Default lightweight PhantomPlay web runtime for small games and normal app use.",
    },
    desktop_player: {
      targetUser: "privacy_or_game_user",
      installRequired: true,
      supportsLargeAssets: true,
      maxAssetPackGb: 50,
      privacyMode: "local_cache",
      notes: "Downloadable app lane for users who want local game assets and more private local play.",
    },
    developer_full: {
      targetUser: "developer",
      installRequired: true,
      supportsLargeAssets: true,
      maxAssetPackGb: 250,
      privacyMode: "local_workspace",
      includes: ["PhantomPlay SDK", "large-asset pack manifest", "local preview runner", "developer submission checks"],
      notes: "Full creator/dev install. Games and engine tooling live on the user's machine, not Jordan's cloud.",
    },
  },
  distributedRuntime: {
    status: "foundation_active",
    userOwnedCompute: true,
    cloudStreamingFromJordan: false,
    directPeerConnectionDefault: false,
    inboundDevicePortsDefault: false,
    model: "signed control-plane manifests plus opt-in user-owned asset-cache edge nodes",
    safety: [
      "No hidden P2P.",
      "No user machine becomes a server without explicit install-time consent.",
      "No cloud streaming games from Jordan's hardware.",
      "Large game assets are installed or cached on the user's device/profile.",
      "Only hash-verified game chunks are assigned; arbitrary remote code is never accepted.",
    ],
  },
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
  "rift-frenzy": artUrl("rift-frenzy-cover.svg"),
  "serpent-surge": artUrl("serpent-surge-cover.svg"),
  "crown-circuit": artUrl("crown-circuit-cover.svg"),
  "kingdom-breakers": artUrl("kingdom-breakers-cover.svg"),
  "phantom-ages": artUrl("phantom-ages-cover.svg"),
  "tidefront-tactics": artUrl("tidefront-tactics-cover.svg"),
  "skyguard-arena": artUrl("skyguard-arena-cover.svg"),
  "im-baked": artUrl("im-baked-cover.svg"),
  "phantom-strike": artUrl("phantom-strike-cover.svg"),
  "cubetown": artUrl("cubetown-cover.svg"),
  "keyboardist-on-tour": artUrl("keyboardist-on-tour-cover.svg"),
  "phantom-grand-prix": artUrl("phantom-grand-prix-cover.svg"),
  "beat-strike": artUrl("beat-strike-cover.svg"),
  "phantom-dash": artUrl("phantom-dash-cover.svg"),
  "color-rush": artUrl("color-rush-cover.svg"),
  "circuit-serpent": artUrl("circuit-serpent-cover.svg"),
  "neon-breaker": artUrl("neon-breaker-cover.svg"),
  "phantom-rumble": artUrl("phantom-rumble-cover.svg"),
  "vespergate": artUrl("vespergate-cover.svg"),
  "court-vision": artUrl("court-vision-cover.svg"),
  "phantom-pizzeria": artUrl("phantom-pizzeria-cover.svg"),
  "tower-tactics": artUrl("tower-tactics-cover.svg"),
  "tile-flow": artUrl("tile-flow-cover.svg"),
  "echo-sequence": artUrl("echo-sequence-cover.svg"),
  "signal-sweeper": artUrl("signal-sweeper-cover.svg"),
  "logic-lights": artUrl("logic-lights-cover.svg"),
  "sudoku-signal": artUrl("sudoku-signal-cover.svg"),
  "pixel-bloom": artUrl("pixel-bloom-cover.svg"),
  "type-storm": artUrl("type-storm-cover.svg"),
  "breath-pacer": artUrl("breath-pacer-cover.svg"),
  "phantom-cube": artUrl("phantom-cube-cover.svg"),
  "phantom-chess": artUrl("phantom-chess-cover.svg"),
};
const CATEGORY_ART: Record<string, string> = {
  Kids: GAME_ART_BY_SLUG["signal-match"],
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
  field: "contentRating" | "contentDescriptors" | "allowedRatings" | "guardianLock" | "profileType" | "devModeEnabled";
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
  // Per-game Dev Sandbox switch an admin sets explicitly (see
  // phantomPlayDevModeAccessFromStore). Undefined means "not yet decided" and
  // is treated as enabled, so every pre-existing built-in game keeps working
  // for managers exactly as before this field existed — this is an opt-out
  // lever, not an opt-in gate, to stay backward compatible.
  devModeEnabled?: boolean;
  // The workspace's own saved Dev Sandbox edit for this game. Persisted so a
  // manager's in-player live edits survive a refresh/restart, but only ever
  // read back for someone who already has Dev Mode access to this exact game
  // (see getPhantomPlayDevModeOverride) — never shown to a regular player,
  // who always gets the real shipped file via the game's normal launchUrl.
  devSourceOverride?: string;
  devSourceOverrideUpdatedAt?: string;
  updatedAt: string;
};

// Audit trail for the owner-only "Publish to live" action — never stores the
// full source (that's the real game file on disk, which is the audit trail
// for content); just who published what game and when, for accountability.
export type PhantomPlayDevModePublishRecord = {
  ts: string;
  actorId: string;
  gameId: string;
  bytes: number;
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
  devModePublishHistory: PhantomPlayDevModePublishRecord[];
};

const TAK_CREATOR = "Tak";
export const PHANTOMPLAY_KIDS_ONLY_GAME_IDS = new Set([
  "signal-match", "focus-stack", "reflex-grid", "penalty-kick", "rift-frenzy", "serpent-surge",
  "color-rush", "tile-flow", "tower-tactics", "breath-pacer", "court-vision", "pixel-bloom",
  "circuit-serpent", "echo-sequence", "signal-sweeper", "neon-breaker", "type-storm", "logic-lights",
  "sudoku-signal",
]);

export function isKidsLaneGame(game: PhantomPlayGame): boolean {
  return PHANTOMPLAY_KIDS_ONLY_GAME_IDS.has(game.id) || game.category.toLowerCase() === "kids";
}

export function kidsLaneGame(game: PhantomPlayGame): PhantomPlayGame {
  const kidsOnly = isKidsLaneGame(game);
  if (!kidsOnly) return game;
  const tags = Array.from(new Set(["kids", ...(game.tags || [])]));
  return { ...game, category: "Kids", tags, featured: false };
}

export const PHANTOMPLAY_BUILT_IN_GAMES: PhantomPlayGame[] = [
  {
    id: "neon-drift",
    title: "Neon Drift",
    summary: "Auto-fire spaceship shooter with waves, powerups, and shield saves.",
    description: "A real arcade shooter: move with WASD/arrow keys or touch-drag, fire nonstop, collect rapid fire, spread shot, shield, magnet, and repair powerups, then push deeper into harder waves.",
    category: "Arcade",
    tags: ["shooter", "powerups", "arcade", "touch"],
    contentRating: "everyone",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/neon-drift.html?v=1.2.3",
    thumbnail: GAME_ART_BY_SLUG["neon-drift"],
    featured: true,
    version: "1.2.3",
    controls: "WASD/arrow keys to fly. Auto-fire is always on. Touch and drag on mobile.",
    progressSupport: true,
    scoreSupport: true,
    engine: { tier: "arcade-large-map", minVersion: PHANTOMPLAY_ENGINE.version },
  },
  {
    id: "phantom-ages",
    title: "Phantom Ages",
    summary: "Age-of-War lane battle: bank gold, deploy real soldiers & archers, upgrade an auto-firing tower, advance five eras.",
    description: "A real Age-of-War lane battle with detailed troops — helmeted soldiers, hooded archers, gunners, mechs and fliers push down the lane while your upgradeable stone tower auto-fires. Earn gold from your units and spend it across three upgrade tracks (Cannon power/rate/range/multi-shot, Economy, and Fortress), advance through Stone, Bronze, Iron, Industrial and Future eras, and choose a Military or Tech path at the Industrial threshold that reshapes every era after it. Fixed-timestep sim with pooled units/projectiles, DPR-aware rendering that plays cleanly on phones.",
    category: "Strategy",
    tags: ["strategy", "tug-of-war", "eras", "base-defense", "singleplayer"],
    contentRating: "everyone10",
    contentDescriptors: ["cartoon_action", "competitive_play", "strategic_complexity"],
    developer: TAK_CREATOR,
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/phantom-ages/index.html?v=2.1.2",
    thumbnail: GAME_ART_BY_SLUG["phantom-ages"],
    featured: true,
    version: "2.1.2",
    controls: "Tap units to deploy. Buy Cannon/Economy/Fortress upgrades. Space = Overcharge volley. Advance eras for stronger units. Mobile-ready.",
    progressSupport: true,
    scoreSupport: true,
    engine: { tier: "strategy-lane", minVersion: PHANTOMPLAY_ENGINE.version },
  },
  {
    id: "signal-match",
    title: "Signal Match",
    summary: "Watch a one-by-one signal sequence, then match the pairs from memory.",
    description: "A calm memory game with sequential symbol flashes, short rounds, match burst feedback, a visible score, keyboard support, and saved best scores.",
    category: "Puzzle",
    tags: ["memory", "flash", "puzzle", "touch"],
    contentRating: "toddler",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/signal-match.html?v=1.2.0",
    thumbnail: GAME_ART_BY_SLUG["signal-match"],
    featured: false,
    version: "1.2.0",
    controls: "Click, tap, or use Tab + Enter",
    progressSupport: true,
    scoreSupport: true,
  },
  {
    id: "phantom-dash",
    title: "Phantom Dash",
    summary: "Jump, double-jump, and flip gravity through a neon obstacle gauntlet.",
    description: "A Geometry Dash-style one-button runner with rising speed, gravity gates, neon hazards, score, levels, and quick restarts.",
    category: "Arcade",
    tags: ["runner", "jump", "geometry", "arcade", "touch"],
    contentRating: "everyone",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/phantom-dash.html?v=1.1.0",
    thumbnail: GAME_ART_BY_SLUG["phantom-dash"],
    featured: true,
    version: "1.1.0",
    controls: "Space, ↑, click, or tap to jump. Double-jump, gravity flips, orbs, and combo flow are enabled.",
    progressSupport: true,
    scoreSupport: true,
  },
  {
    id: "focus-stack",
    title: "Focus Stack",
    summary: "Drop perfect layers with landing guides, sliced shards, flow bursts, and tower shockwaves.",
    description: "A timing game designed for quick intentional breaks, with landing guides, falling cutoff shards, perfect-drop shockwaves, visible score, resumable progress, and a local best score.",
    category: "Focus",
    tags: ["timing", "focus", "quick", "touch"],
    contentRating: "everyone",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/focus-stack.html?v=1.3.0",
    thumbnail: GAME_ART_BY_SLUG["focus-stack"],
    featured: false,
    version: "1.3.0",
    controls: "Space, Enter, click, or tap",
    progressSupport: true,
    scoreSupport: true,
  },
  {
    id: "word-weld",
    title: "Word Weld",
    summary: "Weld words from shifting racks with combo sparks and time bonuses.",
    description: "A quicker, juicier word-building game with keyboard/touch input, combo scoring, forged-word bursts, timer bonuses, and clean reset controls.",
    category: "Creative",
    tags: ["word", "creative", "quick", "touch"],
    contentRating: "everyone",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/word-weld.html?v=1.1.0",
    thumbnail: GAME_ART_BY_SLUG["word-weld"],
    featured: true,
    version: "1.1.0",
    controls: "Keyboard, tap letters, Enter to submit",
    progressSupport: true,
    scoreSupport: true,
  },
  {
    id: "reflex-grid",
    title: "Reflex Grid",
    summary: "Hit live cells, chase bonus targets, and keep the combo alive before the grid burns out.",
    description: "A sharper aim-and-reaction grid with combo scoring, bonus targets, hit sparks, miss shock feedback, a visible timeout bar, audio cues, mistakes, and a real finish.",
    category: "Strategy",
    tags: ["reaction", "strategy", "touch", "aim"],
    contentRating: "toddler",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/reflex-grid.html?v=1.3.0",
    thumbnail: GAME_ART_BY_SLUG["reflex-grid"],
    featured: false,
    version: "1.3.0",
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
    contentRating: "toddler",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/penalty-kick.html?v=1.1.0",
    thumbnail: GAME_ART_BY_SLUG["penalty-kick"],
    featured: false,
    version: "1.1.0",
    controls: "Choose one of five lanes, read the keeper, then shoot in the sweet spot.",
    progressSupport: true,
    scoreSupport: true,
  },
  {
    id: "rift-frenzy",
    title: "Rift Frenzy",
    summary: "Carry a valuable fish school, steal from rivals, then absorb at the perfect moment to become enormous.",
    description: "A school-to-grow ocean survival arena: collect smaller neutral fish into a visible school, protect it from rival steals, dash through exposed schools, absorb the school on a 10-second cooldown, grow permanently, survive predators and hazards, and eliminate every rival until one fish remains.",
    category: "Arcade",
    tags: ["fish", "arena", "growth", "io", "multiplayer", "school"],
    contentRating: "everyone10",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/rift-frenzy.html?v=2.0.0",
    thumbnail: GAME_ART_BY_SLUG["rift-frenzy"],
    featured: true,
    version: "2.0.0",
    controls: "P1 WASD, Shift dash, Space absorb. P2 arrows, / dash, Enter absorb. P3 IJKL, O dash, U absorb. P4 TFGH, Y dash, R absorb.",
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
    launchUrl: "/app/games/serpent-surge.html?v=1.1.0",
    thumbnail: GAME_ART_BY_SLUG["serpent-surge"],
    featured: true,
    version: "1.1.0",
    controls: "Steer with mouse, touch, WASD, or arrows. Hold Space or touch pressure to boost.",
    progressSupport: true,
    scoreSupport: true,
    engine: { tier: "arena-large-map", minVersion: PHANTOMPLAY_ENGINE.version },
  },
  {
    id: "color-rush",
    title: "Color Rush",
    summary: "Catch target colors through lane sweeps, rush chains, particle bursts, and combo pressure.",
    description: "Four falling columns with glowing target lanes, lane sweep feedback, target-change surges, catch/miss particle bursts, combo scoring, faster target swaps, audio feedback, and three-life pressure.",
    category: "Arcade",
    tags: ["reaction", "color", "keyboard", "touch"],
    contentRating: "toddler",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/color-rush.html?v=1.2.0",
    thumbnail: GAME_ART_BY_SLUG["color-rush"],
    featured: false,
    version: "1.2.0",
    controls: "A/S/D/F or tap a column",
    progressSupport: true,
    scoreSupport: true,
  },
  {
    id: "tile-flow",
    title: "Tile Flow",
    summary: "Rotate charged pipes through animated current paths, pulsing nodes, and eight energized boards.",
    description: "A tactile pipe-rotation puzzle with animated current flow, pulsing node endpoints, twist feedback, board-wide solve surges, glow trails, and escalating boards. Turn each tile until the current reaches the exit.",
    category: "Puzzle",
    tags: ["logic", "calm", "keyboard", "touch"],
    contentRating: "everyone",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/tile-flow.html?v=1.2.0",
    thumbnail: GAME_ART_BY_SLUG["tile-flow"],
    featured: false,
    version: "1.2.0",
    controls: "Click/tap to rotate, arrows to move",
    progressSupport: true,
    scoreSupport: true,
  },
  {
    id: "tower-tactics",
    title: "Tower Tactics",
    summary: "Slide, merge, and chain combo towers toward 2048.",
    description: "A sharper 4x4 merge puzzle with combo scoring, impact feedback, and glowing high-value towers. Plan your slides — the board fills fast when you stop thinking ahead.",
    category: "Strategy",
    tags: ["merge", "strategy", "keyboard", "touch"],
    contentRating: "everyone",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/tower-tactics.html?v=1.1.0",
    thumbnail: GAME_ART_BY_SLUG["tower-tactics"],
    featured: false,
    version: "1.1.0",
    controls: "Arrow keys or swipe",
    progressSupport: true,
    scoreSupport: true,
  },
  {
    id: "breath-pacer",
    title: "Breath Pacer",
    summary: "Box-breathe with phase waves, flow streaks, soft audio, and calming neon motion.",
    description: "An immersive breathing companion with expanding light, animated phase waves, phase-change cues, timing accuracy, flow streaks, subtle synthesized tones, and a two-minute completion ritual.",
    category: "Focus",
    tags: ["calm", "breathing", "wellness", "touch"],
    contentRating: "everyone",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/breath-pacer.html?v=1.2.0",
    thumbnail: GAME_ART_BY_SLUG["breath-pacer"],
    featured: false,
    version: "1.2.0",
    controls: "Tap or press Space on each phase",
    progressSupport: true,
    scoreSupport: true,
  },
  {
    id: "court-vision",
    title: "Court Vision",
    summary: "Sink neon free throws with ball trails, rim flashes, streak heat, and miss pressure.",
    description: "A physics free-throw shooter with growing distance, streak scoring, level scaling, ball trails, rim flash feedback, arena lights, synthesized court sounds, and three-miss pressure.",
    category: "Sports",
    tags: ["sports", "physics", "timing", "touch"],
    contentRating: "everyone",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/court-vision.html?v=1.2.0",
    thumbnail: GAME_ART_BY_SLUG["court-vision"],
    featured: false,
    version: "1.2.0",
    controls: "Tap or press Space to shoot",
    progressSupport: true,
    scoreSupport: true,
  },
  {
    id: "pixel-bloom",
    title: "Pixel Bloom",
    summary: "Grow a neon mandala through linked petals, combo ripples, particle bursts, and unlockable seasons.",
    description: "A calm creative puzzle-toy with mirrored blooms, petal particle bursts, visual ripples, combo scoring, seasonal palette surges, keyboard/touch control, and a stronger completion state.",
    category: "Creative",
    tags: ["calm", "creative", "relax", "touch"],
    contentRating: "everyone",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/pixel-bloom.html?v=1.2.0",
    thumbnail: GAME_ART_BY_SLUG["pixel-bloom"],
    featured: false,
    version: "1.2.0",
    controls: "Tap cells or arrows + Space",
    progressSupport: true,
    scoreSupport: true,
  },
  {
    id: "circuit-serpent",
    title: "Circuit Serpent",
    summary: "Grow the serpent with packet bursts, visible levels, and rising speed.",
    description: "Classic snake on a 17x17 circuit board upgraded with packet particle bursts, visible level progression, speed jumps every five packets, and one-crash arcade pressure.",
    category: "Arcade",
    tags: ["snake", "classic", "reaction", "touch"],
    contentRating: "everyone",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/circuit-serpent.html?v=1.1.0",
    thumbnail: GAME_ART_BY_SLUG["circuit-serpent"],
    featured: false,
    version: "1.1.0",
    controls: "Arrows/WASD, swipe, or tap screen edges",
    progressSupport: true,
    scoreSupport: true,
  },
  {
    id: "echo-sequence",
    title: "Echo Sequence",
    summary: "Echo growing neon patterns with streaks, pulsing rings, pad sparks, and sharper feedback.",
    description: "A memory-sequence classic upgraded with four glowing pads, original tones, streak scoring, perfect-round callouts, expanding echo rings, pad sparks, and stronger hit/miss feedback.",
    category: "Focus",
    tags: ["memory", "sequence", "sound", "touch"],
    contentRating: "everyone",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/echo-sequence.html?v=1.2.0",
    thumbnail: GAME_ART_BY_SLUG["echo-sequence"],
    featured: true,
    version: "1.2.0",
    controls: "Tap pads or press 1-4",
    progressSupport: true,
    scoreSupport: true,
  },
  {
    id: "signal-sweeper",
    title: "Signal Sweeper",
    summary: "Sweep a live signal grid with reveal-chain sparks, flags, and clock pressure.",
    description: "Minesweeper with a guaranteed-safe first reveal, animated chain bursts, grid pulse feedback, flag mode, long-press flagging, reveal-chain scoring, best-chain results, and a race-the-clock score.",
    category: "Strategy",
    tags: ["logic", "classic", "mines", "touch"],
    contentRating: "everyone",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/signal-sweeper.html?v=1.2.0",
    thumbnail: GAME_ART_BY_SLUG["signal-sweeper"],
    featured: false,
    version: "1.2.0",
    controls: "Tap to reveal, long-press or F to flag",
    progressSupport: true,
    scoreSupport: true,
  },
  {
    id: "neon-breaker",
    title: "Neon Breaker",
    summary: "Break glowing bricks with combo chains, powerups, trails, and clean arcade physics.",
    description: "Breakout with real deflection physics, combo chains, ball trails, wide/slow powerups, six brick tiers, and levels that speed up as they clear.",
    category: "Arcade",
    tags: ["classic", "paddle", "levels", "touch"],
    contentRating: "everyone",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/neon-breaker.html?v=1.1.0",
    thumbnail: GAME_ART_BY_SLUG["neon-breaker"],
    featured: true,
    version: "1.1.0",
    controls: "Drag or Arrow keys, Space to launch",
    progressSupport: true,
    scoreSupport: true,
  },
  {
    id: "type-storm",
    title: "Type Storm",
    summary: "Type falling words through rising storm levels and combo bursts.",
    description: "A typing sprint with 200 words, combo streaks, visible level progression, destruction particles, and a pace that keeps climbing. Three shields, no mercy.",
    category: "Focus",
    tags: ["typing", "speed", "keyboard", "words"],
    contentRating: "everyone",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/type-storm.html?v=1.1.0",
    thumbnail: GAME_ART_BY_SLUG["type-storm"],
    featured: false,
    version: "1.1.0",
    controls: "Just type — tap first on mobile",
    progressSupport: true,
    scoreSupport: true,
  },
  {
    id: "logic-lights",
    title: "Logic Lights",
    summary: "Clear energized Lights Out boards with flip sparks, board surges, par streaks, and score pressure.",
    description: "Ten guaranteed-solvable Lights Out levels with par scoring, streak bonuses for clean solves, animated flip sparks, level-clear board surges, audio feedback, and keyboard/touch controls.",
    category: "Puzzle",
    tags: ["logic", "lights-out", "calm", "touch"],
    contentRating: "everyone",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/logic-lights.html?v=1.2.0",
    thumbnail: GAME_ART_BY_SLUG["logic-lights"],
    featured: false,
    version: "1.2.0",
    controls: "Tap cells or arrows + Enter",
    progressSupport: true,
    scoreSupport: true,
  },
  {
    id: "phantom-cube",
    title: "PhantomCube",
    summary: "Slide the cube across crumbling isometric tiles, clear the board, then reach the glowing exit.",
    description: "An original B-Cubed-style puzzle: 12 hand-designed levels, every one solver-proven beatable with a true minimum move count shown as par. Mechanics ramp from plain crumbling tiles to double-pass tiles, teleporter pairs, and combined finales. Numbered level-select grid with beat-one-to-unlock-the-next progression saved locally.",
    category: "Puzzle",
    tags: ["puzzle", "isometric", "tile-clearing", "levels"],
    contentRating: "everyone",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/phantom-cube/index.html?v=1.0.0",
    thumbnail: GAME_ART_BY_SLUG["phantom-cube"],
    featured: true,
    version: "1.0.0",
    controls: "Arrows or WASD to slide, R to restart, L for level select",
    progressSupport: true,
    scoreSupport: true,
  },
  {
    id: "phantom-chess",
    title: "Phantom Chess",
    summary: "Full-rules chess — local 2-player or against the Phantom AI.",
    description: "Complete chess with castling (including through-check rules), en passant, all four promotions, and check/checkmate/stalemate detection. The move generator passes the standard published perft node counts on four reference positions. The AI opponent is negamax with alpha-beta pruning at depth 3.",
    category: "Strategy",
    tags: ["chess", "board game", "ai", "local multiplayer"],
    contentRating: "everyone",
    multiplayerDescriptor: "Local 2-player, same device — no networking",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/phantom-chess/index.html?v=1.0.0",
    thumbnail: GAME_ART_BY_SLUG["phantom-chess"],
    featured: true,
    version: "1.0.0",
    controls: "Click or tap a piece, then a highlighted square",
    progressSupport: false,
    scoreSupport: true,
  },
  {
    id: "phantom-pizzeria",
    title: "Phantom Pizzeria",
    summary: "Read the ticket, build the pie, bake it in the window, serve it hot — five orders a day.",
    description: "An original pizza-shop time-management game: order tickets with per-topping quantities, a patience meter, click-to-place toppings with undo, an oven timing window that tightens as days pass, and scoring split across topping accuracy, bake timing, and speed. New toppings unlock by day; best run is saved locally.",
    category: "Creative",
    tags: ["time-management", "cooking", "arcade", "touch"],
    contentRating: "everyone",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/phantom-pizzeria/index.html?v=1.0.0",
    thumbnail: GAME_ART_BY_SLUG["phantom-pizzeria"],
    featured: false,
    version: "1.0.0",
    controls: "Click or tap toppings, then Oven and Pull & Serve",
    progressSupport: true,
    scoreSupport: true,
  },
  {
    id: "im-baked",
    title: "I'm Baked",
    summary: "Run a future cake shop: read orders, time the oven, decorate showpieces, and grow the shift.",
    description: "A complete cake-shop day loop with distinct customers, order tickets, bake timing, layered procedural cakes, visual finishes, customer patience, grades, coins, streaks, Story Shift, and Rush Counter modes.",
    category: "Creative",
    tags: ["cooking", "cakes", "shop", "creative", "simulation", "touch"],
    contentRating: "everyone",
    contentDescriptors: ["simulated_economy"],
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/im-baked.html?v=1.0.0",
    thumbnail: GAME_ART_BY_SLUG["im-baked"],
    featured: true,
    version: "1.0.0",
    controls: "Choose the ticketed ingredients, stop the oven in the green, decorate, and serve.",
    progressSupport: true,
    scoreSupport: true,
    engine: { tier: "creative-sim", minVersion: PHANTOMPLAY_ENGINE.version },
  },
  {
    id: "phantom-strike",
    title: "Phantom Strike",
    summary: "First-person combat with full mouse-look, sprint/jump/crouch, ADS, reloads, bots, four military maps, a DMR, and real local split-screen.",
    description: "A network-silent first-person shooter with real vertical aim (shots respect where you point, including over cover), sprint, jump, crouch, aim-down-sights, ammo and reloads, low sandbag cover that protects crouching fighters, four 24x24 military maps with buildings, containers, the new Neon Bazaar lane maze, medkit and ammo field pickups that bots also contest, four primary weapon builds, three bot difficulty tiers, layered synthesized combat audio with positional enemy fire, a rotating minimap, compass, killfeed, Solo Ops against a labeled four-bot squad, and genuine same-device 1v1 split-screen.",
    category: "Arcade",
    tags: ["fps", "shooter", "first-person", "bots", "multiplayer", "split-screen", "gamepad"],
    contentRating: "teen",
    contentDescriptors: ["intense_action", "competitive_play"],
    multiplayerDescriptor: "Local 1v1 is real same-device split-screen. Solo Ops uses clearly labeled bots. No public matchmaking, chat, voice, or external networking.",
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/phantom-strike.html?v=2.2.0",
    thumbnail: GAME_ART_BY_SLUG["phantom-strike"],
    featured: true,
    version: "2.2.0",
    controls: "P1: click to lock the mouse - full look including up/down, WASD moves, Shift sprints, Space jumps, Ctrl/C crouches, left mouse fires, right mouse aims down sights, R reloads (F fires without the mouse, Q/E turn). Gamepad: sticks move/look, RT fire, LT ADS, A jump, B crouch, X reload, L3 sprint. P2 (split-screen): arrows turn/move, comma/period strafe, M jumps, Enter or slash fires, or a second gamepad.",
    progressSupport: true,
    scoreSupport: true,
    engine: { tier: "raycast-fps", minVersion: PHANTOMPLAY_ENGINE.version },
  },
  {
    id: "vespergate",
    title: "Vespergate: The Vesper Hand",
    summary: "A crisp top-down portal adventure with a village to save, two dungeons, stronger combat feedback, and true fullscreen play.",
    description: "An original top-down action-adventure. You're the eighth bearer of the Vesper Hand — a portal gauntlet passed down through seven generations. It opens two linked gates on any wall that remembers being a door (liminal stone, bell-brass, saint-glass — never null iron), with a real basis-transform where you, your shots, enemies, and bell shockwaves all keep momentum through the fold. Start at dusk in Duskhollow village as your grandmother hands the Hand down, then help the village: clear shard-wolves from the orchard, recover a lost lantern from a portal-sealed ruin, and descend into two dungeons — the Hollow Geometry (ring both bells, then face Bellmother) and the Glass Ossuary beneath the lake (bank shots off mirror-bone to wake the sigil, then silence the Choir of Glass). Strike, cinder bolt, and gates; hearts, embers, a shop, relics you equip, an inventory and quest log, and an evensong finale. Keyboard + mouse or gamepad, save/resume, and a synthesized dusk soundscape.",
    category: "Arcade",
    tags: ["action-adventure", "portal", "zelda-like", "top-down", "open-world", "gamepad"],
    contentRating: "teen",
    contentDescriptors: ["fantasy_conflict", "intense_action"],
    developer: "Tak",
    developerAvatar: TAK_AVATAR,
    kind: "built_in",
    launchUrl: "/app/games/vespergate/index.html?v=2.1.3",
    thumbnail: GAME_ART_BY_SLUG["vespergate"],
    featured: true,
    version: "2.1.3",
    controls: "WASD moves, left-click strikes, F fires, right-click places a gate, Q swaps, R vents, Shift rolls, E interacts, Tab opens inventory, and Alt+Enter toggles fullscreen. Full gamepad support.",
    progressSupport: true,
    scoreSupport: true,
    engine: { tier: "topdown-adventure", minVersion: PHANTOMPLAY_ENGINE.version },
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
      devModePublishHistory: Array.isArray(parsed.devModePublishHistory) ? parsed.devModePublishHistory : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, profiles: {}, rooms: [], submissions: [], ratingChangeHistory: [], gameOverrides: {}, devModePublishHistory: [] };
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
    .map(kidsLaneGame)
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
    state: item.latest.state,
    canContinue: item.latest.progress < 100 && (item.latest.progress > 0 || Object.keys(item.latest.state || {}).length > 0),
  }));
}

function phantomLeaderboards(store: PhantomPlayStore, catalog: PhantomPlayGame[], actorId: string) {
  const visibleCatalog = catalog.filter((game) => !isKidsLaneGame(game));
  const gameIds = new Set(visibleCatalog.map((game) => game.id));
  const scores: Array<{ gameId: string; gameTitle: string; player: string; score: number; seconds: number; updatedAt: string; isYou: boolean }> = [];
  for (const profile of Object.values(store.profiles)) {
    for (const session of profile.sessions) {
      if (!gameIds.has(session.gameId) || session.score === null) continue;
      const gameTitle = visibleCatalog.find((game) => game.id === session.gameId)?.title || session.gameId;
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
  const byGame = visibleCatalog.map((game) => ({
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
      // Gates the client's "Publish to live" Dev Sandbox button — mirrors the
      // exact same check publishPhantomPlayDevModeSource enforces server-side,
      // so the client only ever offers a control the server will actually honor.
      isOwner: session.orgRole === "owner",
    },
    catalog: catalog.map((game) => ({
      ...game,
      devModeAvailable: phantomPlayDevModeAccessFromStore(store, session, game.id).allowed,
      // The raw admin switch (distinct from devModeAvailable, which also folds
      // in the viewer's own role) — only meaningful to render a toggle control
      // for someone who can already manage this workspace; a regular player
      // never sees or needs it, but it costs nothing to include here since the
      // client only renders it behind its own canModerate check.
      devModeEnabled: devModeEnabledForGame(store, game.id),
    })),
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
  // Sessions are unshifted (newest first) in startPhantomPlaySession, so the
  // first match for this exact gameId is this actor's most recent prior play
  // of it — whatever persisted meta/progress state that game last reported
  // via its own state:{} payload (score/complete). Handed back to the client
  // as restoreState so it can relay a "restore" message once the game is
  // ready — closing a real gap: games like Skyguard Arena already send meta
  // progress (rank/XP/best-wave) via state, and already listen for an
  // incoming "restore" message on boot, but nothing ever sent one back.
  const restoreState = profile.sessions.find((item) => item.gameId === gameId)?.state ?? null;
  const stamp = now();
  const play: PlaySession = { id: `play-${randomUUID()}`, gameId, startedAt: stamp, updatedAt: stamp, endedAt: null, seconds: 0, score: null, progress: 0, state: {} };
  profile.sessions.unshift(play);
  profile.sessions = profile.sessions.slice(0, 120);
  profile.updatedAt = stamp;
  await writeStore(store);
  // catalogFor() returns the raw catalog entry, not the annotated shape the
  // full snapshot builds (see getPhantomPlaySnapshot below) — without this,
  // ui.player.game.devModeAvailable is always undefined here, so the
  // in-player Dev Mode button and the auto-open-after-launch flow both
  // silently no-op even for an account that genuinely has Dev Mode access.
  const gameWithDevMode = { ...game, devModeAvailable: phantomPlayDevModeAccessFromStore(store, session, game.id).allowed };
  return { play, game: gameWithDevMode, restoreState, remainingMinutesToday: dailyMinuteLimit - Math.ceil(todaySeconds(profile) / 60) };
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
    if (input.devModeEnabled !== undefined) {
      const newValue = input.devModeEnabled !== false;
      const previousValue = devModeEnabledForGame(store, gameId);
      if (newValue !== previousValue) {
        appendRatingChangeHistory(store, { actorId, gameId, field: "devModeEnabled", previousValue, newValue, reason });
      }
      nextOverride.devModeEnabled = newValue;
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

/* Dev Mode gate — see docs/architecture/PHANTOMPLAY_DEV_MODE.md. Reuses the same ownership
   model the rest of this module already enforces (developerId for community submissions,
   canManageAccess for everything else) instead of a new permission system. Server-side only:
   the client never decides whether to show the entry point, it just reflects the
   `devModeAvailable` flag this produces in the snapshot catalog. */
export type PhantomPlayDevModeAccess = { allowed: boolean; kind: "built_in" | "community" | "unknown" };

// An admin's per-game Dev Sandbox switch, layered on top of the role check
// below. Undefined (never touched by an admin) reads as enabled, so this is
// purely an opt-out lever — it can only take access AWAY from a role that
// would otherwise have it, never grant access a role wouldn't already have.
function devModeEnabledForGame(store: PhantomPlayStore, gameId: string): boolean {
  return store.gameOverrides[gameId]?.devModeEnabled !== false;
}

function phantomPlayDevModeAccessFromStore(store: PhantomPlayStore, session: AccessSession, gameId: string): PhantomPlayDevModeAccess {
  if (gameId.startsWith("community:")) {
    const submission = store.submissions.find((item) => item.id === gameId.slice("community:".length));
    if (!submission) return { allowed: false, kind: "unknown" };
    const roleAllowed = session.canManageAccess === true || submission.developerId === actorIdFor(session);
    return { allowed: roleAllowed && devModeEnabledForGame(store, gameId), kind: "community" };
  }
  if (!PHANTOMPLAY_BUILT_IN_GAMES.some((game) => game.id === gameId)) return { allowed: false, kind: "unknown" };
  // Built-in games ship in this repo, not owned by any one tenant's developer account —
  // only a workspace manager may hot-edit them, matching registerPhantomPlayEdgeManifest's bar.
  // Deliberately platform-super-admin only (canManageAccess), NOT any org
  // owner/admin: gameOverrides and the submission moderation queue are
  // global, not tenant-scoped, so a random paying customer's own workspace
  // "owner" role must never gain platform-wide catalog/moderation power.
  return { allowed: session.canManageAccess === true && devModeEnabledForGame(store, gameId), kind: "built_in" };
}

export async function phantomPlayDevModeAccess(session: AccessSession, gameId: string) {
  return phantomPlayDevModeAccessFromStore(await readStore(), session, gameId);
}

/* v1 scope: source is only fetchable for built-in games, whose HTML lives in this repo at a
   server-trusted path (see PHANTOMPLAY_BUILT_IN_GAMES). Community submissions only ever store an
   external launchUrl (no embedded source), so there is nothing for this endpoint to read for
   them yet — extending Dev Mode to community games needs a real game-content hosting mechanism
   first, which does not exist in this codebase today. That gap is intentional, not an oversight;
   see docs/architecture/PHANTOMPLAY_DEV_MODE.md. */
export async function getPhantomPlayDevModeSource(session: AccessSession, gameId: string) {
  const access = await phantomPlayDevModeAccess(session, gameId);
  if (!access.allowed) throw new Error("Dev Mode is not available for this game.");
  if (access.kind !== "built_in") throw new Error("Dev Mode source editing is available for built-in games only in this release.");
  const game = PHANTOMPLAY_BUILT_IN_GAMES.find((item) => item.id === gameId);
  const launchPath = game?.launchUrl.split("?")[0] || "";
  if (!game || !launchPath.startsWith("/app/games/")) throw new Error("This game has no editable source file.");
  const gamesRoot = resolve(repoRoot, "app", "games");
  const filePath = resolve(repoRoot, "app", launchPath.replace(/^\/app\//, ""));
  if (!filePath.startsWith(gamesRoot)) throw new Error("Refusing to read outside the games directory.");
  const rawSource = await readFile(filePath, "utf8");
  const source = await inlineDevModeGameAssets(rawSource, filePath);
  return { gameId, title: game.title, launchUrl: game.launchUrl, source };
}

async function inlineDevModeGameAssets(source: string, htmlFilePath: string): Promise<string> {
  const baseDir = dirname(htmlFilePath);
  const safeRelativeAssetPath = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || /^(?:[a-z]+:)?\/\//iu.test(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("#") || trimmed.startsWith("data:")) return "";
    const clean = trimmed.split("#")[0]?.split("?")[0] || "";
    const resolved = resolve(baseDir, clean);
    return resolved === baseDir || resolved.startsWith(`${baseDir}${sep}`) ? resolved : "";
  };
  const replaceAsync = async (text: string, pattern: RegExp, replacer: (match: RegExpMatchArray) => Promise<string>) => {
    const matches = [...text.matchAll(pattern)];
    let next = "";
    let last = 0;
    for (const match of matches) {
      next += text.slice(last, match.index || 0);
      next += await replacer(match);
      last = (match.index || 0) + match[0].length;
    }
    return next + text.slice(last);
  };
  let bundled = await replaceAsync(source, /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/giu, async (match) => {
    const tag = match[0];
    if (!/\brel=["'][^"']*stylesheet/iu.test(tag) && !/\brel=stylesheet\b/iu.test(tag)) return tag;
    const filePath = safeRelativeAssetPath(match[1] || "");
    if (!filePath) return tag;
    try {
      const css = await readFile(filePath, "utf8");
      return `<style data-phantomplay-dev-bundled="${match[1]}">\n${css}\n</style>`;
    } catch {
      return tag;
    }
  });
  bundled = await replaceAsync(bundled, /<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/giu, async (match) => {
    const filePath = safeRelativeAssetPath(match[2] || "");
    if (!filePath) return match[0];
    try {
      const js = await readFile(filePath, "utf8");
      return `<script${match[1] || ""}${match[3] || ""} data-phantomplay-dev-bundled="${match[2]}">\n${js}\n</script>`;
    } catch {
      return match[0];
    }
  });
  return bundled;
}

const DEV_SANDBOX_SOURCE_MAX_BYTES = 2_000_000;

function resolveBuiltInGameFilePath(gameId: string): { game: PhantomPlayGame; filePath: string } {
  const game = PHANTOMPLAY_BUILT_IN_GAMES.find((item) => item.id === gameId);
  const launchPath = game?.launchUrl.split("?")[0] || "";
  if (!game || !launchPath.startsWith("/app/games/")) throw new Error("This game has no editable source file.");
  const gamesRoot = resolve(repoRoot, "app", "games");
  const filePath = resolve(repoRoot, "app", launchPath.replace(/^\/app\//, ""));
  if (!filePath.startsWith(gamesRoot)) throw new Error("Refusing to write outside the games directory.");
  return { game, filePath };
}

function assertDevSandboxSource(source: unknown): string {
  if (typeof source !== "string" || !source.trim()) throw new Error("Dev Sandbox edit must include source text.");
  if (Buffer.byteLength(source, "utf8") > DEV_SANDBOX_SOURCE_MAX_BYTES) throw new Error("Dev Sandbox edit is too large to save.");
  return source;
}

// Dev Sandbox "override" — the safe default save path. Persists a workspace's
// in-progress edit to the JSON store only; it never touches the real game
// file on disk, so regular players (whose iframe always loads the game's
// real launchUrl) are completely unaffected. Returning admins/managers with
// Dev Mode access to this exact game can fetch it back with
// getPhantomPlayDevModeOverride to resume where they left off.
export async function savePhantomPlayDevModeOverride(session: AccessSession, gameId: string, source: unknown) {
  const access = await phantomPlayDevModeAccess(session, gameId);
  if (!access.allowed) throw new Error("Dev Mode is not available for this game.");
  const cleanSource = assertDevSandboxSource(source);
  const store = await readStore();
  const nextOverride: PhantomPlayGameOverride = {
    ...(store.gameOverrides[gameId] || { updatedAt: now() }),
    devSourceOverride: cleanSource,
    devSourceOverrideUpdatedAt: now(),
  };
  store.gameOverrides[gameId] = nextOverride;
  await writeStore(store);
  return { gameId, updatedAt: nextOverride.devSourceOverrideUpdatedAt };
}

export async function getPhantomPlayDevModeOverride(session: AccessSession, gameId: string) {
  const access = await phantomPlayDevModeAccess(session, gameId);
  if (!access.allowed) throw new Error("Dev Mode is not available for this game.");
  const store = await readStore();
  const override = store.gameOverrides[gameId];
  return { gameId, source: override?.devSourceOverride ?? null, updatedAt: override?.devSourceOverrideUpdatedAt ?? null };
}

export async function discardPhantomPlayDevModeOverride(session: AccessSession, gameId: string) {
  const access = await phantomPlayDevModeAccess(session, gameId);
  if (!access.allowed) throw new Error("Dev Mode is not available for this game.");
  const store = await readStore();
  const existing = store.gameOverrides[gameId];
  if (existing) {
    const { devSourceOverride, devSourceOverrideUpdatedAt, ...rest } = existing;
    store.gameOverrides[gameId] = { ...rest, updatedAt: now() };
    await writeStore(store);
  }
  return { gameId, discarded: true };
}

// Publish to live — the maximum-power, owner-gated path. Writes the edited
// source directly to the real shipped game file every player's iframe loads,
// atomically (temp file + rename, same pattern writeStore already uses for
// the JSON store), then clears any pending override for this game since the
// shipped file now IS that edit. The host never evals/executes this text —
// it only ever persists bytes to disk; the sandboxed player iframe is what
// later loads and runs the file, exactly as it does for every other game.
export async function publishPhantomPlayDevModeSource(session: AccessSession, gameId: string, source: unknown) {
  if (session.orgRole !== "owner") throw new Error("Only the workspace owner can publish a Dev Sandbox edit live.");
  const access = await phantomPlayDevModeAccess(session, gameId);
  if (!access.allowed || access.kind !== "built_in") throw new Error("Publishing live is only available for built-in games with Dev Mode enabled.");
  const cleanSource = assertDevSandboxSource(source);
  const { filePath } = resolveBuiltInGameFilePath(gameId);
  const temp = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await writeFile(temp, cleanSource, "utf8");
  await replaceStoreFile(temp, filePath);

  const store = await readStore();
  const existing = store.gameOverrides[gameId];
  const { devSourceOverride, devSourceOverrideUpdatedAt, ...rest } = existing || { updatedAt: now() };
  store.gameOverrides[gameId] = { ...rest, updatedAt: now() };
  store.devModePublishHistory = [
    { ts: now(), actorId: actorIdFor(session), gameId, bytes: Buffer.byteLength(cleanSource, "utf8") },
    ...store.devModePublishHistory,
  ].slice(0, 500);
  await writeStore(store);

  const game = PHANTOMPLAY_BUILT_IN_GAMES.find((item) => item.id === gameId);
  return { gameId, publishedAt: now(), launchUrl: game?.launchUrl || "" };
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
    devModePublishes: store.devModePublishHistory.length,
  };
}
