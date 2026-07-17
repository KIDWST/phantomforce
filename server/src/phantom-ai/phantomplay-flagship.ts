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

// All 5 planned flagship games are now built and ready to ship. Each entry's
// launchUrl points at the real on-disk file verified under app/games/.
// thumbnail points at an original placeholder SVG cover under
// app/assets/phantomplay/ (a simple on-brand placeholder generated per game
// rather than referencing a nonexistent asset or borrowing another game's
// unrelated cover — kingdom-breakers-cover.svg already existed on disk when
// this entry was added and follows the same pattern as the other four).
export const PHANTOMPLAY_FLAGSHIP_GAMES: PhantomPlayGame[] = [
  {
    id: "cubetown",
    title: "CubeTown",
    summary: "Build a cozy blocky town with quests, fishing, cooking, night fireflies, and Spark.",
    description: "A cozy single-tile town-builder: gather Grain, Shale, and Loom from the map, place and rotate 13 kinds of build pieces on a snap grid, cook dishes at a hearth to restore your Spark meter, fish a timing minigame for Driftfish, and watch the town breathe with a day/night cycle and glowing dusk fireflies. Three residents (Miro, Tally, and Bo) each have one quest that unlocks new cosmetics once completed. A private \"Together\" room lets a group gather, fish, cook, and visit residents side by side — only the room host's placements become the shared town; everyone else's builds stay local previews so nothing gets overwritten.",
    category: "Creative",
    tags: ["building", "life-sim", "cozy", "farming", "multiplayer", "touch"],
    contentRating: "everyone",
    contentDescriptors: ["no_reading_required"],
    multiplayerDescriptor: "Together: cross-network relay rooms, host-authoritative shared building, guest placements stay local previews",
    chatDescriptor: "No player chat or voice — only fixed, pre-written resident dialogue",
    developer: "Tak",
    kind: "built_in",
    launchUrl: "/app/games/cubetown/index.html?v=1.1.0",
    thumbnail: "/app/assets/phantomplay/cubetown-cover.svg?v=1.0.0",
    featured: true,
    version: "1.1.0",
    controls: "WASD/arrow keys or tap an adjacent tile to move. Space/E to gather, fish, cook, sleep, or talk. B opens Build, Escape cancels/closes panels. Touch devices get an on-screen D-pad.",
    progressSupport: true,
    scoreSupport: true,
    engine: { tier: "sandbox-large-map", minVersion: PHANTOMPLAY_ENGINE.version },
  },
  {
    id: "skyguard-arena",
    title: "Skyguard Arena",
    summary: "Defend the animated Skyline Route with Sentinels, route pulses, boss waves, and Overcharge.",
    description: "A lane-based tower-defense game: spend Glint to place and upgrade Sentinels (Glare Cannon, Arc Diffuser, Frost Prism, Vane Sniper) that auto-fire on raiders walking an animated energy route toward your Spire, and trigger the Overcharge Pulse commander ability for a timed damage/fire-rate buff. Play an 8-wave Campaign against the Voidmaw Colossus boss, an endlessly escalating Endless Watch, a local Skirmish vs a bot rival with offensive Pressure Powers, or a real head-to-head Room Duel against another player in a PhantomPlay Playtest Room.",
    category: "Strategy",
    tags: ["tower-defense", "strategy", "pvp", "waves", "touch"],
    contentRating: "everyone10",
    contentDescriptors: ["cartoon_action", "strategic_complexity", "competitive_play"],
    multiplayerDescriptor: "Room Duel: cross-network relay rooms, host-authoritative duel state with a documented spectator-side prediction/reconciliation model",
    chatDescriptor: "No player chat or voice",
    developer: "Tak",
    kind: "built_in",
    launchUrl: "/app/games/skyguard-arena/index.html?v=1.1.0",
    thumbnail: "/app/assets/phantomplay/skyguard-arena-cover.svg?v=1.0.0",
    featured: true,
    version: "1.1.0",
    controls: "Click/tap dock cards and lane slots to place and upgrade Sentinels. Q triggers Overcharge Pulse, P pauses, Escape deselects. Mouse and touch both work through the same pointer input.",
    progressSupport: true,
    scoreSupport: true,
    engine: { tier: "arena-large-map", minVersion: PHANTOMPLAY_ENGINE.version },
  },
  {
    id: "keyboardist-on-tour",
    title: "Keyboardist On Tour",
    summary: "Type nonstop changing letters across three original synthesized tracks.",
    description: "A falling-letter rhythm game with fully in-browser synthesized music (no external audio files). Type the visible letters as they cross the Threshold line, keep the streak alive, and clear Neon Warehouse, Rooftop Static, and Arena Overdrive in Tour mode. Soundcheck has adjustable note speed, Session Player adds an AI rival, and Tour Duel syncs a shared track and scoreboard with another player in a PhantomPlay Playtest Room.",
    category: "Focus",
    tags: ["rhythm", "music", "keyboard", "timing", "multiplayer"],
    contentRating: "everyone",
    contentDescriptors: ["music", "competitive_play"],
    multiplayerDescriptor: "Tour Duel: cross-network relay rooms, host-synced countdown with a periodic host-relayed scoreboard",
    chatDescriptor: "No player chat or voice",
    developer: "Tak",
    kind: "built_in",
    launchUrl: "/app/games/keyboardist-on-tour.html?v=1.1.0",
    thumbnail: "/app/assets/phantomplay/keyboardist-on-tour-cover.svg?v=1.0.0",
    featured: true,
    version: "1.1.0",
    controls: "Keyboard only for gameplay — default D/F/J/K (plus Space on the 5-lane track), fully rebindable in Settings. P or Escape pauses. Menus and mode selection are tap/click-friendly, but note hitting itself has no touch input yet.",
    progressSupport: true,
    scoreSupport: true,
  },
  {
    id: "tidefront-tactics",
    title: "Tidefront Tactics",
    summary: "Wind-read artillery tactics with Skiff weapons, cratered seas, bots, and boss duels.",
    description: "A turn-based artillery/tactics duel on a deformable heightmap sea. Pick an angle, power, and one of three tools — reliable Brine Mortar, heavy cooldown Anchor Charge, or repositioning Tide Tether — then fire under gravity and shifting wind to crater the terrain and splash-damage any Skiff caught in the blast. Clear a 4-mission Campaign against the Leviathan Hulk boss, run 1v1 or 3-way Skirmish against difficulty-tunable bots, or join a Fleet Room where one device claims the Helm and pilots the shared battle while everyone else spectates the host's synced state live.",
    category: "Strategy",
    tags: ["artillery", "tactics", "turn-based", "pvp", "physics"],
    contentRating: "everyone10",
    contentDescriptors: ["strategic_complexity", "mild_destruction", "competitive_play"],
    multiplayerDescriptor: "Fleet Room: cross-network relay rooms, one Helm pilot with everyone else a read-only spectator mirroring host-pushed state",
    chatDescriptor: "No player chat or voice",
    developer: "Tak",
    kind: "built_in",
    launchUrl: "/app/games/tidefront-tactics.html?v=1.1.0",
    thumbnail: "/app/assets/phantomplay/tidefront-tactics-cover.svg?v=1.0.0",
    featured: true,
    version: "1.1.0",
    controls: "Arrow keys to adjust angle/power, Space to fire, 1/2/3 to switch tools, Escape to pause. Drag on the battlefield to aim, or use the on-screen touchpad on mobile.",
    progressSupport: true,
    scoreSupport: true,
  },
  {
    id: "kingdom-breakers",
    title: "Kingdom Breakers",
    summary: "Us-vs-them tower siege with longer Stonefall and Ember shots that actually reach.",
    description: "A physics-based siege/destruction game: drag to aim and fire one of three ammunition types — hard-hitting Stonefall Orbs, piercing Splinter Lances, or splash-damage Emberburst Charges — at a rigid-body-simulated fortress built from stone, timber, and ironclad blocks. Duel mode is your tower vs their tower; campaign mode pushes through six holds into the ironclad-cored Warlord's Anvil boss. Stars come from breach percentage, ammo conserved, and keeping every Warden un-harmed; knocking out a hold's glowing keystone block triggers a slow-motion final blow.",
    category: "Strategy",
    tags: ["siege", "destruction", "physics", "artillery", "campaign", "pvp", "touch"],
    contentRating: "everyone10",
    contentDescriptors: ["cartoon_action", "mild_destruction", "competitive_play"],
    multiplayerDescriptor: "Siege Party: cross-network relay rooms, host-probe race establishes host authority; everyone breaches their own copy of the fortress against a shared timer, but the shared live board currently only carries the host's own run (each player's result still saves individually to their own PhantomPlay history/leaderboard) — see known issues.",
    chatDescriptor: "No player chat or voice",
    developer: "Tak",
    kind: "built_in",
    launchUrl: "/app/games/kingdom-breakers.html?v=1.1.0",
    thumbnail: "/app/assets/phantomplay/kingdom-breakers-cover.svg?v=1.0.0",
    featured: true,
    version: "1.1.0",
    controls: "Press and drag anywhere on the field to aim — direction and distance from the siege engine set angle and power — then release to fire. Tap the ammo rack or press 1/2/3 to switch ammunition, Space/Enter fires while aiming, arrow keys nudge angle and power, and P (or the on-screen button) pauses. Touch and mouse/pointer input work the same way.",
    progressSupport: true,
    scoreSupport: true,
  },
  {
    id: "phantom-grand-prix",
    title: "Phantom Grand Prix",
    summary: "An original kart racer — drift-charged mini-turbos, catch-up items, three laps.",
    description: "A top-down arcade kart racer around a closed Catmull-Rom spline circuit (Ghostlight Speedway): hold drift and steer to charge three tiers of mini-turbo, grab item boxes with rank-weighted catch-up odds (boost, shield, a dropped ooze hazard, a homing bolt, and a rare invincibility surge), and race three laps against Phantom-piloted rivals. Play solo against 3 CPU racers, or 2-player same-machine split-screen with CPU racers filling out the grid, with real lap/position tracking and a results screen at the finish.",
    category: "Arcade",
    tags: ["racing", "kart", "arcade", "multiplayer", "touch"],
    contentRating: "everyone",
    contentDescriptors: ["cartoon_action", "competitive_play"],
    multiplayerDescriptor: "2-player same-machine split-screen only — no cross-network racing yet",
    chatDescriptor: "No player chat or voice",
    developer: "Tak",
    kind: "built_in",
    launchUrl: "/app/games/phantom-grand-prix/index.html?v=1.0.0",
    thumbnail: "/app/assets/phantomplay/phantom-grand-prix-cover.svg?v=1.0.0",
    featured: true,
    version: "1.0.0",
    controls: "P1: W/S gas-brake, A/D steer, Shift drift, Space use item. P2 (split-screen): arrow keys, / drift, Enter use item.",
    progressSupport: false,
    scoreSupport: false,
  },
  {
    id: "beat-strike",
    title: "BeatStrike",
    summary: "Full-keyboard tap/hold rhythm game on a generated 128 BPM beatmap.",
    description: "A rhythm game where every letter key is live — no words, no lyrics, just tap and hold notes falling toward the hit line on a generated 128 BPM beatmap with a synthesized click track. Timing is scheduled off the Web Audio clock so it never drifts. Chase Perfect/Good judgements, keep your streak alive, and clear the full song for a final score and accuracy readout.",
    category: "Focus",
    tags: ["rhythm", "music", "keyboard", "timing"],
    contentRating: "everyone",
    contentDescriptors: ["music"],
    developer: "Tak",
    kind: "built_in",
    launchUrl: "/app/games/beat-strike/index.html?v=1.0.0",
    thumbnail: "/app/assets/phantomplay/beat-strike-cover.svg?v=1.0.0",
    featured: true,
    version: "1.0.0",
    controls: "Every letter key is live — press for tap notes, press and hold until a hold note clears the line. P or Escape pauses.",
    progressSupport: false,
    scoreSupport: false,
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
