/* VESPERGATE: THE VESPER HAND — rooms.js
 * The world: Duskhollow village, the Vesper Vale, the Lake of Saint-Glass,
 * and both dungeons (The Hollow Geometry, The Glass Ossuary) re-authored for
 * top-down play. Plus the game DATA layer: NPCs, dialogue, quests, shop.
 *
 * Maps are content rows auto-normalized to width and wrapped in a border
 * character, with explicit "holes" punched for exits — this guarantees every
 * map is rectangular and sealed, so a stray character can never open the
 * world to the void.
 */
"use strict";
(() => {
  const VG = window.VG;

  /* border-wrap helper: rows are INTERIOR content (width w-2). */
  function wrap(w, h, border, rows, holes = []) {
    const inner = [];
    for (let y = 0; y < h - 2; y++) {
      let r = rows[y] || "";
      r = (r + ".".repeat(w - 2)).slice(0, w - 2);
      inner.push(r);
    }
    let out = [border.repeat(w), ...inner.map((r) => border + r + border), border.repeat(w)];
    for (const hole of holes) {
      const row = out[hole.y];
      out[hole.y] = row.slice(0, hole.x) + (hole.c || "P") + row.slice(hole.x + 1);
    }
    return out;
  }

  const ROOMS = {};

  /* ================= DUSKHOLLOW VILLAGE (40x26) ================= */
  ROOMS.village = {
    id: "village", name: "Duskhollow", biome: "village",
    map: wrap(40, 26, "T", [
      /* y1  */ "",
      /* y2  */ ".f...................................f",
      /* y3  */ "...RRRRRRR.....RRRRRRR.....RRRRRRRR",
      /* y4  */ "...RRRRRRR.....RRRRRRR.....RRRRRRRR",
      /* y5  */ "...HHHDHHH.....HHHDHHH.....RRRRRRRR",
      /* y6  */ "......P...........P........HHHDHHHH",
      /* y7  */ "......P...........P...........P",
      /* y8  */ "..f...P...........P...........P....f",
      /* y9  */ "......PPPPPPPPPPPPPPPPPPPPPPPPP",
      /* y10 */ "......P.tt....L.......L....tt..P",
      /* y11 */ "......P.......PPPPPPPPP.......P",
      /* y12 */ "......P.....w.P...b...P.O.....P",
      /* y13 */ "......P.......PPPPPPPPP.......P",
      /* y14 */ "......P.tt....L.......L....tt..P",
      /* y15 */ "..................PP..........FFFF",
      /* y16 */ "..SSS.............PP..........Ffff",
      /* y17 */ ".SWWWS............PP..........FFFF",
      /* y18 */ ".SWWWS............PP.........tt",
      /* y19 */ "..SWWS............PP........t..t",
      /* y20 */ "...SS..............PP",
      /* y21 */ ".....f.............PP......f",
      /* y22 */ "...................PP.........tt",
      /* y23 */ "...................PP",
      /* y24 */ "...................PP",
    ], [{ x: 20, y: 25, c: "P" }, { x: 21, y: 25, c: "P" }]),
    spawn: { x: 20, y: 8 },
    exits: [
      { gx: 20, gy: 25, to: "vale", toSpawn: { x: 23, y: 2 } },
      { gx: 21, gy: 25, to: "vale", toSpawn: { x: 24, y: 2 } },
      { gx: 7, gy: 5, to: "maren", toSpawn: { x: 8, y: 9 } },
      { gx: 19, gy: 5, to: "shop", toSpawn: { x: 8, y: 9 } },
      { gx: 31, gy: 6, to: "inn", toSpawn: { x: 8, y: 9 } },
    ],
    enemies: [],
    npcs: ["pip", "el", "vey", "maren_plaza"],
    pickups: [
      { x: 8, y: 19, type: "cosmetic", slot: 0 }, { x: 21, y: 11, type: "cosmetic", slot: 1 },
      { x: 30, y: 21, type: "cosmetic", slot: 2 }, { x: 18, y: 12, type: "cosmetic", slot: 3 },
    ],
    hint: "Duskhollow, at evensong. Your grandmother is waiting inside.",
  };

  /* ================= INTERIORS (18x12) ================= */
  ROOMS.maren = {
    id: "maren", name: "Maren's Cottage", biome: "interior",
    map: wrap(18, 12, "H", [
      "~~....######....",
      "......##...#....",
      "......##...#....",
      "......######....",
      "....t...........",
      "................",
      "................",
      "......f.........",
      "................",
      "................",
    ], [{ x: 8, y: 11, c: "D" }]),
    spawn: { x: 8, y: 9 },
    exits: [{ gx: 8, gy: 11, to: "village", toSpawn: { x: 7, y: 7 } }],
    npcs: ["maren"],
    pickups: [
      { x: 4, y: 6, type: "cosmetic", slot: 4 },
      { x: 9, y: 2, type: "ember", value: 5 },
      { x: 10, y: 2, type: "ember", value: 5 },
      { x: 9, y: 3, type: "soul", value: 4 },
      { x: 10, y: 3, type: "soul", value: 4 },
    ],
    starterCache: {
      outsideGate: { gx: 1, gy: 1 },
      insideGate: { gx: 8, gy: 2 },
      loot: { embers: 10, vesperSouls: 8 },
    },
    hint: "The hearth is warm. Maren has something for you.",
  };
  ROOMS.shop = {
    id: "shop", name: "Bram's Forge & Goods", biome: "interior",
    map: wrap(18, 12, "H", [
      "==......==",
      "",
      "..===...",
      "",
      "",
      "",
      "",
      "",
      "",
    ], [{ x: 8, y: 11, c: "D" }]),
    spawn: { x: 8, y: 9 },
    exits: [{ gx: 8, gy: 11, to: "village", toSpawn: { x: 19, y: 7 } }],
    npcs: ["bram"],
    pickups: [{ x: 8, y: 4, type: "cosmetic", slot: 5 }],
    hint: "Bram trades in embers. Talk to browse his stock.",
  };
  ROOMS.inn = {
    id: "inn", name: "The Latched Lantern", biome: "interior",
    map: wrap(18, 12, "H", [
      "LL......LL",
      "",
      "...==.==",
      "",
      "",
      "",
      "",
      "",
      "",
    ], [{ x: 8, y: 11, c: "D" }]),
    spawn: { x: 8, y: 9 },
    exits: [{ gx: 8, gy: 11, to: "village", toSpawn: { x: 31, y: 8 } }],
    npcs: ["odile"],
    pickups: [{ x: 8, y: 4, type: "cosmetic", slot: 6 }],
    hint: "Odile keeps the inn — and every rumour in Duskhollow.",
  };

  /* ================= VESPER VALE (48x28) ================= */
  ROOMS.vale = {
    id: "vale", name: "Vesper Vale", biome: "vale",
    map: wrap(48, 28, "T", [
      /* y1  */ ".....................PPPP",
      /* y2  */ ".t...................PPPP..............T.T.T",
      /* y3  */ "..tt.................P.P..............T.f.T",
      /* y4  */ "......................P...............T.T.T.T",
      /* y5  */ ".ttt..................P..................f",
      /* y6  */ "......................P...............T.T.T",
      /* y7  */ "...........WWWWWW.....P................f...T",
      /* y8  */ "..........WWWWWWWW....P..............T.T.T.T",
      /* y9  */ ".........WWW....WWW...P",
      /* y10 */ ".........WW......WW...PPPPPP",
      /* y11 */ ".........WW..S...WWWBBBW...P.....t.t",
      /* y12 */ ".........WWW.....WWWBBBW...P....tt.tt",
      /* y13 */ "..........WWWWWWWWW........P",
      /* y14 */ "...........WWWWWWW.........PPPPPPPPPPPPPPPPPPP",
      /* y15 */ "...........WWWWW...........P",
      /* y16 */ "....##.....................P........t..t",
      /* y17 */ "....#.#####................P",
      /* y18 */ "....#.....#...............PP......tt",
      /* y19 */ "....#####.#..............PP",
      /* y20 */ "........#.#...........PPP",
      /* y21 */ "....^...###...........P........t.t",
      /* y22 */ "......................P.........tt",
      /* y23 */ ".t.t..................P",
      /* y24 */ "..tt..................P",
      /* y25 */ ".......f..............P........f",
      /* y26 */ "",
    ], [
      { x: 22, y: 0, c: "P" }, { x: 23, y: 0, c: "P" }, { x: 24, y: 0, c: "P" }, { x: 25, y: 0, c: "P" },
      { x: 0, y: 14, c: "D" },
      { x: 47, y: 14, c: "P" }, { x: 47, y: 15, c: "P" },
    ]),
    spawn: { x: 23, y: 2 },
    exits: [
      { gx: 22, gy: 0, to: "village", toSpawn: { x: 20, y: 23 } },
      { gx: 23, gy: 0, to: "village", toSpawn: { x: 20, y: 23 } },
      { gx: 24, gy: 0, to: "village", toSpawn: { x: 21, y: 23 } },
      { gx: 25, gy: 0, to: "village", toSpawn: { x: 21, y: 23 } },
      { gx: 0, gy: 14, to: "hollow1", toSpawn: { x: 30, y: 11 } },
      { gx: 47, gy: 14, to: "lake", toSpawn: { x: 2, y: 13 } },
      { gx: 47, gy: 15, to: "lake", toSpawn: { x: 2, y: 14 } },
    ],
    enemies: [
      { type: "wolf", x: 38, y: 3, tag: "q_wolves" }, { type: "wolf", x: 42, y: 5, tag: "q_wolves" },
      { type: "wolf", x: 39, y: 7, tag: "q_wolves" }, { type: "wolf", x: 43, y: 3, tag: "q_wolves" },
      { type: "wolf", x: 33, y: 20 }, { type: "wolf", x: 36, y: 23 },
    ],
    pickups: [
      { x: 6, y: 18, type: "quest", id: "lantern" },
      { x: 21, y: 11, type: "pulse" },
      { x: 38, y: 3, type: "cosmetic", slot: 7 }, { x: 42, y: 5, type: "cosmetic", slot: 8 },
      { x: 39, y: 7, type: "cosmetic", slot: 9 }, { x: 43, y: 3, type: "cosmetic", slot: 10 },
      { x: 33, y: 20, type: "cosmetic", slot: 11 },
    ],
    hint: "The orchard lies northeast. Old liminal ruins stand south of the water.",
  };

  /* ================= LAKE OF SAINT-GLASS (40x26) ================= */
  ROOMS.lake = {
    id: "lake", name: "Lake of Saint-Glass", biome: "lake",
    map: wrap(40, 26, "T", [
      /* y1  */ "",
      /* y2  */ "..t.....SSSSS",
      /* y3  */ ".......SSWWWSS..........t",
      /* y4  */ "......SWWWWWWWSS",
      /* y5  */ ".....SWWWWWWWWWWS.....SSSS",
      /* y6  */ "....SWWWWWWWWWWWWSSSSSWWWWS",
      /* y7  */ "....SWWWWWWWWWWWWWWWWWWWWWWS",
      /* y8  */ "...SWWWWWW###WWWWWWWWWWWWWWWS",
      /* y9  */ "...SWWWWW#...#WWWWWWWWWWWWWWS",
      /* y10 */ "...SWWWWW..D..WWWWWWWWWWWWWWS..#",
      /* y11 */ "...SWWWWW#...#WWWWWWWWWWWWWSS",
      /* y12 */ "...SWWWWWW#S#WWWWWWWWWWWWWSS",
      /* y13 */ "...SWWWWWWWSWWWWWWWWWWWWWSS",
      /* y14 */ "....SWWWWWWWWWWWWWWWWWWSSS",
      /* y15 */ "....SSWWWWWWWWWWWWWWWSSS......S",
      /* y16 */ "..#...SSWWWWWWWWWWWSSS.......SWS",
      /* y17 */ "......BBSSWWWWWWWSSS.........SWS",
      /* y18 */ "......B..SSSSSSSSS............S",
      /* y19 */ "......B",
      /* y20 */ "......B.....t.tt",
      /* y21 */ "..f...B..........f",
      /* y22 */ ".....tt",
      /* y23 */ ".t",
      /* y24 */ "",
    ], [{ x: 0, y: 13, c: "P" }, { x: 0, y: 14, c: "P" }]),
    spawn: { x: 2, y: 13 },
    exits: [
      { gx: 0, gy: 13, to: "vale", toSpawn: { x: 45, y: 14 } },
      { gx: 0, gy: 14, to: "vale", toSpawn: { x: 45, y: 15 } },
      { gx: 12, gy: 10, to: "ossuary1", toSpawn: { x: 17, y: 19 } },
    ],
    enemies: [{ type: "wolf", x: 12, y: 21 }, { type: "leech", x: 30, y: 20 }],
    pickups: [
      { x: 30, y: 17, type: "cosmetic", slot: 12 }, { x: 12, y: 21, type: "cosmetic", slot: 13 },
      { x: 30, y: 20, type: "cosmetic", slot: 14 },
    ],
    hint: "The Ossuary stair rises from the island. Liminal pillars answer the Hand across water.",
  };

  /* ================= THE HOLLOW GEOMETRY ================= */
  ROOMS.hollow1 = {
    id: "hollow1", name: "The Hollow Geometry — Outer Measure", biome: "dungeon",
    map: wrap(34, 22, "=", [
      /* y1  */ "~..X.........................X.",
      /* y2  */ "...X..######......######......X",
      /* y3  */ "...X..#....#......#....#",
      /* y4  */ "......#....#......#....#",
      /* y5  */ "...####....########....####",
      /* y6  */ "",
      /* y7  */ "......X..........X",
      /* y8  */ "...^..X....##....X....^",
      /* y9  */ "......X....##....X",
      /* y10 */ "..######........######..######",
      /* y11 */ "",
      /* y12 */ "..######........######..######",
      /* y13 */ "......X..........X",
      /* y14 */ "...^..X....##....X....^",
      /* y15 */ "......X....##....X",
      /* y16 */ "...X..######......######......X",
      /* y17 */ "...X..#....#......#....#......X",
      /* y18 */ "...X..#....#......#....#....~",
      /* y19 */ "",
    ], [{ x: 33, y: 11, c: "D" }, { x: 17, y: 21, c: "D" }]),
    spawn: { x: 30, y: 11 },
    exits: [
      { gx: 33, gy: 11, to: "vale", toSpawn: { x: 2, y: 14 } },
      { gx: 17, gy: 21, to: "hollow2", toSpawn: { x: 15, y: 19 }, needBells: 2, needClear: true },
    ],
    enemies: [
      { type: "guard", x: 10, y: 7 }, { type: "guard", x: 22, y: 15 }, { type: "guard", x: 8, y: 18 },
      { type: "leech", x: 15, y: 4 }, { type: "leech", x: 20, y: 18 },
    ],
    pickups: [
      { x: 4, y: 4, type: "cosmetic", slot: 15 }, { x: 10, y: 7, type: "cosmetic", slot: 16 },
      { x: 22, y: 15, type: "cosmetic", slot: 17 }, { x: 8, y: 18, type: "cosmetic", slot: 18 },
      { x: 15, y: 4, type: "cosmetic", slot: 19 },
    ],
    bells: [{ gx: 1, gy: 1 }, { gx: 29, gy: 18 }],
    resonanceRecovery: {
      id: "outer_measure_resonance",
      gx: 17,
      gy: 11,
      radius: 20,
      awakenWhenEnemiesCleared: true,
      requiredUntil: { kind: "bells", count: 2 },
      firstBanner: "THE BRASS OFFERS A HAND",
      lesson: "The etched bells will answer touch or shot while the road is sealed.",
    },
    progressionObjectives: [{
      id: "outer_measure_bells",
      label: "Ring both etched bells",
      requiredInteractions: ["ring_brass"],
      requiredAbilities: ["ranged_activation"],
      requiredResources: ["full_health_beam"],
      requiredPlayerState: ["alive", "post_combat_clear"],
      requiredWorldObjects: ["bell:hollow1:0", "bell:hollow1:1", "exit:hollow2"],
      requiredEnemyState: "clear",
      completionConditions: ["bells:hollow1:2", "exit:hollow2:unlocked"],
      alternateCompletionMethods: ["direct_bell_interaction", "resonance_recovery_activation"],
      recoveryMethods: ["outer_measure_resonance", "minimum_progress_shot"],
    }],
    persistClear: true,
    clearFlag: "clear_hollow1",
    clearBanner: "THE OUTER MEASURE FALLS QUIET",
    postClearHint: "The threats are gone. Ring the two etched brass bells, then follow the open door south.",
    solvedHint: "Both bells answer. The south door opens into the Resonant Crossing.",
    hint: "Two bells hang silent behind null iron. Ring both, and the Bellmother's door will open.",
  };

  ROOMS.hollow2 = {
    id: "hollow2", name: "The Resonant Crossing", biome: "dungeon",
    map: wrap(32, 22, "=", [
      /* y1  */ "..............................",
      /* y2  */ "...~..........##..........~...",
      /* y3  */ "...#......................#...",
      /* y4  */ "...#.....XXXX....XXXX.....#...",
      /* y5  */ ".........#..........#.........",
      /* y6  */ ".........#..........#.........",
      /* y7  */ "...######............######...",
      /* y8  */ "..............................",
      /* y9  */ "......^................^......",
      /* y10 */ "..........##......##..........",
      /* y11 */ "..........##......##..........",
      /* y12 */ "..............~...............",
      /* y13 */ "..............................",
      /* y14 */ "...######............######...",
      /* y15 */ ".........#..........#.........",
      /* y16 */ ".........#..........#.........",
      /* y17 */ "...#.....XXXX....XXXX.....#...",
      /* y18 */ "...#......................#...",
      /* y19 */ "..............................",
      /* y20 */ "..............................",
    ], [{ x: 15, y: 0, c: "D" }, { x: 15, y: 21, c: "D" }]),
    spawn: { x: 15, y: 19 },
    exits: [
      { gx: 15, gy: 21, to: "hollow1", toSpawn: { x: 17, y: 19 } },
      { gx: 15, gy: 0, to: "hollowboss", toSpawn: { x: 13, y: 2 }, needSequence: true, needClear: true },
    ],
    enemies: [
      { type: "guard", x: 8, y: 8 }, { type: "guard", x: 23, y: 8 },
      { type: "leech", x: 11, y: 15 }, { type: "leech", x: 20, y: 15 },
      { type: "guard", x: 15, y: 6 },
    ],
    pickups: [
      { x: 8, y: 8, type: "cosmetic", slot: 24 }, { x: 23, y: 8, type: "cosmetic", slot: 25 },
    ],
    bells: [{ gx: 4, gy: 2 }, { gx: 27, gy: 2 }, { gx: 15, gy: 12 }],
    bellSequence: [0, 2, 1],
    resonanceRecovery: {
      id: "crossing_resonance",
      gx: 15,
      gy: 10,
      radius: 20,
      awakenWhenEnemiesCleared: true,
      requiredUntil: { kind: "sequence" },
      firstBanner: "THE CROSSING KEEPS THE BEAT",
      lesson: "The numbered bells can be touched when the Hand cannot fire.",
    },
    progressionObjectives: [{
      id: "crossing_chord",
      label: "Ring the three etched bells in order",
      requiredInteractions: ["ring_brass_sequence"],
      requiredAbilities: ["ranged_activation"],
      requiredResources: ["full_health_beam"],
      requiredPlayerState: ["alive", "post_combat_clear"],
      requiredWorldObjects: ["bell:hollow2:0", "bell:hollow2:1", "bell:hollow2:2", "exit:hollowboss"],
      requiredEnemyState: "clear",
      completionConditions: ["sequence:hollow2:complete", "exit:hollowboss:unlocked"],
      alternateCompletionMethods: ["direct_bell_interaction", "resonance_recovery_activation"],
      recoveryMethods: ["crossing_resonance", "minimum_progress_shot"],
    }],
    persistClear: true,
    clearFlag: "clear_hollow2",
    clearBanner: "THE CROSSING CAN HEAR YOU",
    postClearHint: "The wardens are still. Strike the bells in the order of their etched marks: one, two, three.",
    solvedHint: "The chord is whole. The north door opens to the Bronze Choirloft.",
    hint: "Survive the Crossing. Its three bells will not hold a chord while the wardens still move.",
  };

  ROOMS.hollowboss = {
    id: "hollowboss", name: "The Bronze Choirloft", biome: "dungeon",
    map: wrap(26, 18, "=", [
      /* y1  */ "",
      /* y2  */ "...##..............##",
      /* y3  */ "...##..............##",
      /* y4  */ "",
      /* y5  */ "",
      /* y6  */ "......~........~",
      /* y7  */ "",
      /* y8  */ "",
      /* y9  */ "",
      /* y10 */ "......~........~",
      /* y11 */ "",
      /* y12 */ "",
      /* y13 */ "...##..............##",
      /* y14 */ "...##..............##",
      /* y15 */ "",
    ], [{ x: 13, y: 0, c: "D" }, { x: 13, y: 17, c: "D" }]),
    spawn: { x: 13, y: 2 },
    exits: [
      { gx: 13, gy: 0, to: "hollow2", toSpawn: { x: 15, y: 3 } },
      { gx: 13, gy: 17, to: "bronzeheart", toSpawn: { x: 11, y: 2 }, needFlag: "bellmotherSilenced" },
    ],
    boss: { type: "bellmother", x: 13, y: 8 },
    bossClearFlag: "bellmotherSilenced",
    clearBanner: "THE BRONZE DOOR WAKES",
    postClearHint: "The Bellmother is still. Follow the white-gold door south and return the village's voice.",
    hint: "BELLMOTHER, THE SAINT BENEATH THE BRONZE. Gates carry her ring back to her.",
  };

  ROOMS.bronzeheart = {
    id: "bronzeheart", name: "The Heart of Bronze", biome: "dungeon",
    map: wrap(22, 16, "=", [
      "....................",
      "....##........##....",
      "....##........##....",
      "....................",
      "........~..~........",
      ".......~....~.......",
      ".......~....~.......",
      "........~~~~........",
      "....................",
      "....##........##....",
      "....##........##....",
      "....................",
      "....................",
      "....................",
    ], [{ x: 11, y: 0, c: "D" }, { x: 11, y: 15, c: "D" }]),
    spawn: { x: 11, y: 2 },
    exits: [
      { gx: 11, gy: 0, to: "hollowboss", toSpawn: { x: 13, y: 15 } },
      { gx: 11, gy: 15, to: "vale", toSpawn: { x: 2, y: 14 }, needFlag: "bronzeRestored", oneWay: true },
    ],
    sanctum: {
      id: "bronze_memory", gx: 11, gy: 7,
      requiresFlag: "bellmotherSilenced", completeFlag: "bronzeRestored", scene: "bronze_restoration",
    },
    hint: "The stolen village voice waits inside the memory bell. Touch it and carry the toll home.",
    restoredHint: "The village bell is whole. The south gate is a direct road back to the Vale.",
  };

  /* ================= THE GLASS OSSUARY ================= */
  ROOMS.ossuary1 = {
    id: "ossuary1", name: "The Glass Ossuary — Memory Nave", biome: "ossuary",
    map: wrap(34, 22, "M", [
      /* y1  */ "",
      /* y2  */ "...GG........MM........GG",
      /* y3  */ "...GG........MM........GG",
      /* y4  */ "",
      /* y5  */ ".........M........M",
      /* y6  */ ".........M...X....M",
      /* y7  */ ".........M........M",
      /* y8  */ "",
      /* y9  */ "...MM..................MM",
      /* y10 */ "...MM.......GGGG.......MM",
      /* y11 */ "...MM.......GGGG.......MM",
      /* y12 */ "...MM..................MM",
      /* y13 */ "",
      /* y14 */ ".........M........M",
      /* y15 */ ".........M........M",
      /* y16 */ "",
      /* y17 */ "...GG........MM........GG",
      /* y18 */ "...GG........MM........GG",
      /* y19 */ "",
    ], [{ x: 17, y: 21, c: "D" }, { x: 16, y: 0, c: "D" }]),
    spawn: { x: 17, y: 19 },
    exits: [
      { gx: 17, gy: 21, to: "lake", toSpawn: { x: 12, y: 11 } },
      { gx: 16, gy: 0, to: "ossuary2", toSpawn: { x: 17, y: 20 }, needSigil: true, needClear: true },
    ],
    enemies: [
      { type: "mourner", x: 8, y: 6 }, { type: "mourner", x: 25, y: 6 },
      { type: "mourner", x: 16, y: 13 }, { type: "guard", x: 26, y: 15 },
    ],
    wholenessRecovery: {
      id: "glass_memory_font",
      gx: 17, gy: 11,
      radius: 18,
      awakenWhenEnemiesCleared: true,
      requiredUntilFlag: "sigil_ossuary1",
      clearsRoomEnemies: true,
      firstBanner: "THE GLASS REMEMBERS",
      lesson: "The Hand answers only while the bearer is whole.",
    },
    pickups: [
      { x: 8, y: 6, type: "cosmetic", slot: 20 }, { x: 25, y: 6, type: "cosmetic", slot: 21 },
      { x: 16, y: 13, type: "cosmetic", slot: 22 }, { x: 26, y: 15, type: "cosmetic", slot: 23 },
    ],
    sigil: { gx: 14, gy: 6 },
    progressionObjectives: [{
      id: "memory_nave_sigil",
      label: "Bank a whole beam into the marked sigil",
      requiredInteractions: ["banked_or_folded_beam"],
      requiredAbilities: ["ranged_activation", "reflection"],
      requiredResources: ["full_health_beam"],
      requiredPlayerState: ["alive", "whole"],
      requiredWorldObjects: ["sigil:ossuary1", "recovery:glass_memory_font", "exit:ossuary2"],
      requiredEnemyState: "clear",
      completionConditions: ["sigil:ossuary1:lit", "exit:ossuary2:unlocked"],
      alternateCompletionMethods: ["wholeness_recovery_font"],
      recoveryMethods: ["glass_memory_font"],
    }],
    persistClear: true,
    clearFlag: "clear_ossuary1",
    clearBanner: "THE MEMORY FONT AWAKENS",
    postClearHint: "The font at the room's center restores wholeness. Then bank a full-health beam into the marked sigil.",
    solvedHint: "The sigil answers. Follow the open north door into the Mirror Processional.",
    hint: "The sigil on null iron only answers a shot that has already touched a mirror.",
  };

  ROOMS.ossuary2 = {
    id: "ossuary2", name: "The Mirror Processional", biome: "ossuary",
    map: wrap(34, 22, "M", [
      /* y1  */ "................................",
      /* y2  */ "....M..........GG..........M....",
      /* y3  */ "....M......................M....",
      /* y4  */ "....M....MM..........MM....M....",
      /* y5  */ ".........MM....X.....MM.........",
      /* y6  */ "...............X................",
      /* y7  */ "...GG......................GG...",
      /* y8  */ "...GG......M..........M....GG...",
      /* y9  */ "...........M..........M.........",
      /* y10 */ "...........M..........M.........",
      /* y11 */ "...............X................",
      /* y12 */ "...............X................",
      /* y13 */ "...GG......M..........M....GG...",
      /* y14 */ "...GG......M..........M....GG...",
      /* y15 */ ".........MM....X.....MM.........",
      /* y16 */ "....M....MM....X.....MM....M....",
      /* y17 */ "....M......................M....",
      /* y18 */ "....M..........GG..........M....",
      /* y19 */ "...............GG...............",
      /* y20 */ "................................",
    ], [{ x: 16, y: 0, c: "D" }, { x: 17, y: 21, c: "D" }]),
    spawn: { x: 17, y: 20 },
    exits: [
      { gx: 17, gy: 21, to: "ossuary1", toSpawn: { x: 16, y: 2 } },
      { gx: 16, gy: 0, to: "ossuaryboss", toSpawn: { x: 13, y: 15 }, needRelays: 3, needClear: true },
    ],
    enemies: [
      { type: "mourner", x: 7, y: 7 }, { type: "mourner", x: 26, y: 7 },
      { type: "guard", x: 10, y: 15 }, { type: "guard", x: 23, y: 15 },
      { type: "leech", x: 17, y: 10 },
    ],
    mirrorRelays: [
      { id: "crown", gx: 16, gy: 5 },
      { id: "choir", gx: 16, gy: 11 },
      { id: "root", gx: 16, gy: 15 },
    ],
    wholenessRecovery: {
      id: "processional_font",
      gx: 18, gy: 18,
      radius: 18,
      awakenWhenEnemiesCleared: true,
      requiredUntilFlag: "relays_ossuary2_done",
      clearsRoomEnemies: true,
      firstBanner: "THE PROCESSIONAL REMEMBERS",
      lesson: "Three reflections must carry one whole beam onward.",
    },
    pickups: [
      { x: 7, y: 7, type: "cosmetic", slot: 26 }, { x: 26, y: 7, type: "cosmetic", slot: 27 },
    ],
    persistClear: true,
    progressionObjectives: [{
      id: "processional_relays",
      label: "Light all three mirror relays",
      requiredInteractions: ["banked_or_folded_beam"],
      requiredAbilities: ["ranged_activation", "reflection"],
      requiredResources: ["full_health_beam"],
      requiredPlayerState: ["alive", "whole"],
      requiredWorldObjects: ["relay:ossuary2:crown", "relay:ossuary2:choir", "relay:ossuary2:root", "recovery:processional_font", "exit:ossuaryboss"],
      requiredEnemyState: "clear",
      completionConditions: ["relays:ossuary2:3", "exit:ossuaryboss:unlocked"],
      alternateCompletionMethods: ["wholeness_recovery_font"],
      recoveryMethods: ["processional_font"],
    }],
    clearFlag: "clear_ossuary2",
    clearBanner: "THE PROCESSIONAL IS YOURS",
    postClearHint: "Restore wholeness at the south font. Bank beams into all three marked relays along the central spine.",
    solvedHint: "All three memories burn. The north door opens to the Choir of Glass.",
    hint: "Clear the Processional. Its central relays only remember beams that arrive by reflection or linked gate.",
  };

  ROOMS.ossuaryboss = {
    id: "ossuaryboss", name: "The Choir of Glass", biome: "ossuary",
    map: wrap(26, 18, "M", [
      /* y1  */ "",
      /* y2  */ "....M...........M",
      /* y3  */ "",
      /* y4  */ "........GGG",
      /* y5  */ "",
      /* y6  */ "..M.................M",
      /* y7  */ "",
      /* y8  */ "",
      /* y9  */ "",
      /* y10 */ "..M.................M",
      /* y11 */ "",
      /* y12 */ "........GGG",
      /* y13 */ "",
      /* y14 */ "....M...........M",
      /* y15 */ "",
    ], [{ x: 13, y: 0, c: "D" }, { x: 13, y: 17, c: "D" }]),
    spawn: { x: 13, y: 15 },
    exits: [
      { gx: 13, gy: 17, to: "ossuary2", toSpawn: { x: 17, y: 3 } },
      { gx: 13, gy: 0, to: "glassheart", toSpawn: { x: 11, y: 13 }, needFlag: "glassDone" },
    ],
    enemies: [
      { type: "mourner", x: 7, y: 5, elite: true, tag: "choir" },
      { type: "mourner", x: 19, y: 5, elite: true, tag: "choir" },
      { type: "mourner", x: 13, y: 9, elite: true, tag: "choir" },
    ],
    choir: true,
    clearFlag: "glassDone",
    clearBanner: "THE CHOIR BREAKS",
    postClearHint: "The litany is silent. The white-gold door north leads deeper, into the Heart of Glass.",
    hint: "Three mourners share one litany. Silence all three.",
  };

  ROOMS.glassheart = {
    id: "glassheart", name: "The Heart of Glass", biome: "ossuary",
    map: wrap(22, 16, "M", [
      "....................",
      "....GG........GG....",
      "....GG........GG....",
      "....................",
      "........M..M........",
      ".......M....M.......",
      ".......M....M.......",
      "........M..M........",
      "....................",
      "....GG........GG....",
      "....GG........GG....",
      "....................",
      "....................",
      "....................",
    ], [{ x: 11, y: 0, c: "D" }, { x: 11, y: 15, c: "D" }]),
    spawn: { x: 11, y: 13 },
    exits: [
      { gx: 11, gy: 15, to: "ossuaryboss", toSpawn: { x: 13, y: 2 } },
      { gx: 11, gy: 0, to: "lake", toSpawn: { x: 12, y: 11 }, needFlag: "glassRestored", oneWay: true },
    ],
    sanctum: {
      id: "glass_memory", gx: 11, gy: 7,
      requiresFlag: "glassDone", completeFlag: "glassRestored", scene: "glass_restoration",
    },
    hint: "The lake's stolen memory waits in the saint-glass font. Return it to the water above.",
    restoredHint: "The lake remembers its own reflection. The north gate rises directly to the island.",
  };

  /* ================= DATA: NPCs, quests, shop ================= */
  const NPCS = {
    maren: {
      id: "maren", name: "Maren", title: "the last bearer", room: "maren", x: 5, y: 3,
      body: "#7a5a80", trim: "#e8dcf0",
    },
    maren_plaza: {
      id: "maren_plaza", name: "Maren", title: "the last bearer", room: "village", x: 18, y: 12,
      body: "#7a5a80", trim: "#e8dcf0", showFlag: "bellRestored",
    },
    bram: { id: "bram", name: "Bram", title: "smith & shopkeep", room: "shop", x: 8, y: 4, body: "#8a5a30", trim: "#ffcf6b", shop: true },
    odile: { id: "odile", name: "Odile", title: "innkeeper", room: "inn", x: 8, y: 4, body: "#4a6a8a", trim: "#c9e6ff" },
    pip: { id: "pip", name: "Pip", title: "wants to be you", room: "village", x: 8, y: 19, body: "#5a8a4a", trim: "#d0ffc0", small: true },
    el: { id: "el", name: "Sexton El", title: "keeper of the bell", room: "village", x: 21, y: 11, body: "#6a6a7a", trim: "#e0e0f0" },
    vey: { id: "vey", name: "Vey", title: "traveling merchant", room: "village", x: 30, y: 21, body: "#8a4a6a", trim: "#ffb0d8" },
  };

  const QUESTS = {
    q_hand: { id: "q_hand", title: "The Handing Down", desc: "Speak with Maren. The Hand has chosen its next bearer.", reward: 0 },
    q_wolves: { id: "q_wolves", title: "Wolves in the Orchard", desc: "Shard-wolves have taken the orchard in Vesper Vale. Clear all four.", reward: 40, count: 4 },
    q_lantern: { id: "q_lantern", title: "Pip's Lantern", desc: "Pip lost the festival lantern in the old liminal ruins. Only gates open that chamber.", reward: 25 },
    q_bell: { id: "q_bell", title: "The Silent Bell", desc: "The village bell lost its voice when the Bellmother took it below. Bring it back from the Hollow Geometry, west of the Vale.", reward: 80 },
    q_glass: { id: "q_glass", title: "The Glass Below", desc: "Something in the Ossuary under the lake is singing Duskhollow's grief back at it. Silence the Choir of Glass.", reward: 100 },
    q_evensong: { id: "q_evensong", title: "Evensong", desc: "Both voices are home. Ring the village bell and let Duskhollow hear evensong again.", reward: 0 },
  };

  /* dialogue: ordered rules; first match wins.
   * when: questActive/questDone/notQuestDone/flag/notFlag (all must hold)
   * do:   accept/complete quest ids, shop, scene            */
  const DIALOG = {
    maren: [
      { when: { notFlag: "hasHand" }, scene: "handing" },
      { when: { questDone: "q_bell", questDoneB: "q_glass", notQuestDone: "q_evensong" },
        pages: ["Both voices home. My mother rang evensong the night she handed the Hand to me.", "Go to the bell, little bearer. Duskhollow is listening."],
        do: { accept: "q_evensong" } },
      { when: { flag: "bellRestored" }, pages: ["I can hear it again at dusk. You wear the Hand better than I ever did."] },
      { pages: ["Seven bearers before you, and every one of them walked out that door scared.", "Gates open where the stone remembers being a door. Liminal stone, bell-brass, saint-glass. Never null iron.", "Go and be the eighth. The Vale is south."] },
    ],
    maren_plaza: [
      { when: { questDone: "q_bell", questDoneB: "q_glass", notQuestDone: "q_evensong" },
        pages: ["Both voices home. My mother rang evensong the night she handed the Hand to me.", "Go to the bell, little bearer. Duskhollow is listening."],
        do: { accept: "q_evensong" } },
      { when: { questActive: "q_evensong" }, pages: ["Ring it. I'll be right here."] },
      { pages: ["Evensong sounds different from the plaza. Better."] },
    ],
    bram: [
      { pages: ["Embers for goods, goods for embers. That's the whole religion of this forge."], do: { shop: true } },
    ],
    odile: [
      { when: { notQuestDone: "q_glass", questDone: "q_bell" }, pages: ["Bell's back — but the lake's wrong now. Fisher swears the water sings back at her.", "There's an old stair under the island. Vey knows more than he charges for."] },
      { when: { flag: "bellRestored" }, pages: ["First evensong in a year coming, I can feel it. Room's on the house if you ring it."] },
      { pages: ["A silent bell makes for quiet business. Nobody lingers where dusk has no voice."] },
    ],
    pip: [
      { when: { questActive: "q_lantern", flag: "lantern" }, pages: ["THE LANTERN! You actually went into the ruins?! With the folding and the— teach me. Someday. Please."], do: { complete: "q_lantern" } },
      { when: { questActive: "q_lantern" }, pages: ["I dropped it in the old ruins south of the stream. The sealed room. Don't tell Maren I was in there."] },
      { when: { notQuestDone: "q_lantern", flag: "hasHand" }, pages: ["You got the HAND?! Show me a gate. No wait — my lantern first. I lost the festival lantern in the vale ruins…"], do: { accept: "q_lantern" } },
      { pages: ["When I grow up I'm going to have a portal arm too. Two of them."] },
    ],
    el: [
      { when: { questActive: "q_bell" }, pages: ["The door under the Geometry only opens to both bells. Ring the brass behind the iron — your gates can go where you can't."] },
      { when: { notQuestDone: "q_bell", flag: "hasHand" }, pages: ["A year now since the bell went silent. The Bellmother took its voice down into the Hollow Geometry, west of the Vale.", "Bring it home, bearer. Dusk isn't dusk without it."], do: { accept: "q_bell" } },
      { when: { questDone: "q_bell", notQuestDone: "q_glass" }, pages: ["Every dusk it rings true again. Thank you, bearer."] },
      { pages: ["Evensong at last. The rope remembers my hands."] },
    ],
    vey: [
      { when: { questDone: "q_bell", notQuestDone: "q_glass" }, pages: ["Word travels. Bell-slayer, hm? Then hear this for free: the Ossuary under the lake has started singing.", "Mirror-bone halls. Your shots will bank off them — and the deep door only answers a banked shot."], do: { accept: "q_glass" } },
      { when: { questDone: "q_glass" }, pages: ["The Choir is quiet and my routes are safe. You've made a merchant very rich, indirectly. My favourite way."] },
      { pages: ["I sell rumours, but the first one's free: this village used to RING, kid."] },
    ],
  };

  /* Presence system: at higher dread tiers, a dialogue attempt can surface
   * one of these instead of the real context-tracked line — flat, slightly
   * self-aware, never referencing quest state. Never repeats on the very
   * next visit to the same NPC (see talkTo() in game.js). Pure flavor: no
   * quest/flag effects ever come from a flat line. */
  const FLATLINES = {
    maren: ["...seven bearers before you.", "The door was always this color.", "You're back. You're always back."],
    maren_plaza: ["Evensong sounds different from the plaza. Better.", "The bell rings whether or not anyone rings it."],
    bram: ["Embers for goods, goods for embers.", "I don't remember when I opened this shop."],
    odile: ["A silent bell makes for quiet business.", "Nobody lingers where dusk has no voice. You shouldn't either."],
    pip: ["When I grow up I'm going to have a portal arm too.", "I dropped it in the old ruins. I always drop it."],
    el: ["The rope remembers my hands.", "I've been ringing this bell longer than the village has existed."],
    vey: ["I sell rumours, but the first one's free.", "You already bought this one from me. Didn't you?"],
  };

  const SHOP = [
    { id: "heart", name: "Heart Vessel", desc: "+1 max heart, fully healed", cost: 60, max: 3 },
    { id: "embercharm", name: "Soul Charm", desc: "Relic: Vesper Souls gained from kills +25%", cost: 40, relic: "embercharm" },
    { id: "swiftsoles", name: "Swift Soles", desc: "Relic: move 12% faster", cost: 50, relic: "swiftsoles" },
  ];

  const RELICS = {
    bellsigil: { id: "bellsigil", name: "Bell Sigil", desc: "Your strike rings brass and releases a small resonant pulse." },
    mirrorlitany: { id: "mirrorlitany", name: "Mirror Litany", desc: "Banked and deflected shots strike far harder and pierce." },
    embercharm: { id: "embercharm", name: "Soul Charm", desc: "Vesper Souls gained from kills +25%." },
    swiftsoles: { id: "swiftsoles", name: "Swift Soles", desc: "Move 12% faster." },
  };

  /* Cosmetics: 28 findable appearance items across 4 slots. Which physical
   * glint (see room `pickups` with type "cosmetic"/slot) grants which id is
   * decided by a per-playthrough shuffle (state.flags.cosmeticOrder) built
   * once in newGame() — every id is guaranteed reachable in one run, but
   * which glint gives which item differs each tale. */
  const COSMETICS = [
    { id: "cloak_bronze", cat: "cloak", name: "Bronze Vigil Cloak", outer: "#3a2418", inner: "#6a4428" },
    { id: "cloak_glass", cat: "cloak", name: "Glasslight Cloak", outer: "#1a2c38", inner: "#2c4a5a" },
    { id: "cloak_bramble", cat: "cloak", name: "Bramblewood Cloak", outer: "#1a2c1a", inner: "#2c4a2c" },
    { id: "cloak_ember", cat: "cloak", name: "Ember Rose Cloak", outer: "#3a1a26", inner: "#5a2c40" },
    { id: "cloak_iron", cat: "cloak", name: "Null Iron Cloak", outer: "#18181c", inner: "#2c2c34" },
    { id: "cloak_saintglass", cat: "cloak", name: "Saint-Glass Cloak", outer: "#16242e", inner: "#264458" },
    { id: "cloak_wolfshard", cat: "cloak", name: "Wolfshard Cloak", outer: "#24202c", inner: "#3c3450" },
    { id: "cloak_choir", cat: "cloak", name: "Choir White Cloak", outer: "#2a2a34", inner: "#585470" },
    { id: "glow_rose", cat: "glow", name: "Rose Vesper Glow", color: "#ff9ad0" },
    { id: "glow_bronze", cat: "glow", name: "Bronze Vesper Glow", color: "#ffb347" },
    { id: "glow_verdant", cat: "glow", name: "Verdant Vesper Glow", color: "#7dffb3" },
    { id: "glow_violet", cat: "glow", name: "Violet Vesper Glow", color: "#b389ff" },
    { id: "glow_ember", cat: "glow", name: "Ember Vesper Glow", color: "#ff6b4a" },
    { id: "glow_glass", cat: "glow", name: "Glass Vesper Glow", color: "#c9f0ff" },
    { id: "accessory_circlet", cat: "accessory", name: "Liminal Circlet", color: "#ffd166" },
    { id: "accessory_feather", cat: "accessory", name: "Raven Feather", color: "#2a2438" },
    { id: "accessory_veil", cat: "accessory", name: "Mourner's Veil", color: "#c9d6e8" },
    { id: "accessory_bellcharm", cat: "accessory", name: "Bell Charm", color: "#b8863a" },
    { id: "accessory_fang", cat: "accessory", name: "Wolf Fang", color: "#eaf2ff" },
    { id: "accessory_shard", cat: "accessory", name: "Saint-Glass Shard", color: "#8fe9ff" },
    { id: "trail_cinder", cat: "trail", name: "Cinder Trail", color: "#ffcf6b" },
    { id: "trail_frost", cat: "trail", name: "Frost Trail", color: "#8fe9ff" },
    { id: "trail_bloom", cat: "trail", name: "Bloom Trail", color: "#ff9ad0" },
    { id: "trail_umbral", cat: "trail", name: "Umbral Trail", color: "#9c8fff" },
    { id: "accessory_chord", cat: "accessory", name: "Three-Chord Pin", color: "#fff0c2" },
    { id: "accessory_memory", cat: "accessory", name: "Memory Prism", color: "#9deeff" },
    { id: "trail_resonance", cat: "trail", name: "Resonance Trail", color: "#e6b95a" },
    { id: "trail_processional", cat: "trail", name: "Processional Trail", color: "#b9dfff" },
  ];

  VG.ROOMS = ROOMS;
  VG.DATA = { NPCS, QUESTS, DIALOG, SHOP, RELICS, FLATLINES, COSMETICS };
})();
