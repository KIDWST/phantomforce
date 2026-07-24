window.PhantomMods && window.PhantomMods.register({
  id: "vg_molasses",
  name: "Molasses Mode",
  desc: "Half movement speed — a real challenge run modifier.",
  category: "vespergate",
  apply: function () {
    var prev = VG.settings.speedMul;
    VG.settings.speedMul = 0.5;
    return prev;
  },
  remove: function (ctx, prev) { VG.settings.speedMul = prev == null ? 1 : prev; },
});
