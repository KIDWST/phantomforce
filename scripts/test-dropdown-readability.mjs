import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const appRoot = join(root, "app");
const css = await readFile(join(appRoot, "admin-next.css"), "utf8");
const index = await readFile(join(appRoot, "index.html"), "utf8");

async function sourceFiles(dir) {
  const rows = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) rows.push(...await sourceFiles(path));
    else if ([".html", ".js"].includes(extname(entry.name))) rows.push(path);
  }
  return rows;
}

function cssBlock(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return source.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, "u"))?.[1] || "";
}

function value(block, property) {
  return block.match(new RegExp(`${property}\\s*:\\s*([^;]+)`, "u"))?.[1]?.trim() || "";
}

function rgb(hex) {
  const value = hex.replace("#", "");
  const normalized = value.length === 3 ? [...value].map((part) => part + part).join("") : value;
  assert.match(normalized, /^[0-9a-f]{6}$/iu, `Expected a six-digit color, received ${hex}.`);
  return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16));
}

function luminance(hex) {
  const channels = rgb(hex).map((channel) => {
    const ratio = channel / 255;
    return ratio <= 0.04045 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const files = await sourceFiles(appRoot);
const selectInventory = [];
let selectCount = 0;
for (const file of files) {
  const source = await readFile(file, "utf8");
  const count = source.match(/<select\b/gu)?.length || 0;
  if (count) selectInventory.push({ file: relative(root, file).replaceAll("\\", "/"), count });
  selectCount += count;
}

assert(selectInventory.length >= 20, `Expected the shared contract to cover the broad dropdown inventory; found ${selectInventory.length} source files.`);
assert(selectCount >= 70, `Expected at least 70 native selects in the product shell; found ${selectCount}.`);

const linkedStyles = [...index.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/gu)].map((match) => match[1]);
assert(linkedStyles.at(-1)?.includes("admin-next.css"), "The dropdown contract stylesheet must load last so module styles cannot resurrect unreadable native menus.");

assert.match(css, /html:not\(\[data-org-color-mode="light"\]\) :where\(select\)\s*\{[\s\S]{0,120}color-scheme:\s*dark\s*!important/u, "Dark mode must put the color scheme directly on native selects.");
assert.match(css, /html\[data-org-color-mode="light"\] :where\(select\)\s*\{[\s\S]{0,120}color-scheme:\s*light\s*!important/u, "Light mode must put the color scheme directly on native selects.");
assert.match(css, /:where\(select\) :where\(option, optgroup\)\s*\{[\s\S]{0,500}background-color:[^;]+!important[\s\S]{0,300}color:[^;]+!important/u, "Every option and optgroup must own an explicit popup background and foreground.");
assert.match(css, /:where\(select\) option:checked,[\s\S]{0,220}:where\(select\) option:hover,[\s\S]{0,220}:where\(select\) option:focus/u, "Selected, hover, and focus rows must share an explicit high-contrast treatment.");
assert.match(css, /:where\(select\) option:disabled,[\s\S]{0,220}:where\(select:disabled\)/u, "Disabled options and controls must remain readable without opacity washout.");
assert.match(css, /:where\(select:disabled\) option:checked,[\s\S]{0,180}:where\(select\) option:disabled:checked[\s\S]{0,320}--pf-native-option-bg/u, "A disabled selected option must return to the neutral option surface instead of mixing muted text with the selected background.");
assert.match(css, /@media \(forced-colors: active\)[\s\S]{0,260}forced-color-adjust:\s*auto/u, "Forced-colors users must retain their system-native dropdown palette.");

const contract = css.slice(css.indexOf("/* Dropdown readability contract"));
const light = cssBlock(contract, 'html[data-org-color-mode="light"]');
const dark = contract.slice(0, contract.indexOf('html[data-org-color-mode="light"]'));
const tokens = (block) => ({
  bg: value(block, "--pf-native-option-bg"),
  fg: value(block, "--pf-native-option-fg"),
  selectedBg: value(block, "--pf-native-option-selected-bg"),
  selectedFg: value(block, "--pf-native-option-selected-fg"),
  disabledFg: value(block, "--pf-native-option-disabled-fg"),
});

const darkTokens = tokens(dark);
const lightTokens = tokens(light);
const ratios = {
  dark: {
    option: contrast(darkTokens.fg, darkTokens.bg),
    selected: contrast(darkTokens.selectedFg, darkTokens.selectedBg),
    disabled: contrast(darkTokens.disabledFg, darkTokens.bg),
  },
  light: {
    option: contrast(lightTokens.fg, lightTokens.bg),
    selected: contrast(lightTokens.selectedFg, lightTokens.selectedBg),
    disabled: contrast(lightTokens.disabledFg, lightTokens.bg),
  },
};

for (const [theme, states] of Object.entries(ratios)) {
  for (const [state, ratio] of Object.entries(states)) {
    assert(ratio >= 4.5, `${theme} ${state} dropdown contrast must be at least 4.5:1; received ${ratio.toFixed(2)}:1.`);
  }
}

console.log(JSON.stringify({
  ok: true,
  selectFiles: selectInventory.length,
  nativeSelects: selectCount,
  contractStylesheetLoadsLast: true,
  contrast: Object.fromEntries(Object.entries(ratios).map(([theme, states]) => [theme, Object.fromEntries(Object.entries(states).map(([state, ratio]) => [state, Number(ratio.toFixed(2))]))])),
}, null, 2));
