window.PhantomMods && window.PhantomMods.register({
  id: "ps_infinite_ammo",
  name: "Infinite Ammo",
  desc: "Keeps the active weapon full without consuming reserve ammo.",
  category: "phantom strike",
  apply: function (ctx) { return ctx.claimDevFlag("ps_infinite_ammo", "infiniteAmmo", true); },
  remove: function (_ctx, release) { if (typeof release === "function") release(); },
});
