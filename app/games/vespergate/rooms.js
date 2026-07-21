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
    hint: "Duskhollow, at evensong. Your grandmother is waiting inside.",
  };

  /* ================= INTERIORS (18x12) ================= */
  ROOMS.maren = {
    id: "maren", name: "Maren's Cottage", biome: "interior",
    map: wrap(18, 12, "H", [
      "~~....##",
      "",
      "..............f",
      "",
      "....t",
      "",
      "",
      "......f",
      "",
    ], [{ x: 8, y: 11, c: "D" }]),
    spawn: { x: 8, y: 9 },
    exits: [{ gx: 8, gy: 11, to: "village", toSpawn: { x: 7, y: 7 } }],
    npcs: ["maren"],
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
    pickups: [{ x: 30, y: 17, type: "ash" }],
    hint: "The Ossuary stair rises from the island. Liminal pillars answer the Hand across water.",
  };

  /* ================= THE HOLLOW GEOMETRY (34x22) ================= */
  ROOMS.hollow1 = {
    id: "hollow1", name: "The Hollow Geometry", biome: "dungeon",
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
      { gx: 17, gy: 21, to: "hollowboss", toSpawn: { x: 13, y: 2 }, needBells: 2 },
    ],
    enemies: [
      { type: "guard", x: 10, y: 7 }, { type: "guard", x: 22, y: 15 }, { type: "guard", x: 8, y: 18 },
      { type: "leech", x: 15, y: 4 }, { type: "leech", x: 20, y: 18 },
    ],
    pickups: [{ x: 4, y: 4, type: "ash" }],
    bells: [{ gx: 1, gy: 1 }, { gx: 29, gy: 18 }],
    hint: "Two bells hang silent behind null iron. Ring both, and the Bellmother's door will open.",
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
    ], [{ x: 13, y: 0, c: "D" }]),
    spawn: { x: 13, y: 2 },
    exits: [{ gx: 13, gy: 0, to: "hollow1", toSpawn: { x: 17, y: 19 } }],
    boss: { type: "bellmother", x: 13, y: 8 },
    hint: "BELLMOTHER, THE SAINT BENEATH THE BRONZE. Gates carry her ring back to her.",
  };

  /* ================= THE GLASS OSSUARY (34x22) ================= */
  ROOMS.ossuary1 = {
    id: "ossuary1", name: "The Glass Ossuary", biome: "ossuary",
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
      { gx: 16, gy: 0, to: "ossuaryboss", toSpawn: { x: 13, y: 15 }, needSigil: true },
    ],
    enemies: [
      { type: "mourner", x: 8, y: 6 }, { type: "mourner", x: 25, y: 6 },
      { type: "mourner", x: 16, y: 13 }, { type: "guard", x: 26, y: 15 },
    ],
    sigil: { gx: 14, gy: 6 },
    hint: "The sigil on null iron only answers a shot that has already touched a mirror.",
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
    ], [{ x: 13, y: 17, c: "D" }]),
    spawn: { x: 13, y: 15 },
    exits: [{ gx: 13, gy: 17, to: "ossuary1", toSpawn: { x: 16, y: 2 } }],
    enemies: [
      { type: "mourner", x: 7, y: 5, elite: true, tag: "choir" },
      { type: "mourner", x: 19, y: 5, elite: true, tag: "choir" },
      { type: "mourner", x: 13, y: 9, elite: true, tag: "choir" },
    ],
    choir: true,
    hint: "Three mourners share one litany. Silence all three.",
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

  const SHOP = [
    { id: "heart", name: "Heart Vessel", desc: "+1 max heart, fully healed", cost: 60, max: 3 },
    { id: "ashvessel", name: "Ash Vessel", desc: "+25 max ash", cost: 35, max: 3 },
    { id: "embercharm", name: "Ember Charm", desc: "Relic: ash regenerates 50% faster", cost: 40, relic: "embercharm" },
    { id: "swiftsoles", name: "Swift Soles", desc: "Relic: move 12% faster", cost: 50, relic: "swiftsoles" },
  ];

  const RELICS = {
    bellsigil: { id: "bellsigil", name: "Bell Sigil", desc: "Your strike rings brass and releases a small resonant pulse." },
    mirrorlitany: { id: "mirrorlitany", name: "Mirror Litany", desc: "Banked and deflected shots strike far harder and pierce." },
    embercharm: { id: "embercharm", name: "Ember Charm", desc: "Ash regenerates 50% faster." },
    swiftsoles: { id: "swiftsoles", name: "Swift Soles", desc: "Move 12% faster." },
  };

  VG.ROOMS = ROOMS;
  VG.DATA = { NPCS, QUESTS, DIALOG, SHOP, RELICS };
})();
