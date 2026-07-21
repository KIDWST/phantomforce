/* Third pass: some surfaces layer a faint accent glow OVER a solid-white base
 * gradient — e.g. `radial-gradient(...accent 0.08...), linear-gradient(180deg,
 * #ffffff, #ffffff)`. The first two sweeps skipped these (they contain an
 * accent color). Here we replace ONLY all-white linear-gradient layers whose
 * every color stop is high-opacity white with var(--glass), keeping the glow.
 * Low-opacity white gradients (sheens) are left alone.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "app");
const FILES = ["phantom.css", "competitor-intelligence.css", "phantomstore.css",
  "phantomplay.css", "phantomplay-v2.css", "orggraph.css", "phantom-workers.css",
  "agent-control-center.css"];

const WHITE_STOP = /^(?:#ffffff|#fff|rgba\(\s*255\s*,\s*255\s*,\s*255\s*(?:,\s*([\d.]+))?\s*\))(?:\s+[\d.]+%?)?$/i;

function stopIsHighWhite(stop) {
  const m = stop.trim().match(WHITE_STOP);
  if (!m) return false;
  const a = m[1] == null ? 1 : parseFloat(m[1]);
  return a >= 0.35;
}

// replace an all-high-white linear-gradient(...) with var(--glass)
function transform(css) {
  let count = 0;
  // split on commas only at paren-depth 0 (rgba() stops contain commas)
  const splitTop = (s) => {
    const out2 = []; let depth = 0, cur = "";
    for (const c of s) {
      if (c === "(") { depth++; cur += c; }
      else if (c === ")") { depth--; cur += c; }
      else if (c === "," && depth === 0) { out2.push(cur.trim()); cur = ""; }
      else cur += c;
    }
    if (cur.trim()) out2.push(cur.trim());
    return out2;
  };
  // allow one level of nested parens so rgba()/hsl() stops are captured
  const out = css.replace(/linear-gradient\(((?:[^()]|\([^()]*\))*)\)/gi, (whole, inner) => {
    const parts = splitTop(inner);
    // first part may be an angle/side ("180deg", "to right"); the rest are stops
    const first = parts[0];
    const isDirection = /deg$|^to\s|^\d/.test(first) && !/^#|^rgba?\(/i.test(first);
    const stops = isDirection ? parts.slice(1) : parts;
    if (stops.length < 2) return whole;
    if (stops.every(stopIsHighWhite)) { count++; return "var(--glass)"; }
    return whole;
  });
  return { out, count };
}

let total = 0;
for (const f of FILES) {
  const p = path.join(APP, f);
  const css = fs.readFileSync(p, "utf8");
  const { out, count } = transform(css);
  if (count) { fs.writeFileSync(p, out); total += count; console.log(`${f}: ${count} white base layer(s) darkened`); }
  else console.log(`${f}: no changes`);
}
console.log(`\nTOTAL: ${total} accent-over-white base layers routed to var(--glass).`);
