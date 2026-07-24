window.PhantomMods && window.PhantomMods.register({
  id: "vg_glass_cannon",
  name: "Glass Cannon",
  desc: "1 HP challenge run: one hit and you're done.",
  category: "vespergate",
  apply: function (ctx) {
    var s = window.__VespergateTest.state();
    var prevMax = s.maxHp;
    window.__VespergateTest.maxHp(1);
    window.__VespergateTest.hp(1);
    ctx.toast("Glass Cannon: 1 HP");
    return prevMax;
  },
  remove: function (ctx, prevMax) {
    if (prevMax) { window.__VespergateTest.maxHp(prevMax); window.__VespergateTest.hp(prevMax); }
  },
});
