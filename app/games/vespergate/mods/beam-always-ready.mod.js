window.PhantomMods && window.PhantomMods.register({
  id: "vg_beam_always_ready",
  name: "Beam Always Ready",
  desc: "Keeps you topped to full HP every tick, so the Vesper Hand beam is always charged.",
  category: "vespergate",
  apply: function () {
    return setInterval(function () {
      var s = window.__VespergateTest.state();
      if (s.hp < s.maxHp && s.hp > 0) window.__VespergateTest.hp(s.maxHp);
    }, 250);
  },
  remove: function (ctx, timer) { clearInterval(timer); },
});
