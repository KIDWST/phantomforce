import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const css = read("../app/phantom.css");
const desktopContext = read("../app/js/desktop-context.js");

assert.match(desktopContext, /function youtubeVideoId/u, "Desktop media bridge must extract YouTube ids from browser URLs.");
assert.match(desktopContext, /img\.youtube\.com\/vi\/\$\{encodeURIComponent\(youtubeId\)\}\/hqdefault\.jpg/u, "YouTube browser media should render a real video thumbnail.");
assert.match(desktopContext, /data-dc-mini-toggle/u, "The collapsed media bridge must be tappable.");
assert.match(desktopContext, /__pfDesktopMiniExpanded/u, "The media bridge needs an expanded state instead of staying permanently wide.");

assert.match(css, /@media \(min-width: 901px\) and \(max-width: 1450px\)/u, "Split-screen desktop width must have a dedicated topbar rule.");
assert.match(css, /\.desktop-context-top\s*\{[\s\S]*?flex:\s*0 0 54px/u, "The media bridge must collapse to a thumbnail-width control at split-screen widths.");
assert.match(css, /\.desktop-context-top \.dc-mini-shell\.is-expanded\s*\{[\s\S]*?position:\s*absolute/u, "Collapsed media must expand as a popover instead of pushing the whole navbar.");
assert.match(css, /@media \(min-width: 901px\) and \(max-width: 1180px\)[\s\S]*?\.status-pills\s*\{\s*display:\s*none/u, "Extra status pills must drop before the right-side controls collide.");

console.log("Topbar media responsive checks passed.");
