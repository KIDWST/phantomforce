/* PhantomForce — PhantomPlay Flagship Five.

   Five substantially deeper PhantomPlay games (real progression,
   cross-network multiplayer via the existing workspace-relay room model,
   in-app tutorials) than any of the pre-existing built-in games. Following
   the exact precedent set by ./phantomplay-v2.ts: this file owns its own
   games array and a registerPhantomPlayFlagshipGames() merge-at-startup
   function — PHANTOMPLAY_BUILT_IN_GAMES is never mutated in place, only
   pushed into.

   NOTE: this branch's PhantomPlayGame type predates the 5-tier rating
   extension (contentDescriptors/multiplayerDescriptor/chatDescriptor
   fields, and the toddler/everyone10 rating values) built on a sibling
   branch — those fields are intentionally omitted here rather than
   assumed to exist. "everyone10"-rated entries are mapped down to
   "everyone" (the closest available tier in this branch's 3-tier
   PhantomPlayRating) until that rating extension lands here too. */

import { PHANTOMPLAY_BUILT_IN_GAMES, PHANTOMPLAY_ENGINE, type PhantomPlayGame } from "./phantomplay.js";

export const PHANTOMPLAY_FLAGSHIP_GAMES: PhantomPlayGame[] = [
  {
    id: "cubetown",
    title: "CubeTown",
    summary: "Build a cozy blocky town, befriend three residents, and keep your Spark up.",
    description: "A cozy single-tile town-builder: gather Grain, Shale, and Loom from the map, place and rotate 13 kinds of build pieces on a snap grid, cook dishes at a hearth to restore your Spark meter, and fish a timing minigame for Driftfish. Three residents (Miro, Tally, and Bo) each have one quest that unlocks new cosmetics once completed, and a day/night clock cycles as you play. A private \"Together\" room lets a group gather, fish, cook, and visit residents side by side — only the room host's placements become the shared town; everyone else's builds stay local previews so nothing gets overwritten.",
    category: "Creative",
    tags: ["building", "life-sim", "cozy", "farming", "multiplayer", "touch"],
    contentRating: "everyone",
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
    contentRating: "everyone",
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
    contentRating: "everyone",
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
  {
    id: "kingdom-breakers",
    title: "Kingdom Breakers",
    summary: "Aim your siege engine, break the hold's blocks apart, and keep every Warden safe.",
    description: "A physics-based siege/destruction game: drag to aim and fire one of three ammunition types — hard-hitting Stonefall Orbs, piercing Splinter Lances, or splash-damage Emberburst Charges — at a rigid-body-simulated fortress built from stone, timber, and ironclad blocks. Clear a 6-hold Siege Campaign ending at the ironclad-cored Warlord's Anvil boss, fight an alternating-turn Duel vs a bot rival, or join a Siege Party room where everyone breaches their own copy of the same fortress against a shared clock. Stars come from breach percentage, ammo conserved, and keeping every Warden un-harmed; knocking out a hold's glowing keystone block triggers a slow-motion final blow.",
    category: "Strategy",
    tags: ["siege", "destruction", "physics", "artillery", "campaign", "pvp", "touch"],
    contentRating: "everyone",
    developer: "PhantomPlay Studio",
    kind: "built_in",
    launchUrl: "/app/games/kingdom-breakers.html?v=1.0.0",
    thumbnail: "/app/assets/phantomplay/kingdom-breakers-cover.svg?v=1.0.0",
    featured: true,
    version: "1.0.0",
    controls: "Press and drag anywhere on the field to aim — direction and distance from the siege engine set angle and power — then release to fire. Tap the ammo rack or press 1/2/3 to switch ammunition, Space/Enter fires while aiming, arrow keys nudge angle and power, and P (or the on-screen button) pauses. Touch and mouse/pointer input work the same way.",
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
