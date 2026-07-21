/* VESPERGATE — rooms.js
 * Hand-authored Cathedral of Falling Bells vertical slice. Each room teaches or
 * combines a spatial rule. Legend: #=liminal(portalable) X=null-iron(no portal)
 * ==dead stone ^=spike ~=bell-brass(portalable, rings) _=platform .=open
 */
"use strict";
(() => {
  const VG = window.VG;

  VG.ROOMS = {
    /* ---- 0: the Evening Fold — you fall in, gain control, first shot ---- */
    fall: {
      id: "fall", name: "The Evening Fold",
      hint: "Left Trigger / Left-click fires the Cinder Hand. Reach the door.",
      map: [
        "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
        "X............................=X",
        "X............................=X",
        "X.......###..................=X",
        "X............................=X",
        "X..................####......=X",
        "X............................=X",
        "X.....####...................=X",
        "X.........................===X",
        "X............####............X",
        "X............................X",
        "X.......===.........####.....X",
        "X............................X",
        "X..###.......................X",
        "X..........................D.X",
        "X==========================.=X",
        "X^^^^^^^^^^^^^^^^^^^^^^^^^^^.=X",
        "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      ],
      spawn: { x: 4, y: 2 },
      enemies: [{ type: "guard", x: 18, y: 14 }],
      exits: [{ gx: 27, gy: 14, to: "teach", toSpawn: { x: 3, y: 12 } }],
    },

    /* ---- 1: teach — place a gate, redirect a shot around a wall ---- */
    teach: {
      id: "teach", name: "Threshold of the First Door",
      hint: "Right-click / Right Trigger places a gate on liminal stone. Send a shot through.",
      map: [
        "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
        "X............................#X",
        "X............................#X",
        "X#...........................#X",
        "X#.........XXXXXX............#X",
        "X#.........X....X...........#X",
        "X#.........X.TT.X...........#X",
        "X#.........X....X...........#X",
        "X#.........XXXXXX...........#X",
        "X#..........................#X",
        "X#.........................D#X",
        "X#=========================.#X",
        "X#........................#.#X",
        "X##########################.#X",
        "X^^^^^^^^^^^^^^^^^^^^^^^^^^#.#X",
        "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      ],
      spawn: { x: 3, y: 12 },
      // a target dummy behind the box teaches redirection; guard at exit
      enemies: [{ type: "guard", x: 24, y: 10 }],
      pickups: [{ type: "ash", x: 13, y: 6 }],
      exits: [{ gx: 27, gy: 10, to: "bells", toSpawn: { x: 3, y: 14 } }],
    },

    /* ---- 2: the dungeon body — momentum, bells, shield enemy ---- */
    bells: {
      id: "bells", name: "Cathedral of Falling Bells",
      hint: "Ring the bell-brass with a shot. Redirect its pulse. Build momentum through gates.",
      map: [
        "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
        "X##................................##X",
        "X##................................##X",
        "X##......~~~.................~~~....##X",
        "X##................................##X",
        "X##................................##X",
        "X##....######............######....##X",
        "X##................................##X",
        "X##................................##X",
        "X##...........########.............##X",
        "X##................................##X",
        "X##.......^^^^.........^^^^.........##X",
        "X##============....===========.....##X",
        "X##............#..#................##X",
        "X##............#..#...............D##X",
        "X##............#..#################.##X",
        "X##^^^^^^^^^^^^#..#^^^^^^^^^^^^^^^^.##X",
        "X##############..##################.##X",
        "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      ],
      spawn: { x: 3, y: 14 },
      bells: [{ gx: 8, gy: 3 }, { gx: 29, gy: 3 }],
      enemies: [
        { type: "guard", x: 20, y: 11 },
        { type: "sniper", x: 30, y: 6 },
        { type: "leech", x: 16, y: 9 },
      ],
      pickups: [{ type: "pulse", x: 18, y: 5 }, { type: "ash", x: 32, y: 11 }],
      exits: [{ gx: 33, gy: 14, to: "boss", toSpawn: { x: 4, y: 12 } }],
    },

    /* ---- 3: Bellmother arena ---- */
    boss: {
      id: "boss", name: "Beneath the Bronze",
      hint: "Bellmother, the Saint Beneath the Bronze.",
      map: [
        "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
        "X##..............................##X",
        "X##......~~~~........~~~~.........##X",
        "X##..............................##X",
        "X##..............................##X",
        "X##..............................##X",
        "X##..............................##X",
        "X##..............................##X",
        "X##....####..............####....##X",
        "X##..............................##X",
        "X##..............................##X",
        "X##..............................##X",
        "X##....####..............####....##X",
        "X##..............................##X",
        "X##..............................##X",
        "X####==========....==========####X",
        "X##^^^^^^^^^^^^^..^^^^^^^^^^^^^^^##X",
        "X##############..##############.##X",
        "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      ],
      spawn: { x: 4, y: 12 },
      bells: [{ gx: 8, gy: 2 }, { gx: 21, gy: 2 }],
      boss: { type: "bellmother", x: 18, y: 6 },
      shrine: { gx: 4, gy: 12 },
    },
  };
})();
