window.PhantomMods && window.PhantomMods.register({
  id: "vg_infinite_embers",
  name: "Infinite Embers",
  desc: "Keeps your ember count topped at 999.",
  category: "vespergate",
  apply: function () {
    var timer = setInterval(function () {
      var s = window.__VespergateTest.state();
      if (s.embers < 999) window.__VespergateTest.embers(999 - s.embers);
    }, 500);
    return timer;
  },
  remove: function (ctx, timer) { clearInterval(timer); },
});
