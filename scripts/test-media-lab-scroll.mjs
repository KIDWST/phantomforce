import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../app/creator-studio.css", import.meta.url), "utf8");

assert.match(
  css,
  /Media Lab must always be scrollable from the page itself[\s\S]*?\.app-main:has\(\.workspace-page\[data-workspace-page="media"\]\)\s*\{[\s\S]*?height:\s*auto;[\s\S]*?min-height:\s*100dvh;[\s\S]*?overflow-y:\s*auto;/u,
  "Media Lab must let the app page own vertical scrolling.",
);

assert.match(
  css,
  /\.app-main:has\(\.workspace-page\[data-workspace-page="media"\]\) \.console-workspace,[\s\S]*?\.workspace-page\[data-workspace-page="media"\] \.ml-body\s*\{[\s\S]*?height:\s*auto;[\s\S]*?max-height:\s*none;[\s\S]*?overflow-y:\s*visible;/u,
  "Media Lab shell/body containers must not trap wheel or touch scroll in hidden fixed-height panes.",
);

assert.match(
  css,
  /\.workspace-page\[data-workspace-page="media"\] \.ml-stage,[\s\S]*?\.workspace-page\[data-workspace-page="media"\] \.ml-stage-view\s*\{[\s\S]*?height:\s*auto;[\s\S]*?min-height:\s*clamp/u,
  "Media Lab stage must have natural height instead of a non-scrollable 100% viewport trap.",
);

assert.match(
  css,
  /\.workspace-page\[data-workspace-page="media"\] \.ml-brief,[\s\S]*?\.workspace-page\[data-workspace-page="media"\] \.ml-tools\s*\{[\s\S]*?-webkit-overflow-scrolling:\s*touch;[\s\S]*?overscroll-behavior:\s*contain;/u,
  "Dense Media Lab subpanels must keep smooth internal scrolling where needed.",
);

console.log("Media Lab scroll checks passed.");
