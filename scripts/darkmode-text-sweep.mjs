/* Pair to the surface sweep: route hardcoded DARK text literals through the
 * mode-aware ink tokens so text stays dark on light (light mode) and light on
 * dark (dark mode). Only touches `color:` (never background/border/shadow),
 * and only near-black / muted-lavender inks that are ALWAYS primary/secondary
 * text on a light surface — never button labels (those are #fff and untouched).
 * Idempotent; prints a summary.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "app");
const FILES = ["phantom.css", "competitor-intelligence.css", "phantomstore.css",
  "phantomplay.css", "phantomplay-v2.css", "orggraph.css", "phantom-workers.css",
  "agent-control-center.css"];

// exact ink literals → token. near-black => --ink; muted => --dim / --dim-2.
const INK = new Set(["#241f3f", "#2b2649", "#211d3a", "#1a1226", "#0e0a16", "#241f3f".toLowerCase()]);
const DIM = new Set(["#5d5880", "#4a4568", "#3a2c50"]);
const DIM2 = new Set(["#8b87a8", "#6e6992", "#776d97"]);

function replVal(v) {
  const t = v.trim().toLowerCase();
  if (INK.has(t)) return "var(--ink)";
  if (DIM.has(t)) return "var(--dim)";
  if (DIM2.has(t)) return "var(--dim-2)";
  // dark near-black rgba used as text (high alpha) => ink; treat as text since
  // this is a color: declaration only.
  const m = t.match(/^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)\s*(?:,\s*([\d.]+))?\)$/);
  if (m) {
    const r = +m[1], g = +m[2], b = +m[3], a = m[4] == null ? 1 : parseFloat(m[4]);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;   // perceived brightness 0..255
    if (a >= 0.55 && lum < 90) return "var(--ink)";       // dark opaque-ish text
    if (a >= 0.4 && lum < 140) return "var(--dim)";        // muted dark text
  }
  return null;
}

function transform(css) {
  const changes = [];
  const re = /\bcolor\s*:/g;
  let out = "", last = 0, m;
  while ((m = re.exec(css))) {
    // skip -color longhands (background-color, border-color, etc.): require the
    // char before "color" to be a boundary that isn't '-'
    const before = css[m.index - 1];
    if (before === "-") { continue; }
    const valStart = re.lastIndex;
    let i = valStart, depth = 0;
    for (; i < css.length; i++) {
      const c = css[i];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if ((c === ";" || c === "}") && depth === 0) break;
    }
    const value = css.slice(valStart, i);
    const rep = replVal(value);
    out += css.slice(last, valStart);
    if (rep != null) { out += " " + rep; changes.push({ before: value.trim(), after: rep }); }
    else out += value;
    last = i; re.lastIndex = i;
  }
  out += css.slice(last);
  return { out, changes };
}

let total = 0;
for (const f of FILES) {
  const p = path.join(APP, f);
  const css = fs.readFileSync(p, "utf8");
  const { out, changes } = transform(css);
  if (changes.length) {
    fs.writeFileSync(p, out);
    total += changes.length;
    const counts = {};
    for (const c of changes) counts[c.after] = (counts[c.after] || 0) + 1;
    console.log(`${f}: ${changes.length}  (${Object.entries(counts).map(([k, v]) => `${v}×${k}`).join(", ")})`);
  } else console.log(`${f}: no changes`);
}
console.log(`\nTOTAL: ${total} dark text literals routed through ink tokens.`);
