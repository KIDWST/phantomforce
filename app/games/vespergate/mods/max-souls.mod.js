window.PhantomMods && window.PhantomMods.register({
  id: "vg_max_souls",
  name: "Max Vesper Souls",
  desc: "Grants 9999 vesper souls, unlocking every soul tier immediately.",
  category: "vespergate",
  apply: function (ctx) {
    window.__VespergateTest.souls(9999);
    ctx.toast("Vesper souls maxed");
    return true;
  },
  // one-shot grant; nothing to undo on disable
  remove: function () {},
});
