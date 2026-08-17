window.PhantomMods && window.PhantomMods.register({
  id: "ps_clear_hostiles",
  name: "Clear Hostiles (K)",
  desc: "Press K to eliminate every live bot in the current match.",
  category: "phantom strike",
  apply: function (ctx) {
    var handler = function (event) {
      if (event.key === "k" || event.key === "K") {
        ctx.dev.action("clearBots");
        ctx.toast("Hostiles cleared");
      }
    };
    document.addEventListener("keydown", handler);
    return handler;
  },
  remove: function (_ctx, handler) { document.removeEventListener("keydown", handler); },
});
