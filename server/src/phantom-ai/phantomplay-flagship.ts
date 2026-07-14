/* PhantomForce — PhantomPlay Flagship Five.

   Five substantially deeper PhantomPlay games (real progression,
   cross-network multiplayer via the existing workspace-relay room model,
   in-app tutorials) than any of the 23 existing built-in games. Following
   the exact precedent set by ./phantomplay-v2.ts: this file owns its own
   games array and a registerPhantomPlayFlagshipGames() merge-at-startup
   function, with an explicit "no V1/V2 source edits" goal — the existing
   PHANTOMPLAY_BUILT_IN_GAMES and PHANTOMPLAY_V2_GAMES arrays are never
   mutated in place, only pushed into (array push, like V2 already does to
   V1's array). Games ship in a later step; this file just wires the
   registration plumbing so app/games/<slug>/ folders can land independently
   of the catalog/server wiring.

   Each game, once added, is expected to live entirely under its own
   app/games/<slug>/ (or app/games/<slug>.html) path per the platform's
   file-format contract — this module only ever holds catalog metadata
   (PhantomPlayGame entries), never game logic. */

import { PHANTOMPLAY_BUILT_IN_GAMES, PHANTOMPLAY_ENGINE, type PhantomPlayGame } from "./phantomplay.js";

