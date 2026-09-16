import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = fs.readFileSync(path.join(root, "app", "admin-next.css"), "utf8");
const index = fs.readFileSync(path.join(root, "app", "index.html"), "utf8");

assert.match(css, /PHANTOMFORCE GRAPHITE THEME/u, "The final admin stylesheet must expose the graphite theme authority.");
assert.match(css, /--pf-black:\s*#090d12/u, "The application canvas must use neutral graphite, not green-black.");
assert.match(css, /--pf-panel:\s*#111820/u, "Primary panels must use a neutral slate surface.");
assert.match(css, /--pf-panel-raised:\s*#17202a/u, "Raised panels must use a distinct neutral slate surface.");
assert.match(css, /--pf-line:\s*rgba\(166, 180, 194, \.14\)/u, "Default separators must be neutral gray.");
assert.match(css, /\.os-command-rail[\s\S]*?linear-gradient\(180deg, #121923, #0c1118\)/u, "The command rail must use the graphite shell palette.");
assert.match(css, /\.workspace-page[\s\S]*?#0e141b\s*!important/u, "Workspace pages must use the graphite canvas.");
assert.match(css, /\.crm-app \.crm-metrics article[\s\S]*?background:\s*#17202a\s*!important/u, "CRM metrics must use raised slate cards.");
assert.match(css, /\.crm-app \.crm-card\.is-selected[\s\S]*?inset 2px 0 var\(--pf-green\)/u, "CRM selection must reserve green for the active-state signal.");
assert.match(css, /\.btn-primary[\s\S]*?background:\s*var\(--pf-green\)\s*!important/u, "Primary actions must retain the bright green accent.");
assert.match(index, /meta name="theme-color" content="#090d12"/u, "Browser chrome must match the graphite canvas.");
assert.match(index, /radial-gradient\(circle at 50% 46%, rgba\(27, 38, 49/u, "The boot surface must use neutral slate materials.");

console.log("Graphite theme checks passed: neutral canvas, slate hierarchy, green signal accents.");
