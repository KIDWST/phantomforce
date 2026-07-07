// Copies the xterm.js browser assets out of node_modules into public/vendor so
// Termina serves them itself (no CDN, fully offline/local). Runs on postinstall.
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)).replace(/scripts$/, "");
const vendorDir = path.join(root, "public", "vendor");
mkdirSync(vendorDir, { recursive: true });

const assets = [
  ["@xterm/xterm/lib/xterm.js", "xterm.js"],
  ["@xterm/xterm/css/xterm.css", "xterm.css"],
  ["@xterm/addon-fit/lib/addon-fit.js", "addon-fit.js"],
];

let copied = 0;
for (const [from, to] of assets) {
  const src = path.join(root, "node_modules", from);
  const dest = path.join(vendorDir, to);
  if (existsSync(src)) {
    copyFileSync(src, dest);
    copied += 1;
    console.log(`vendored ${to}`);
  } else {
    console.warn(`WARN: missing ${from} — run npm install first.`);
  }
}
console.log(`xterm vendor: ${copied}/${assets.length} assets copied to public/vendor`);
