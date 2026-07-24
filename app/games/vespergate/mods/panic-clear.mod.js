window.PhantomMods && window.PhantomMods.register({
  id: "vg_panic_clear",
  name: "Panic Button (K)",
  desc: "Press K to instantly clear every enemy in the current room.",
  category: "vespergate",
  apply: function (ctx) {
    var handler = function (e) {
      if (e.key === "k" || e.key === "K") { window.__VespergateTest.clearEnemies(); ctx.toast("Room cleared"); }
    };
    document.addEventListener("keydown", handler);
    return handler;
  },
  remove: function (ctx, handler) { document.removeEventListener("keydown", handler); },
});
