window.PhantomMods && window.PhantomMods.register({
  id: "vg_all_cosmetics",
  name: "All Cosmetics Unlocked",
  desc: "Every cloak, glow, accessory, and trail is yours to equip.",
  category: "vespergate",
  apply: function (ctx) {
    window.__VespergateTest.grantAllCosmetics();
    ctx.toast("All cosmetics unlocked — open Inventory (TAB) to equip");
    return true;
  },
  remove: function () {},
});