// 4 of the 5 planned flagship games are built and ready to ship (Kingdom
// Breakers is still in progress elsewhere and is intentionally NOT listed
// here — no placeholder entry for it). Each entry's launchUrl points at the
// real on-disk file verified under app/games/. thumbnail points at an
// original placeholder SVG cover under app/assets/phantomplay/ (none of
// these four had existing cover art in that folder, so a simple on-brand
// placeholder was generated per game rather than referencing a nonexistent
// asset or borrowing another game's unrelated cover).
export const PHANTOMPLAY_FLAGSHIP_GAMES: PhantomPlayGame[] = [
  {
    id: "cubetown",
    title: "CubeTown",
    summary: "Build a cozy blocky town, befriend three residents, and keep your Spark up.",
    description: "A cozy single-tile town-builder: gather Grain, Shale, and Loom from the map, place and rotate 13 kinds of build pieces on a snap grid, cook dishes at a hearth to restore your Spark meter, and fish a timing minigame for Driftfish. Three residents (Miro, Tally, and Bo) each have one quest that unlocks new cosmetics once completed, and a day/night clock cycles as you play. A private \"Together\" room lets a group gather, fish, cook, and visit residents side by side — only the room host's placements become the shared town; everyone else's builds stay local previews so nothing gets overwritten.",
    category: "Creative",
    tags: ["building", "life-sim", "cozy", "farming", "multiplayer", "touch"],
    contentRating: "everyone",
    contentDescriptors: ["no_reading_required"],
    multiplayerDescriptor: "Together: cross-network relay rooms, host-authoritative shared building, guest placements stay local previews",
    chatDescriptor: "No player chat or voice — only fixed, pre-written resident dialogue",
    developer: "PhantomPlay Studio",
    kind: "built_in",
    launchUrl: "/app/games/cubetown/index.html?v=1.0.0",
    thumbnail: "/app/assets/phantomplay/cubetown-cover.svg?v=1.0.0",
    featured: true,
    version: "1.0.0",
    controls: "WASD/arrow keys or tap an adjacent tile to move. Space/E to gather, fish, cook, sleep, or talk. B opens Build, Escape cancels/closes panels. Touch devices get an on-screen D-pad.",
    progressSupport: true,
    scoreSupport: true,
    engine: { tier: "sandbox-large-map", minVersion: PHANTOMPLAY_ENGINE.version },
  },
  {
    id: "skyguard-arena",
    title: "Skyguard Arena",
    summary: "Place Sentinels along the Skyline Route and hold your Spire against raid waves.",
    description: "A lane-based tower-defense game: spend Glint to place and upgrade Sentinels (Glare Cannon, Arc Diffuser, Frost Prism, Vane Sniper) that auto-fire on raiders walking a fixed route toward your Spire, and trigger the Overcharge Pulse commander ability for a timed damage/fire-rate buff. Play an 8-wave Campaign against the Voidmaw Colossus boss, an endlessly escalating Endless Watch, a local Skirmish vs a bot rival with offensive Pressure Powers, or a real head-to-head Room Duel against another player in a PhantomPlay Playtest Room.",
    category: "Strategy",
    tags: ["tower-defense", "strategy", "pvp", "waves", "touch"],
    contentRating: "everyone10",
    contentDescriptors: ["cartoon_action", "strategic_complexity", "competitive_play"],
    multiplayerDescriptor: "Room Duel: cross-network relay rooms, host-authoritative duel state with a documented spectator-side prediction/reconciliation model",
    chatDescriptor: "No player chat or voice",
    developer: "PhantomPlay Studio",
    kind: "built_in",
    launchUrl: "/app/games/skyguard-arena/index.html?v=1.0.0",
    thumbnail: "/app/assets/phantomplay/skyguard-arena-cover.svg?v=1.0.0",
    featured: true,
    version: "1.0.0",
    controls: "Click/tap dock cards and lane slots to place and upgrade Sentinels. Q triggers Overcharge Pulse, P pauses, Escape deselects. Mouse and touch both work through the same pointer input.",
    progressSupport: true,
    scoreSupport: true,
    engine: { tier: "arena-large-map", minVersion: PHANTOMPLAY_ENGINE.version },
  },
  {
    id: "keyboardist-on-tour",
    title: "Keyboardist On Tour",
    summary: "Hit the falling Pulses in time with three original synthesized tracks.",
    description: "A falling-note rhythm game with fully in-browser synthesized music (no external audio files). Press each lane's key as its Pulse crosses the Threshold line for a PERFECT/GREAT/GOOD/OK/MISS grade, build a streak multiplier, and clear Neon Warehouse, Rooftop Static, and Arena Overdrive in Tour mode (venues unlock in sequence) or free-practice any track in Soundcheck with an adjustable note speed. An optional AI Session Player plays alongside you for a head-to-head score, and Tour Duel syncs a shared track and live scoreboard with another player in a PhantomPlay Playtest Room.",
    category: "Focus",
    tags: ["rhythm", "music", "keyboard", "timing", "multiplayer"],
    contentRating: "everyone",
    contentDescriptors: ["music", "competitive_play"],
    multiplayerDescriptor: "Tour Duel: cross-network relay rooms, host-synced countdown with a periodic host-relayed scoreboard",
    chatDescriptor: "No player chat or voice",
    developer: "PhantomPlay Studio",
    kind: "built_in",
    launchUrl: "/app/games/keyboardist-on-tour.html?v=1.0.0",
    thumbnail: "/app/assets/phantomplay/keyboardist-on-tour-cover.svg?v=1.0.0",
    featured: true,
    version: "1.0.0",
    controls: "Keyboard only for gameplay — default D/F/J/K (plus Space on the 5-lane track), fully rebindable in Settings. P or Escape pauses. Menus and mode selection are tap/click-friendly, but note hitting itself has no touch input yet.",
    progressSupport: true,
    scoreSupport: true,
  },
  {
    id: "tidefront-tactics",
    title: "Tidefront Tactics",
    summary: "Aim, account for wind, and fire your Skiff's weapons to sink the last fleet standing.",
    description: "A turn-based artillery/tactics duel on a deformable heightmap sea. Pick an angle, power, and one of three tools — reliable Brine Mortar, heavy cooldown Anchor Charge, or repositioning Tide Tether — then fire under gravity and shifting wind to crater the terrain and splash-damage any Skiff caught in the blast. Clear a 4-mission Campaign against the Leviathan Hulk boss, run 1v1 or 3-way Skirmish against difficulty-tunable bots, or join a Fleet Room where one device claims the Helm and pilots the shared battle while everyone else spectates the host's synced state live.",
    category: "Strategy",
    tags: ["artillery", "tactics", "turn-based", "pvp", "physics"],
    contentRating: "everyone10",
    contentDescriptors: ["strategic_complexity", "mild_destruction", "competitive_play"],
    multiplayerDescriptor: "Fleet Room: cross-network relay rooms, one Helm pilot with everyone else a read-only spectator mirroring host-pushed state",
    chatDescriptor: "No player chat or voice",
    developer: "PhantomPlay Studio",
    kind: "built_in",
    launchUrl: "/app/games/tidefront-tactics.html?v=1.0.0",
    thumbnail: "/app/assets/phantomplay/tidefront-tactics-cover.svg?v=1.0.0",
    featured: true,
    version: "1.0.0",
    controls: "Arrow keys to adjust angle/power, Space to fire, 1/2/3 to switch tools, Escape to pause. Drag on the battlefield to aim, or use the on-screen touchpad on mobile.",
    progressSupport: true,
    scoreSupport: true,
  },
];

let gamesRegistered = false;
export function registerPhantomPlayFlagshipGames() {
  if (gamesRegistered) return;
  gamesRegistered = true;
  for (const game of PHANTOMPLAY_FLAGSHIP_GAMES) {
    if (!PHANTOMPLAY_BUILT_IN_GAMES.some((item) => item.id === game.id)) PHANTOMPLAY_BUILT_IN_GAMES.push(game);
  }
}
