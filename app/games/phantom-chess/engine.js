/* Phantom Chess — complete rules engine.
 *
 * Loaded by BOTH the browser game (game.js) and the Node perft
 * verifier, so the move generator that passes the standard perft
 * node-count benchmarks is byte-for-byte the one players play against.
 *
 * Board: 64-array, index = rank*8 + file, rank 0 = 8th rank (black's
 * back rank). White pieces uppercase, black lowercase, "" empty.
 * Full legality: castling (rights + through-check rules), en passant,
 * promotion, check / checkmate / stalemate, fifty-move + threefold
 * detection left out by design (casual play).
 */
(function () {
  "use strict";

  const START = [
    "r","n","b","q","k","b","n","r",
    "p","p","p","p","p","p","p","p",
    "","","","","","","","",
    "","","","","","","","",
    "","","","","","","","",
    "","","","","","","","",
    "P","P","P","P","P","P","P","P",
    "R","N","B","Q","K","B","N","R",
  ];

  function newGame() {
    return {
      board: [...START],
      turn: "w",
      castling: { K: true, Q: true, k: true, q: true },
      ep: -1, // en-passant target square index, or -1
      history: [],
    };
  }

  function cloneState(s) {
    return { board: [...s.board], turn: s.turn, castling: { ...s.castling }, ep: s.ep, history: [] };
  }

  const isWhite = (p) => p !== "" && p === p.toUpperCase();
  const isBlack = (p) => p !== "" && p === p.toLowerCase();
  const colorOf = (p) => (p === "" ? null : isWhite(p) ? "w" : "b");
  const rankOf = (i) => Math.floor(i / 8);
  const fileOf = (i) => i % 8;

  const KNIGHT_D = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
  const KING_D = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
  const BISHOP_D = [[-1,-1],[-1,1],[1,-1],[1,1]];
  const ROOK_D = [[-1,0],[1,0],[0,-1],[0,1]];

  function sq(r, f) { return r * 8 + f; }
  function inside(r, f) { return r >= 0 && r < 8 && f >= 0 && f < 8; }

  /* Is square `i` attacked by side `by`? */
  function isAttacked(state, i, by) {
    const b = state.board;
    const r = rankOf(i), f = fileOf(i);
    // pawns
    const pr = by === "w" ? r + 1 : r - 1;
    for (const df of [-1, 1]) {
      if (inside(pr, f + df)) {
        const p = b[sq(pr, f + df)];
        if (p !== "" && colorOf(p) === by && p.toLowerCase() === "p") return true;
      }
    }
    // knights
    for (const [dr, df] of KNIGHT_D) {
      if (inside(r + dr, f + df)) {
        const p = b[sq(r + dr, f + df)];
        if (p !== "" && colorOf(p) === by && p.toLowerCase() === "n") return true;
      }
    }
    // king
    for (const [dr, df] of KING_D) {
      if (inside(r + dr, f + df)) {
        const p = b[sq(r + dr, f + df)];
        if (p !== "" && colorOf(p) === by && p.toLowerCase() === "k") return true;
      }
    }
    // sliders
    for (const [dr, df] of BISHOP_D) {
      let rr = r + dr, ff = f + df;
      while (inside(rr, ff)) {
        const p = b[sq(rr, ff)];
        if (p !== "") {
          if (colorOf(p) === by && (p.toLowerCase() === "b" || p.toLowerCase() === "q")) return true;
          break;
        }
        rr += dr; ff += df;
      }
    }
    for (const [dr, df] of ROOK_D) {
      let rr = r + dr, ff = f + df;
      while (inside(rr, ff)) {
        const p = b[sq(rr, ff)];
        if (p !== "") {
          if (colorOf(p) === by && (p.toLowerCase() === "r" || p.toLowerCase() === "q")) return true;
          break;
        }
        rr += dr; ff += df;
      }
    }
    return false;
  }

  function kingSquare(state, color) {
    const k = color === "w" ? "K" : "k";
    return state.board.indexOf(k);
  }

  function inCheck(state, color) {
    return isAttacked(state, kingSquare(state, color), color === "w" ? "b" : "w");
  }

  /* Pseudo-legal move generation. Moves: {from,to,promo?,flag?} where
     flag ∈ 'ep' | 'ck' | 'cq' | 'double'. */
  function pseudoMoves(state) {
    const b = state.board, turn = state.turn, moves = [];
    const push = (from, to, promo, flag) => moves.push({ from, to, promo: promo || null, flag: flag || null });
    for (let i = 0; i < 64; i++) {
      const p = b[i];
      if (p === "" || colorOf(p) !== turn) continue;
      const r = rankOf(i), f = fileOf(i);
      const kind = p.toLowerCase();
      if (kind === "p") {
        const dir = turn === "w" ? -1 : 1;
        const startRank = turn === "w" ? 6 : 1;
        const promoRank = turn === "w" ? 0 : 7;
        // forward
        if (inside(r + dir, f) && b[sq(r + dir, f)] === "") {
          if (r + dir === promoRank) for (const pr of ["q", "r", "b", "n"]) push(i, sq(r + dir, f), pr);
          else push(i, sq(r + dir, f));
          if (r === startRank && b[sq(r + 2 * dir, f)] === "") push(i, sq(r + 2 * dir, f), null, "double");
        }
        // captures
        for (const df of [-1, 1]) {
          if (!inside(r + dir, f + df)) continue;
          const t = sq(r + dir, f + df);
          if (b[t] !== "" && colorOf(b[t]) !== turn) {
            if (r + dir === promoRank) for (const pr of ["q", "r", "b", "n"]) push(i, t, pr);
            else push(i, t);
          } else if (t === state.ep && b[t] === "") {
            push(i, t, null, "ep");
          }
        }
      } else if (kind === "n") {
        for (const [dr, df] of KNIGHT_D) {
          if (!inside(r + dr, f + df)) continue;
          const t = sq(r + dr, f + df);
          if (b[t] === "" || colorOf(b[t]) !== turn) push(i, t);
        }
      } else if (kind === "k") {
        for (const [dr, df] of KING_D) {
          if (!inside(r + dr, f + df)) continue;
          const t = sq(r + dr, f + df);
          if (b[t] === "" || colorOf(b[t]) !== turn) push(i, t);
        }
        // castling
        const home = turn === "w" ? 60 : 4;
        const opp = turn === "w" ? "b" : "w";
        if (i === home && !isAttacked(state, home, opp)) {
          const [kr, qr] = turn === "w" ? ["K", "Q"] : ["k", "q"];
          if (state.castling[kr] && b[home + 1] === "" && b[home + 2] === "" &&
              b[home + 3].toLowerCase() === "r" && colorOf(b[home + 3]) === turn &&
              !isAttacked(state, home + 1, opp) && !isAttacked(state, home + 2, opp)) {
            push(i, home + 2, null, "ck");
          }
          if (state.castling[qr] && b[home - 1] === "" && b[home - 2] === "" && b[home - 3] === "" &&
              b[home - 4].toLowerCase() === "r" && colorOf(b[home - 4]) === turn &&
              !isAttacked(state, home - 1, opp) && !isAttacked(state, home - 2, opp)) {
            push(i, home - 2, null, "cq");
          }
        }
      } else {
        const dirs = kind === "b" ? BISHOP_D : kind === "r" ? ROOK_D : [...BISHOP_D, ...ROOK_D];
        for (const [dr, df] of dirs) {
          let rr = r + dr, ff = f + df;
          while (inside(rr, ff)) {
            const t = sq(rr, ff);
            if (b[t] === "") push(i, t);
            else { if (colorOf(b[t]) !== turn) push(i, t); break; }
            rr += dr; ff += df;
          }
        }
      }
    }
    return moves;
  }

  /* Apply a move to a COPY of state; returns new state. */
  function applyMove(state, m) {
    const s = cloneState(state);
    const b = s.board;
    const p = b[m.from];
    const turn = s.turn;
    b[m.to] = m.promo ? (turn === "w" ? m.promo.toUpperCase() : m.promo) : p;
    b[m.from] = "";
    if (m.flag === "ep") {
      const dir = turn === "w" ? 1 : -1;
      b[m.to + 8 * dir] = "";
    } else if (m.flag === "ck") {
      b[m.to + 1] = ""; b[m.to - 1] = turn === "w" ? "R" : "r";
    } else if (m.flag === "cq") {
      b[m.to - 2] = ""; b[m.to + 1] = turn === "w" ? "R" : "r";
    }
    s.ep = m.flag === "double" ? (m.from + m.to) / 2 : -1;
    // castling rights
    if (p === "K") { s.castling.K = s.castling.Q = false; }
    if (p === "k") { s.castling.k = s.castling.q = false; }
    if (m.from === 63 || m.to === 63) s.castling.K = false;
    if (m.from === 56 || m.to === 56) s.castling.Q = false;
    if (m.from === 7 || m.to === 7) s.castling.k = false;
    if (m.from === 0 || m.to === 0) s.castling.q = false;
    s.turn = turn === "w" ? "b" : "w";
    return s;
  }

  /* Fully legal moves (filters pseudo-legal that leave own king in check). */
  function legalMoves(state) {
    return pseudoMoves(state).filter((m) => !inCheck(applyMove(state, m), state.turn));
  }

  function gameStatus(state) {
    const legal = legalMoves(state);
    if (legal.length > 0) return inCheck(state, state.turn) ? "check" : "playing";
    return inCheck(state, state.turn) ? "checkmate" : "stalemate";
  }

  /* perft — the standard move-generator correctness benchmark. */
  function perft(state, depth) {
    if (depth === 0) return 1;
    let nodes = 0;
    for (const m of legalMoves(state)) nodes += perft(applyMove(state, m), depth - 1);
    return nodes;
  }

  /* ---------------- AI: negamax + alpha-beta ---------------- */
  const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
  // simple centralization bonus table (symmetric, applied to both sides)
  const CENTER = [
    0,1,2,3,3,2,1,0,
    1,2,3,4,4,3,2,1,
    2,3,4,5,5,4,3,2,
    3,4,5,6,6,5,4,3,
    3,4,5,6,6,5,4,3,
    2,3,4,5,5,4,3,2,
    1,2,3,4,4,3,2,1,
    0,1,2,3,3,2,1,0,
  ];

  function evaluate(state) {
    // from the perspective of side-to-move
    let score = 0;
    for (let i = 0; i < 64; i++) {
      const p = state.board[i];
      if (p === "") continue;
      const v = VAL[p.toLowerCase()] + CENTER[i] * 2 +
        (p.toLowerCase() === "p" ? (isWhite(p) ? (6 - rankOf(i)) : (rankOf(i) - 1)) * 3 : 0);
      score += colorOf(p) === state.turn ? v : -v;
    }
    return score;
  }

  function orderedMoves(state) {
    // captures first (MVV-ish) for better pruning
    const b = state.board;
    return legalMoves(state).sort((x, y) => {
      const cx = b[x.to] === "" ? 0 : VAL[b[x.to].toLowerCase()];
      const cy = b[y.to] === "" ? 0 : VAL[b[y.to].toLowerCase()];
      return cy - cx;
    });
  }

  function negamax(state, depth, alpha, beta) {
    const moves = orderedMoves(state);
    if (moves.length === 0) return inCheck(state, state.turn) ? -100000 - depth : 0;
    if (depth === 0) return evaluate(state);
    let best = -Infinity;
    for (const m of moves) {
      const v = -negamax(applyMove(state, m), depth - 1, -beta, -alpha);
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  function bestMove(state, depth = 3) {
    let best = null, bestV = -Infinity;
    for (const m of orderedMoves(state)) {
      const v = -negamax(applyMove(state, m), depth - 1, -Infinity, Infinity);
      if (v > bestV || (v === bestV && Math.random() < 0.3)) { bestV = v; best = m; }
    }
    return best;
  }

  const FILES = "abcdefgh";
  function algebraic(i) { return FILES[fileOf(i)] + (8 - rankOf(i)); }

  const api = { newGame, cloneState, legalMoves, applyMove, gameStatus, inCheck, perft, bestMove, algebraic, colorOf, isWhite, isBlack };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.PhantomChess = api;
})();
