window.PhantomMods && window.PhantomMods.register({
  id: "vg_cutscene_skip",
  name: "Skip Cutscenes (N)",
  desc: "Press N to instantly skip the current scene or dialog.",
  category: "vespergate",
  apply: function () {
    var handler = function (e) {
      if (e.key === "n" || e.key === "N") window.__VespergateTest.skipScene();
    };
    document.addEventListener("keydown", handler);
    return handler;
  },
  remove: function (ctx, handler) { document.removeEventListener("keydown", handler); },
});
