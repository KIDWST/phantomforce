# PhantomFlow ("The Flow") — integration instructions

You are integrating a finished, self-contained animated component into the
PhantomForce admin app (admin.phantomforce.online). Do not rewrite the
component; just mount it and wire two integration points (live stats + click
handling).

## What it is

An animated canvas map of the business offer chain:
**Leads → Quotes → Approvals → Bookings → Delivery → Reviews → Money.**

- Framed dark holo-panel with a twinkling starfield
- The chain is a ribbon of light grading green → cyan → gold toward Money
- Three comet sparks ride the chain; every station they pass flares with a
  ripple ring and a sparkle burst (gold at the Money station) and its stat pops
- Stations show a live stat, brighten on hover, and fire a click callback
- Zero dependencies, injects its own DOM + styles, ~14 KB unminified
- Honors `prefers-reduced-motion` (renders static but stays clickable)
- Collapses from 7 to 5 stations under 640px viewport width
- Pauses drawing while the tab is hidden

## Files

- `flow-map.js` — the component. Exposes `window.PhantomFlow` (also
  CommonJS-compatible).
- `demo.html` — open in a browser next to `flow-map.js` to see it running
  with fake live stats. Use it as the reference for expected behavior.

## API

```js
const flow = PhantomFlow.mount(targetElementOrSelector, {
  title: "The Flow",                       // optional, panel kicker text
  subtitle: "work in motion — tap a station to open its desk", // optional
  height: 280,                             // optional, px, desktop
  heightMobile: 230,                       // optional, px, <=720px
  speed: 0.055,                            // optional, chain runs per second
  stations: [                              // optional — omit to use defaults below
    { id: "leads",     label: "Leads",     icon: "◉", stat: "—" },
    { id: "quotes",    label: "Quotes",    icon: "◆", stat: "—" },
    { id: "approvals", label: "Approvals", icon: "✓", stat: "—" },
    { id: "bookings",  label: "Bookings",  icon: "◷", stat: "—" },
    { id: "delivery",  label: "Delivery",  icon: "▶", stat: "—" },
    { id: "reviews",   label: "Reviews",   icon: "★", stat: "—" },
    { id: "money",     label: "Money",     icon: "◈", stat: "—", gold: true },
  ],
  collapseOnSmall: ["approvals", "delivery"], // station ids hidden <640px
  onStationClick: (id) => { /* open the matching desk */ },
});

flow.refresh({ leads: "5 open", money: "$4,000" }); // update any subset of stats
flow.destroy();                                     // remove everything cleanly
```

`refresh` accepts either a string per station id (the stat text) or an object
(`{ stat, label, icon }`) to change more than the stat.

## Where to put it in the PhantomForce admin app

The admin app is the module at `app/js/main.js` with desks defined in
`app/js/workspaces.js`. Recommended placement: **on the dashboard, directly
above the mission grid** (the `[data-mission]` widget grid), full width of the
main deck column.

Integration sketch (adapt to the actual file layout you find):

```js
import "./flow-map.js"; // or a <script> tag before main.js — it sets window.PhantomFlow

// after the dashboard shell exists (e.g. inside enterPhantom(), once):
const missionEl = document.querySelector("[data-mission]");
const mountPoint = document.createElement("div");
const missionSection = missionEl.closest("section") || missionEl;
missionSection.parentElement.insertBefore(mountPoint, missionSection);

const flow = PhantomFlow.mount(mountPoint, {
  subtitle: "work in motion — tap a station to open its desk",
  onStationClick: (id) => openWorkspace(FLOW_TO_WS[id] || id),
});

// wire live stats from the store (missionWidgets() already computes them):
const FLOW_TO_WS = { quotes: "proposals", delivery: "media" }; // flow id → workspace id
const syncFlow = () => {
  const byId = {};
  for (const w of missionWidgets()) byId[w.id] = w;
  flow.refresh({
    leads: byId.leads?.stat,
    quotes: byId.proposals?.stat,
    approvals: byId.approvals?.stat,
    bookings: byId.bookings?.stat,
    delivery: byId.media?.stat,
    reviews: byId.reviews?.stat,
    money: byId.money?.stat,
  });
};
syncFlow();
store.onChange(syncFlow);
```

Notes for this app specifically:

- Workspace ids differ from flow station ids in two cases: the Quotes desk is
  workspace `"proposals"` and the Delivery desk is workspace `"media"`. Map
  them in the click handler (see `FLOW_TO_WS` above).
- `openWorkspace(id)`, `missionWidgets()`, and `store.onChange()` already
  exist in the app — use them; do not duplicate stat computation.
- Mount once per session (guard against re-mounting on dashboard re-render).
- If the app HTML uses a cache-busting query on script tags (e.g.
  `main.js?v=1`), bump the version so browsers pick up the change.

## Acceptance checklist

- [ ] Panel appears above the mission grid, full deck width
- [ ] All 7 stations show real live numbers that change when store data changes
- [ ] Clicking each station opens the correct desk (Quotes → proposals desk,
      Delivery → media desk)
- [ ] Hover shows pointer cursor and brightens the station
- [ ] With `prefers-reduced-motion: reduce`, the map is static but clickable
- [ ] Narrow viewport (<640px) shows 5 stations without overlapping labels
