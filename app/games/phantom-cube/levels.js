/* PhantomCube — level data + shared simulation core.
 *
 * This file is loaded by BOTH the browser game (game.js) and the Node
 * solver (tools/solve.mjs style scripts) so the rules the solver proves
 * solvable are byte-for-byte the rules the player plays. Same pattern
 * as shared/objectPool.js (window + module.exports dual export).
 *
 * All level layouts here are ORIGINAL designs for PhantomPlay — the
 * genre (slide a cube, tiles crumble behind you, clear the board to
 * open the exit) is classic puzzle territory, but no layout is copied
 * from any existing game.
 *
 * Grid legend:
 *   .  empty void (no tile)
 *   #  normal tile — crumbles when you step OFF it
 *   2  double tile — first step off downgrades it to normal, needs two passes
 *   S  start tile (normal tile the cube begins on)
 *   E  exit pad — never crumbles; land on it with every tile cleared to win
 *   A/B  teleporter pairs — stepping IN consumes that pad and drops you on
 *        its twin (the twin still crumbles normally when you later leave it)
 */
(function () {
  "use strict";

  const LEVELS = [
    { name: "First Steps", grid: [
      "S##",
      "###",
      "##E",
    ] },
    { name: "Serpentine", grid: [
      "S###",
      "####",
      "###E",
    ] },
    { name: "The Bend", grid: [
      "S##",
      ".##",
      ".##",
      ".E#",
    ] },
    { name: "Double Up", grid: [
      ".S.",
      "#2#",
      "..E",
    ] },
    { name: "The Long Way", grid: [
      "S####",
      "#####",
      "####E",
    ] },
    { name: "Twin Crossing", grid: [
      "S#..#E",
      "##..##",
      "A....A",
    ] },
    { name: "Pocket Pair", grid: [
      "#.#..",
      "2#2##",
      "S...E",
    ] },
    { name: "Broken Bridge", grid: [
      "S#....",
      ".#A...",
      "......",
      "..A#B.",
      "......",
      "...B#E",
    ] },
    { name: "Triple Pocket", grid: [
      "#.#.#",
      "2#2#2",
      "S...E",
    ] },
    { name: "The Vault", grid: [
      "#####",
      "#...#",
      "S...#",
      "#...#",
      "E####",
    ] },
    { name: "Ghost Jump", grid: [
      "S#......",
      ".#A.....",
      "........",
      "...A##..",
      "....#2..",
      ".....#..",
      ".....#E.",
    ] },
    { name: "Final Circuit", grid: [
      ".#....",
      "#2####",
      "#....#",
      "#E...#",
      "S#####",
    ] },
  ];

  const DIRS = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };

  /* Parse a level grid into cells. Returns { cells, start, exit, telePairs } */
  function parseLevel(level) {
    const cells = new Map(); // "r,c" -> { r, c, kind, letter? }
    let start = null, exit = null;
    const teles = {};
    level.grid.forEach((row, r) => {
      [...row].forEach((ch, c) => {
        if (ch === "." || ch === " ") return;
        const key = `${r},${c}`;
        if (ch === "S") { start = key; cells.set(key, { r, c, kind: "tile" }); }
        else if (ch === "E") { exit = key; cells.set(key, { r, c, kind: "exit" }); }
        else if (ch === "#") cells.set(key, { r, c, kind: "tile" });
        else if (ch === "2") cells.set(key, { r, c, kind: "double" });
        else if (/[A-D]/.test(ch)) {
          cells.set(key, { r, c, kind: "tele", letter: ch });
          (teles[ch] = teles[ch] || []).push(key);
        }
      });
    });
    return { cells, start, exit, teles };
  }

  /* A fresh, mutable simulation of one level. The ONLY rules engine. */
  function createSim(level) {
    const { cells, start, exit, teles } = parseLevel(level);
    // state: key -> remaining passes (tile/tele:1, double:2, exit:Infinity)
    const state = new Map();
    for (const [key, cell] of cells) {
      state.set(key, cell.kind === "exit" ? Infinity : cell.kind === "double" ? 2 : 1);
    }
    let pos = start;
    let moves = 0;

    function partnerOf(key) {
      const cell = cells.get(key);
      const pair = teles[cell.letter] || [];
      return pair[0] === key ? pair[1] : pair[0];
    }

    const sim = {
      cells, exitKey: exit, startKey: start,
      get pos() { return pos; },
      get moves() { return moves; },
      stateOf: (key) => state.get(key),
      /* Attempt a move; returns true if it happened. */
      move(dir) {
        const d = DIRS[dir];
        if (!d) return false;
        const cur = cells.get(pos);
        const targetKey = `${cur.r + d[0]},${cur.c + d[1]}`;
        const target = cells.get(targetKey);
        if (!target || state.get(targetKey) <= 0) return false;
        // leave current cell
        if (state.get(pos) !== Infinity) state.set(pos, state.get(pos) - 1);
        // enter target
        if (target.kind === "tele") {
          const partner = partnerOf(targetKey);
          if (!partner || state.get(partner) <= 0) {
            // twin already gone — pad is inert, treat as normal tile
            pos = targetKey;
          } else {
            state.set(targetKey, 0); // entering consumes the pad
            pos = partner;
          }
        } else {
          pos = targetKey;
        }
        moves++;
        return true;
      },
      won() {
        if (pos !== exit) return false;
        for (const [key, n] of state) {
          if (key !== exit && n > 0) return false;
        }
        return true;
      },
      stuck() {
        if (sim.won()) return false;
        for (const dir of ["up", "down", "left", "right"]) {
          const d = DIRS[dir];
          const cur = cells.get(pos);
          const k = `${cur.r + d[0]},${cur.c + d[1]}`;
          if (cells.has(k) && state.get(k) > 0) return false;
        }
        return true;
      },
      /* Compact serialization for solver visited-sets. */
      encode() {
        let s = pos + "|";
        for (const [key, n] of state) if (n !== Infinity) s += n;
        return s;
      },
    };
    return sim;
  }

  const api = { LEVELS, createSim, parseLevel, DIRS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.PhantomCubeCore = api;
})();
