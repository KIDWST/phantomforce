window.PhantomMods && window.PhantomMods.register({
  id: "vg_speed_demon",
  name: "Speed Demon",
  desc: "1.8x movement speed.",
  category: "vespergate",
  apply: function () {
    var prev = VG.settings.speedMul;
    VG.settings.speedMul = 1.8;
    return prev;
  },
  remove: function (ctx, prev) { VG.settings.speedMul = prev == null ? 1 : prev; },
});
