window.PhantomMods && window.PhantomMods.register({
  id: "vg_room_warp",
  name: "Room Warp Menu (M)",
  desc: "Press M for a quick teleport list to any room in the game.",
  category: "vespergate",
  apply: function () {
    var panel = null;
    function closePanel() { if (panel) { panel.remove(); panel = null; } }
    function openPanel() {
      closePanel();
      var rooms = window.__VespergateTest.rooms();
      panel = document.createElement("div");
      panel.style.cssText = "position:fixed;top:16px;left:16px;max-height:80vh;overflow:auto;" +
        "background:rgba(8,7,14,0.95);border:1px solid rgba(255,154,208,0.4);border-radius:10px;" +
        "font:12px monospace;color:#eaf2ff;z-index:2147483647;padding:10px;min-width:180px;";
      var html = '<div style="font-weight:700;margin-bottom:6px;">WARP TO ROOM (M to close)</div>';
      rooms.forEach(function (r) { html += '<div data-room="' + r + '" style="padding:4px 6px;cursor:pointer;border-radius:5px;" onmouseover="this.style.background=\'rgba(255,154,208,0.15)\'" onmouseout="this.style.background=\'\'">' + r + '</div>'; });
      panel.innerHTML = html;
      panel.querySelectorAll("[data-room]").forEach(function (row) {
        row.addEventListener("click", function () { window.__VespergateTest.warp(row.getAttribute("data-room")); closePanel(); });
      });
      document.body.appendChild(panel);
    }
    var handler = function (e) { if (e.key === "m" || e.key === "M") (panel ? closePanel : openPanel)(); };
    document.addEventListener("keydown", handler);
    return handler;
  },
  remove: function (ctx, handler) { document.removeEventListener("keydown", handler); },
});
