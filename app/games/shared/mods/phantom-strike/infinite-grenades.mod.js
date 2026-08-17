window.PhantomMods && window.PhantomMods.register({
  id: "ps_infinite_grenades",
  name: "Infinite Grenades",
  desc: "Throw unlimited live frag grenades with G or gamepad Y.",
  category: "phantom strike",
  apply: function (ctx) { return ctx.claimDevFlag("ps_infinite_grenades", "infiniteGrenades", true); },
  remove: function (_ctx, release) { if (typeof release === "function") release(); },
});
