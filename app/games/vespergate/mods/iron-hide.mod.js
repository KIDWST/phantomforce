window.PhantomMods && window.PhantomMods.register({
  id: "vg_iron_hide",
  name: "Iron Hide",
  desc: "Doubles your max HP and heals you to full.",
  category: "vespergate",
  apply: function (ctx) {
    var s = window.__VespergateTest.state();
    var prevMax = s.maxHp;
    window.__VespergateTest.maxHp(prevMax * 2);
    window.__VespergateTest.hp(prevMax * 2);
    ctx.toast("Iron Hide: " + (prevMax * 2) + " max HP");
    return prevMax;
  },
  remove: function (ctx, prevMax) {
    if (prevMax) { window.__VespergateTest.maxHp(prevMax); window.__VespergateTest.hp(prevMax); }
  },
});
