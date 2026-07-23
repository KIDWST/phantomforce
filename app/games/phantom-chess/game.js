/* Phantom Chess — UI layer over engine.js (the perft-verified rules
 * engine; see repo commit message for the reference node counts it
 * passes). Local 2-player or vs a negamax AI. */
(function () {
  "use strict";

  const host = (type, data = {}) => parent.postMessage({ source: "phantomplay-game", type, ...data }, "*");

  // Theme music — PhantomScore (app/games/shared/phantomScore.js), driven by
  // theme.js's GAME_THEME. Real composition, zero audio files, zero CSP
  // change (see app/games/shared/phantomScore.schema.md).
  const score = (window.PhantomScore && window.GAME_THEME)
    ? window.PhantomScore.create(window.GAME_THEME) : null;
  addEventListener("message", (e) => {
    if (e.data?.source !== "phantomplay-host" || e.data.type !== "settings" || !score) return;
    if (e.data.sound !== false) score.unmute(); else score.mute();
  });
  addEventListener("pointerdown", () => { if (score) score.start(); }, { once: true });

  const E = window.PhantomChess;
  const GLYPHS = {
    K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
    k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
  };
  const $ = (s) => document.querySelector(s);
  const boardEl = $("[data-board]");
  const statusLine = $("[data-status-line]"), modeLine = $("[data-mode-line]");
  const modeOverlay = $("[data-mode-overlay]"), promoOverlay = $("[data-promo-overlay]"), endOverlay = $("[data-end-overlay]");
  const promoRow = $("[data-promo-row]");
  const capturedW = $("[data-captured-w]"), capturedB = $("[data-captured-b]");

  let state = E.newGame();
  let mode = null;            // "2p" | "ai"
  let selected = -1;
  let legal = [];             // legal moves for current position
  let lastMove = null;
  let pendingPromo = null;    // {from,to} awaiting piece choice
  let captured = { w: [], b: [] }; // pieces each side has LOST
  let aiThinking = false;

  function newGame() {
    state = E.newGame();
    selected = -1; legal = E.legalMoves(state); lastMove = null; pendingPromo = null;
    captured = { w: [], b: [] };
    aiThinking = false;
    endOverlay.hidden = true; promoOverlay.hidden = true;
    render();
  }

  function movesFrom(i) { return legal.filter((m) => m.from === i); }

  function doMove(m) {
    const target = state.board[m.to];
    if (target !== "") captured[E.colorOf(target)].push(target);
    if (m.flag === "ep") captured[state.turn === "w" ? "b" : "w"].push(state.turn === "w" ? "p" : "P");
    state = E.applyMove(state, m);
    lastMove = m;
    selected = -1;
    legal = E.legalMoves(state);
    render();
    const status = E.gameStatus(state);
    if (status === "checkmate" || status === "stalemate") { showEnd(status); return; }
    if (mode === "ai" && state.turn === "b") aiTurn();
  }

  function aiTurn() {
    aiThinking = true;
    statusLine.textContent = "Phantom is thinking…";
    setTimeout(() => {
      const m = E.bestMove(state, 3);
      aiThinking = false;
      if (m) doMove(m);
    }, 120);
  }

  function showEnd(status) {
    const winner = state.turn === "w" ? "Black" : "White";
    $("[data-end-title]").textContent = status === "checkmate" ? "Checkmate" : "Stalemate";
    $("[data-end-sub]").textContent = status === "checkmate"
      ? `${winner} wins${mode === "ai" && winner === "Black" ? " — the Phantom takes it." : "."}`
      : "No legal moves, no check — it's a draw.";
    setTimeout(() => { endOverlay.hidden = false; }, 350);
    const materialValue = { p: 1, n: 3, b: 3, r: 5, q: 9 };
    const lost = (side) => captured[side].reduce((sum, piece) => sum + (materialValue[piece.toLowerCase()] || 0), 0);
    const humanWon = status === "checkmate" && (mode !== "ai" ? true : winner === "White");
    host("complete", {
      score: Math.max(0, lost("b") - lost("w")) * 10,
      progress: 100,
      state: { status, winner, mode, materialCaptured: { byWhite: lost("b"), byBlack: lost("w") }, humanWon },
    });
  }

  function onSquareClick(i) {
    if (aiThinking || !modeOverlay.hidden || !promoOverlay.hidden || !endOverlay.hidden) return;
    if (mode === "ai" && state.turn === "b") return;
    const p = state.board[i];
    const mine = p !== "" && E.colorOf(p) === state.turn;
    if (selected >= 0) {
      const candidates = movesFrom(selected).filter((m) => m.to === i);
      if (candidates.length) {
        if (candidates[0].promo) {
          pendingPromo = { from: selected, to: i };
          openPromoPicker();
        } else {
          doMove(candidates[0]);
        }
        return;
      }
    }
    selected = mine ? (selected === i ? -1 : i) : -1;
    render();
  }

  function openPromoPicker() {
    const isW = state.turn === "w";
    promoRow.innerHTML = ["q", "r", "b", "n"].map((pr) =>
      `<button class="promo-btn" data-promo="${pr}">${GLYPHS[isW ? pr.toUpperCase() : pr]}</button>`).join("");
    promoOverlay.hidden = false;
  }
  promoRow.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-promo]");
    if (!btn || !pendingPromo) return;
    const m = legal.find((x) => x.from === pendingPromo.from && x.to === pendingPromo.to && x.promo === btn.dataset.promo);
    promoOverlay.hidden = true;
    pendingPromo = null;
    if (m) doMove(m);
  });

  function render() {
    const status = E.gameStatus(state);
    const checkedKing = (status === "check" || status === "checkmate")
      ? state.board.indexOf(state.turn === "w" ? "K" : "k") : -1;
    const targets = selected >= 0 ? new Set(movesFrom(selected).map((m) => m.to)) : new Set();

    boardEl.innerHTML = Array.from({ length: 64 }, (_, i) => {
      const r = Math.floor(i / 8), f = i % 8;
      const p = state.board[i];
      const cls = [
        "sq", (r + f) % 2 === 0 ? "light" : "dark",
        selected === i ? "sel" : "",
        lastMove && (lastMove.from === i || lastMove.to === i) ? "last" : "",
        checkedKing === i ? "check-sq" : "",
      ].filter(Boolean).join(" ");
      return `<div class="${cls}" data-sq="${i}">
        ${f === 0 ? `<span class="coord rank">${8 - r}</span>` : ""}
        ${r === 7 ? `<span class="coord file">${"abcdefgh"[f]}</span>` : ""}
        ${p ? `<span class="glyph ${E.isWhite(p) ? "white" : "black"}">${GLYPHS[p]}</span>` : ""}
        ${targets.has(i) ? (p ? `<span class="ring"></span>` : `<span class="dot"></span>`) : ""}
      </div>`;
    }).join("");

    capturedW.textContent = captured.w.map((p) => GLYPHS[p]).join(" ");
    capturedB.textContent = captured.b.map((p) => GLYPHS[p]).join(" ");

    if (!aiThinking) {
      const side = state.turn === "w" ? "White" : "Black";
      statusLine.textContent =
        status === "checkmate" ? `Checkmate — ${state.turn === "w" ? "Black" : "White"} wins` :
        status === "stalemate" ? "Stalemate — draw" :
        status === "check" ? `${side} to move — CHECK` : `${side} to move`;
    }
  }

  boardEl.addEventListener("click", (e) => {
    const sq = e.target.closest("[data-sq]");
    if (sq) onSquareClick(Number(sq.dataset.sq));
  });

  document.querySelectorAll("[data-pick-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      mode = btn.dataset.pickMode;
      modeLine.textContent = mode === "ai" ? "YOU vs PHANTOM AI" : "LOCAL 2P";
      modeOverlay.hidden = true;
      newGame();
    });
  });
  $("[data-new-btn]").addEventListener("click", newGame);
  $("[data-mode-btn]").addEventListener("click", () => { modeOverlay.hidden = false; });
  $("[data-rematch-btn]").addEventListener("click", newGame);
  $("[data-end-mode-btn]").addEventListener("click", () => { endOverlay.hidden = true; modeOverlay.hidden = false; });

  render();
  host("ready");

  /* Test hook — automated verification drives the same click path a
     player uses (see repo verification scripts). */
  window.__PhantomChessTest = {
    setMode(m) { mode = m; modeLine.textContent = m === "ai" ? "YOU vs PHANTOM AI" : "LOCAL 2P"; modeOverlay.hidden = true; newGame(); },
    clickSquare(i) { onSquareClick(i); },
    state() { return { turn: state.turn, status: E.gameStatus(state), board: state.board.join(""), aiThinking, legalCount: legal.length }; },
    pickPromo(p) { const btn = promoRow.querySelector(`[data-promo="${p}"]`); if (btn) btn.click(); },
  };
})();
