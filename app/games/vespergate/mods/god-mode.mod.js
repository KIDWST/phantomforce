window.PhantomMods && window.PhantomMods.register({
  id: "vg_god_mode",
  name: "God Mode",
  desc: "Take zero damage from anything.",
  category: "vespergate",
  apply: function () {
    var prev = VG.settings.damageTaken;
    VG.settings.damageTaken = 0;
    return prev;
  },
  remove: function (ctx, prev) { VG.settings.damageTaken = prev == null ? 1 : prev; },
});
