/* PhantomForce — PhantomPlay Flagship Games.

   Substantially deeper PhantomPlay games (real progression,
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

// The flagship games are now built and ready to ship. Each entry's
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
    description: "A cozy single-tile town-builder: gather Grain, Shale, and Loom from the map, place and rotate 13 kinds of build pieces on a snap grid, cook dishes at a hearth to restore your Spark meter, fish a timing minigame for Driftfish, and watch the town breathe with a day/night cycle, glowing dusk fireflies, and a gentle generative soundscape — wind, birdsong, crickets, and music-box notes that follow the time of day. Three residents (Miro, Tally, and Bo) each have one quest that unlocks new cosmetics once completed. A private \"Together\" room lets a group gather, fish, cook, and visit residents side by side — only the room host's placements become the shared town; everyone else's builds stay local previews so nothing gets overwritten.",
    category: "Creative",
    tags: ["building", "life-sim", "cozy", "farming", "multiplayer", "touch"],
    contentRating: "everyone",
    contentDescriptors: ["no_reading_required"],
    multiplayerDescriptor: "Together: cross-network relay rooms, host-authoritative shared building, guest placements stay local previews",
    chatDescriptor: "No player chat or voice — only fixed, pre-written resident dialogue",
    developer: "Tak",
    kind: "built_in",
    launchUrl: "/app/games/cubetown/index.html?v=1.3.0",
    thumbnail: "/app/assets/phantomplay/cubetown-cover.svg?v=1.0.0",
    featured: true,
    version: "1.3.0",
    controls: "WASD/arrow keys or tap an adjacent tile to move. Space/E to gather, fish, cook, sleep, or talk. B opens Build, Escape cancels/closes panels. Touch devices get an on-screen D-pad.",
    progressSupport: true,
    scoreSupport: true,
    engine: { tier: "sandbox-large-map", minVersion: PHANTOMPLAY_ENGINE.version },
  },
  {
    id: "skyguard-arena",
    title: "Skyguard Arena",
    summary: "Defend animated routes with starter sentries, 3-tier Sentinels, Century Watch bosses, Neon Tangle, relay surges, and Overcharge.",
    description: "A lane-based tower-defense game: the opening route now gets starter sentries, more Glint, and a gentler first formation before air pressure begins. Spend Glint to place and upgrade Sentinels that auto-fire on raiders walking animated energy routes toward your Spire, then trigger Overcharge for timed damage/fire-rate buffs. Century Watch escalates toward round 100, boss mechanics rotate every 10 rounds, Neon Tangle adds a braided relay race with timed relay surges that punish clustered enemies, and Room Duel support stays network-silent through PhantomPlay rooms.",
    category: "Strategy",
    tags: ["tower-defense", "strategy", "pvp", "waves", "touch"],
    contentRating: "everyone10",
    contentDescriptors: ["cartoon_action", "strategic_complexity", "competitive_play"],
    multiplayerDescriptor: "Room Duel: cross-network relay rooms, host-authoritative duel state with a documented spectator-side prediction/reconciliation model",
    chatDescriptor: "No player chat or voice",
    developer: "Tak",
    kind: "built_in",
    launchUrl: "/app/games/skyguard-arena/index.html?v=1.3.1",
    thumbnail: "/app/assets/phantomplay/skyguard-arena-cover.svg?v=1.0.0",
    featured: true,
    version: "1.3.1",
    controls: "Click/tap dock cards and lane slots to place and upgrade Sentinels. Q triggers Overcharge Pulse, P pauses, Escape deselects. Mouse and touch both work through the same pointer input.",
    progressSupport: true,
    scoreSupport: true,
    engine: { tier: "arena-large-map", minVersion: PHANTOMPLAY_ENGINE.version },
  },
  {
    id: "crown-circuit",
    title: "Crown Circuit",
    summary: "Solo bot training plus 1v1 lane-card crown duels with Obsidian Relay, Oracle slows, Ram sieges, and room support.",
    description: "A royale-style lane battler: start Solo Training against Crown Bot to learn lane pressure and elixir timing across multiple arenas including Obsidian Relay, then play the same drag-and-drop troop duel in a private PhantomPlay room. Oracle cards now apply real slows, Ram cards pressure towers, and Crown Bot understands the upgraded deck.",
    category: "Strategy",
    tags: ["card", "lane", "royale", "solo", "bots", "training", "multiplayer", "pvp"],
    contentRating: "everyone10",
    contentDescriptors: ["strategic_complexity", "competitive_play"],
    multiplayerDescriptor: "Solo Training uses Crown Bot. Room mode is a two-player private PhantomPlay duel. No public matchmaking, chat, or voice.",
    chatDescriptor: "No player chat or voice",
    developer: "Tak",
    kind: "built_in",
    launchUrl: "/app/games/crown-circuit.html?v=1.3.0",
    thumbnail: "/app/assets/phantomplay/crown-circuit-cover.svg?v=1.0.0",
    featured: true,
    version: "1.3.0",
    controls: "Drag a card from your hand onto your side of the field. Solo Training starts immediately against Crown Bot; Room mode waits for player two.",
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
    launchUrl: "/app/games/keyboardist-on-tour.html?v=2.1.0",
    thumbnail: "/app/assets/phantomplay/keyboardist-on-tour-cover.svg?v=1.0.0",
    featured: true,
    version: "2.1.0",
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
    id: "im-baked",
    title: "I'm Baked",
    summary: "Run a future cake shop through real order, oven, decoration, service, and shift-result loops.",
    description: "A complete cake-shop simulator with changing customer tickets, bake timing, layered procedural cakes, visual finishes, patience, grades, coins, streaks, Story Shift, and Rush Counter modes.",
    category: "Creative",
    tags: ["cooking", "cakes", "shop", "creative", "simulation", "touch"],
    contentRating: "everyone",
    contentDescriptors: ["simulated_economy"],
    developer: "Tak",
    kind: "built_in",
    launchUrl: "/app/games/im-baked.html?v=1.0.0",
    thumbnail: "/app/assets/phantomplay/im-baked-cover.svg?v=1.0.0",
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
    tags: ["fps", "shooter", "first-person", "bots", "multiplayer", "split-screen"],
    contentRating: "teen",
    contentDescriptors: ["intense_action", "competitive_play"],
    multiplayerDescriptor: "Local 1v1 is real same-device split-screen. Solo Ops uses clearly labeled bots. No public matchmaking or external networking.",
    chatDescriptor: "No player chat or voice",
    developer: "Tak",
    kind: "built_in",
    launchUrl: "/app/games/phantom-strike.html?v=2.2.0",
    thumbnail: "/app/assets/phantomplay/phantom-strike-cover.svg?v=1.0.0",
    featured: true,
    version: "2.2.0",
    controls: "P1: click to lock the mouse - full look including up/down, WASD moves, Shift sprints, Space jumps, Ctrl/C crouches, left mouse fires, right mouse aims down sights, R reloads (F fires without the mouse, Q/E turn). Gamepad: sticks move/look, RT fire, LT ADS, A jump, B crouch, X reload, L3 sprint. P2 (split-screen): arrows turn/move, comma/period strafe, M jumps, Enter or slash fires, or a second gamepad.",
    progressSupport: true,
    scoreSupport: true,
    engine: { tier: "raycast-fps", minVersion: PHANTOMPLAY_ENGINE.version },
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
