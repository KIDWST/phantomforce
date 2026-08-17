window.PhantomMods && window.PhantomMods.register({
  id: "ps_god_mode",
  name: "God Mode",
  desc: "Enemy fire and blast damage cannot kill P1.",
  category: "phantom strike",
  apply: function (ctx) { return ctx.claimDevFlag("ps_god_mode", "invulnerable", true); },
  remove: function (_ctx, release) { if (typeof release === "function") release(); },
});
