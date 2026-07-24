window.PhantomMods && window.PhantomMods.register({
  id: "vg_one_hit_kill",
  name: "One-Hit Kill",
  desc: "Every strike deletes whatever it touches.",
  category: "vespergate",
  apply: function () {
    var prev = VG.settings.damageDealtMul;
    VG.settings.damageDealtMul = 999;
    return prev;
  },
  remove: function (ctx, prev) { VG.settings.damageDealtMul = prev == null ? 1 : prev; },
});
