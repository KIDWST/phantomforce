import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const kernelCss = join(root, "app", "games", "shared", "phantomGameKernel.css");
const kernelJs = join(root, "app", "games", "shared", "phantomGameKernel.js");

const games = [
  {
    id: "crown-circuit",
    title: "Crown Circuit",
    theme: "crown",
    file: join(root, "app", "games", "crown-circuit.html"),
    standalone: true,
    href: "shared/phantomGameKernel.css",
    src: "shared/phantomGameKernel.js"
  },
  {
    id: "kingdom-breakers",
    title: "Kingdom Breakers",
    theme: "kingdom",
    file: join(root, "app", "games", "kingdom-breakers.html"),
    standalone: true,
    href: "shared/phantomGameKernel.css",
    src: "shared/phantomGameKernel.js"
  },
  {
    id: "phantom-strike",
    title: "Phantom Strike",
    theme: "strike",
    file: join(root, "app", "games", "phantom-strike.html"),
    standalone: true,
    href: "shared/phantomGameKernel.css",
    src: "shared/phantomGameKernel.js"
  },
  {
    id: "phantom-grand-prix",
    title: "Chicklet Grand Prix",
    theme: "prix",
    file: join(root, "app", "games", "phantom-grand-prix", "index.html"),
    href: "../shared/phantomGameKernel.css",
    src: "../shared/phantomGameKernel.js"
  },
  {
    id: "phantom-ages",
    title: "Phantom Ages",
    theme: "ages",
    file: join(root, "app", "games", "phantom-ages", "index.html"),
    href: "../shared/phantomGameKernel.css",
    src: "../shared/phantomGameKernel.js"
  },
  {
    id: "skyguard-arena",
    title: "Skyguard Arena",
    theme: "skyguard",
    file: join(root, "app", "games", "skyguard-arena", "index.html"),
    href: "../shared/phantomGameKernel.css",
    src: "../shared/phantomGameKernel.js"
  }
];

const failures = [];
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

assert(existsSync(kernelCss), "shared kernel CSS is missing");
assert(existsSync(kernelJs), "shared kernel JS is missing");

const css = readFileSync(kernelCss, "utf8");
const js = readFileSync(kernelJs, "utf8");

for (const token of [
  ".pgk-boot",
  ".pgk-command-button",
  ".pgk-advisor",
  ".pgk-panel",
  "pgk-reduced",
  "pgk-contrast",
  'body[data-pgk-theme="crown"]',
  'body[data-pgk-theme="skyguard"]',
  'body[data-pgk-theme="strike"]',
  'body[data-pgk-theme="prix"]',
  'body[data-pgk-theme="ages"]',
  'body[data-pgk-theme="kingdom"]'
]) {
  assert(css.includes(token), `kernel CSS missing ${token}`);
}

for (const token of [
  "window.PhantomGameKernel",
  "requestAnimationFrame",
  "localStorage",
  "navigator.getGamepads",
  "aria-live",
  "data-pgk-command",
  "performance.now",
  "longFrames",
  "prefers-reduced-motion",
  "phantom-game-kernel:scene"
]) {
  assert(js.includes(token), `kernel JS missing ${token}`);
}

const seenThemes = new Set();
for (const game of games) {
  const html = readFileSync(game.file, "utf8");
  const compact = html.replace(/\s+/g, "");
  const compactTitle = game.title.replace(/\s+/g, "");
  assert(html.includes(game.href), `${game.id} missing kernel CSS include`);
  assert(html.includes(game.src), `${game.id} missing kernel JS include`);
  assert(html.includes("PhantomGameKernel.init") || html.includes("data-pgk-config"), `${game.id} missing kernel init`);
  assert(html.includes(`id: "${game.id}"`) || compact.includes(`"id":"${game.id}"`), `${game.id} init missing stable id`);
  assert(html.includes(`title: "${game.title}"`) || compact.includes(`"title":"${compactTitle}"`), `${game.id} init missing game title`);
  assert(html.includes(`theme: "${game.theme}"`) || compact.includes(`"theme":"${game.theme}"`), `${game.id} init missing theme`);
  assert(html.includes("sceneSelectors"), `${game.id} missing scene selector mapping`);
  assert(html.includes("advisor:") || html.includes('"advisor"'), `${game.id} missing game-specific advisor copy`);
  assert(!seenThemes.has(game.theme), `${game.id} reuses theme ${game.theme}`);
  seenThemes.add(game.theme);

  if (game.standalone) {
    assert(html.includes("style-src 'self' 'unsafe-inline'"), `${game.id} CSP does not allow shared stylesheet`);
    assert(html.includes("script-src 'self' 'unsafe-inline'"), `${game.id} CSP does not allow shared script`);
  }
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log(`Phantom game kernel wired for ${games.length} games.`);
