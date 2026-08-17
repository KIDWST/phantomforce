window.PhantomMods && window.PhantomMods.register({
  id: "ps_training_mode",
  name: "Training Mode",
  desc: "God mode, frozen bots, endless ammo and grenades, and zero reload or recoil.",
  category: "phantom strike",
  apply: function (ctx) {
    var releases = [
      ctx.claimDevFlag("ps_training_mode", "invulnerable", true),
      ctx.claimDevFlag("ps_training_mode", "infiniteAmmo", true),
      ctx.claimDevFlag("ps_training_mode", "infiniteGrenades", true),
      ctx.claimDevFlag("ps_training_mode", "freezeBots", true),
      ctx.claimDevFlag("ps_training_mode", "noReload", true),
      ctx.claimDevFlag("ps_training_mode", "noRecoil", true),
      ctx.claimDevFlag("ps_training_mode", "botDamageScale", 0),
    ];
    ctx.dev.action("refill");
    return releases;
  },
  remove: function (_ctx, releases) {
    (releases || []).slice().reverse().forEach(function (release) { release(); });
  },
});
