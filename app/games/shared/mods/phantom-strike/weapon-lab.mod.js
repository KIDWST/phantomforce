window.PhantomMods && window.PhantomMods.register({
  id: "ps_weapon_lab",
  name: "Weapon Lab",
  desc: "Removes reload delays and recoil while preserving hit and damage behavior.",
  category: "phantom strike",
  apply: function (ctx) {
    return [
      ctx.claimDevFlag("ps_weapon_lab", "noReload", true),
      ctx.claimDevFlag("ps_weapon_lab", "noRecoil", true),
    ];
  },
  remove: function (_ctx, releases) {
    (releases || []).slice().reverse().forEach(function (release) { release(); });
  },
});
