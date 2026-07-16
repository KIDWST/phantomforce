import { readFileSync } from "node:fs";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function readProjectFile(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const indexHtml = readProjectFile("apps/web/public/app/index.html");
const mainJs = readProjectFile("apps/web/public/app/js/main.js");
const css = readProjectFile("apps/web/public/app/phantom.css");

const buildId = "phantom-live-20260713-qa-sweep-01";

assert(
  indexHtml.includes('<section class="flowmap is-map-open" data-map-section'),
  "Operations map should start open when the visible map is rendered.",
);
assert(indexHtml.includes("<span>Close map</span>"), "Open map should expose a close action when visible.");
assert(!indexHtml.includes("<span>Hide map</span>"), "Map header should use the requested Close map label.");
assert(!indexHtml.includes("<span>Close</span>"), "Map header should not show a vague Close label.");
assert(indexHtml.includes(`window.PHANTOM_BUILD = "${buildId}"`), "Index build id should be bumped.");
assert(indexHtml.includes(`/app/js/main.js?v=${buildId}`), "Index should load the bumped main module.");
assert(mainJs.includes(`./flowmap.js?v=${buildId}`), "Main module should load the bumped flowmap import.");
assert(mainJs.includes(`const POSE_VERSION = "${buildId}"`), "Pose asset cache should be bumped.");

assert(
  !mainJs.includes("if (section.classList.contains(\"is-map-open\")) {\n    closeOperationsMap();"),
  "Open map action should not toggle an already-open map closed.",
);
assert(mainJs.includes("const alreadyOpen = section.classList.contains(\"is-map-open\");"), "Open map should be idempotent.");
assert(mainJs.includes("if (!alreadyOpen) {"), "Map open animation should only run on actual open.");
assert(mainJs.includes("updateOperationsMapControls();\n  renderActivity();"), "Dashboard render should refresh map control state.");
assert(
  mainJs.includes("button.hidden = isOpen;"),
  "Header Open map button should be hidden while the map is open.",
);
assert(mainJs.includes("button.hidden = !isOpen;"), "Close map control should hide when map is closed.");
assert(
  mainJs.includes(`label.textContent = "Open map";`),
  "Open map control should not be relabeled as a close action.",
);
assert(
  mainJs.includes(`$$("[data-map-open-label]").forEach`),
  "Open map label sync should use the multi-element selector helper.",
);
assert(
  !mainJs.includes(`label.textContent = isOpen ? "Close map" : "Open map";`),
  "Close map copy should not stay wired to the open action.",
);

assert(
  css.includes(".flowmap.is-map-open .flow-map-open { display: none; }"),
  "Open map control should not display while the map is already open.",
);
assert(
  css.includes(".flowmap.is-map-closed .flow-stage { display: none; }"),
  "Closed map state should actually hide the map stage.",
);
assert(
  css.includes(".flowmap.is-map-open .flow-map-close { display: inline-flex; }"),
  "Close map control should display while the map is open.",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      buildId,
      initialMapState: "open",
      openButtonHiddenWhenOpen: true,
      closeButtonHidesStage: true,
      openActionIdempotent: true,
    },
    null,
    2,
  ),
);
