/* superuser.js — the dense, power-user view. Loaded after app.js (whose
   boot() already runs the full engine boot sequence, including session
   reconnect via session-restore.js), settings.js, mission.js,
   connections.js. Everything here is additive on top of those globals:
   cards, addCard, buildCard, openTerminal, expandCard, setColumns,
   removeCard, restartCard, setCollapsed, api, escapeHtml, profiles,
   startTerminal, STATUS_META, toggleBroadcast, TerminaSettings. */

document.getElementById("mode-toggle").addEventListener("click", () => {
  window.location.href = "/";
});
