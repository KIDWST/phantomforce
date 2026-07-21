/* One-shot: route hardcoded white SURFACE backgrounds through the mode-aware
 * tokens (--glass / --glass-2) so dark mode stops showing white boxes while
 * light mode is unchanged (in light mode --glass is white). Conservative:
 *   - only touches `background` / `background-color` / `background-image`
 *   - only converts HIGH-opacity white ( >=0.35 ) or solid #fff/#ffffff, and
 *     white->white gradients
 *   - SKIPS values that also carry an accent stop (purple/neon/risk/warn),
 *     which are colored buttons/tints, not white boxes
 *   - SKIPS low-opacity white (<0.35) — those are sheens on dark glass
 * Prints every change for review. Idempotent.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "app");
const FILES = ["phantom.css", "competitor-intelligence.css", "phantomstore.css",
  "phantomplay.css", "phantomplay-v2.css", "orggraph.css", "phantom-workers.css",
  "agent-control-center.css"];

// accent signatures — if a value contains any, it's a colored surface: skip.
const ACCENT = [
  /rgba?\(\s*91,\s*76,\s*255/, /#5b4cff/i, /#b44bf0/i, /#7027f6/i, /#8d82ff/i, /#7a6eff/i,
  /rgba?\(\s*37,\s*18,\s*116/, /rgba?\(\s*180,\s*75,\s*240/, /rgba?\(\s*105,\s*34,\s*246/,
  /rgba?\(\s*112,\s*39,\s*246/, /rgba?\(\s*88,\s*44,\s*246/, /rgba?\(\s*56,\s*21,\s*217/,
  /rgba?\(\s*134,\s*107,\s*249/, /rgba?\(\s*143,\s*233,\s*255/, /#e0345e/i, /#c77e00/i,
  /rgba?\(\s*224,\s*52,\s*94/, /rgba?\(\s*199,\s*126,\s*0/, /var\(--neon/, /var\(--risk/,
  /var\(--warn/, /var\(--dawn/, /var\(--dusk/, /var\(--gold/, /var\(--uv/, /#3a5a9a/i, /#243a6a/i,
];

// find each background declaration's value (up to `;` at paren-depth 0)
function transform(css) {
  const changes = [];
  const re = /\bbackground(?:-color|-image)?\s*:/g;
  let out = "", last = 0, m;
  while ((m = re.exec(css))) {
    const propStart = m.index, valStart = re.lastIndex;
    // walk to terminating ; respecting parens
    let i = valStart, depth = 0;
    for (; i < css.length; i++) {
      const c = css[i];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (c === ";" && depth === 0) break;
      else if (c === "}" && depth === 0) break;
    }
    const value = css.slice(valStart, i);
    const replaced = classify(value);
    out += css.slice(last, valStart);
    if (replaced != null) {
      out += " " + replaced;
      changes.push({ before: value.trim(), after: replaced });
    } else {
      out += value;
    }
    last = i;
    re.lastIndex = i;
  }
  out += css.slice(last);
  return { out, changes };
}

function classify(value) {
  const v = value.trim();
  if (ACCENT.some((r) => r.test(v))) return null;              // colored surface — leave
  const solidWhite = /^#fff(fff)?$/i.test(v);
  // collect white alphas present
  const whiteAlphas = [...v.matchAll(/rgba?\(\s*255,\s*255,\s*255\s*,\s*(\.?\d+(?:\.\d+)?)\s*\)/g)]
    .map((mm) => parseFloat(mm[1]));
  const hasHardWhite = /#fff(fff)?\b/i.test(v);
  // does the value contain any NON-white color content? (ignore transparent + white)
  const stripped = v
    .replace(/rgba?\(\s*255,\s*255,\s*255[^)]*\)/g, "")
    .replace(/#fff(fff)?\b/gi, "")
    .replace(/transparent/g, "");
  const hasOtherColor = /#[0-9a-f]{3,8}\b|rgba?\(/i.test(stripped);
  if (hasOtherColor) return null;                              // mixed — not a pure white box

  if (solidWhite) return "var(--glass-2)";                     // was fully opaque white
  const highWhite = whiteAlphas.some((a) => a >= 0.35) || hasHardWhite;
  if (!highWhite) return null;                                 // low-opacity sheen — keep
  // white surface (solid #fff inside gradient, or translucent >=0.35, or white->white gradient)
  if (hasHardWhite && /gradient|,/.test(v)) return "var(--glass-2)";
  return "var(--glass)";
}

let total = 0;
for (const f of FILES) {
  const p = path.join(APP, f);
  const css = fs.readFileSync(p, "utf8");
  const { out, changes } = transform(css);
  if (changes.length) {
    fs.writeFileSync(p, out);
    total += changes.length;
    console.log(`\n=== ${f}: ${changes.length} surface(s) darkened ===`);
    const sample = changes.slice(0, 6);
    for (const c of sample) console.log(`  ${c.before.slice(0, 66)}  ->  ${c.after}`);
    if (changes.length > 6) console.log(`  … +${changes.length - 6} more`);
  } else {
    console.log(`${f}: no changes`);
  }
}
console.log(`\nTOTAL: ${total} white surface backgrounds routed through mode tokens.`);
