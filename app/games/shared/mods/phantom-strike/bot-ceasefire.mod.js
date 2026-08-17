window.PhantomMods && window.PhantomMods.register({
  id: "ps_bot_ceasefire",
  name: "Bot Ceasefire",
  desc: "Freezes bot movement, aim, and firing for safe weapon tests.",
  category: "phantom strike",
  apply: function (ctx) { return ctx.claimDevFlag("ps_bot_ceasefire", "freezeBots", true); },
  remove: function (_ctx, release) { if (typeof release === "function") release(); },
});
