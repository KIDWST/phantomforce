import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const pkg = JSON.parse(read("package.json"));
const claude = read("CLAUDE.md");
const ship = read("scripts/ship-live-admin.mjs");

assert(pkg.scripts["ship:live-admin"] === "node scripts/ship-live-admin.mjs", "package.json must expose ship:live-admin.");
assert(pkg.scripts["verify:live-admin"] === "node scripts/ship-live-admin.mjs --verify-only", "package.json must expose verify:live-admin.");
assert(claude.includes("C:\\Users\\jorda\\Documents\\Codex\\deployments\\phantomforce-live"), "CLAUDE.md must name the canonical deployment checkout.");
assert(!claude.includes("C:\\Users\\jorda\\Documents\\Codex\\worktrees\\phantomforce-live-social-analytics-20260712"), "CLAUDE.md must not point Claude at the stale social-analytics worktree.");
assert(claude.includes("npm run ship:live-admin -- --commit"), "CLAUDE.md must force the ship command.");
assert(claude.includes("LIVE ADMIN SHIP PASSED"), "CLAUDE.md must prohibit success claims without the pass banner.");
assert(ship.includes("phantom-live-\\d{8}-\\d+"), "ship script must bump/cache-check phantom-live build ids.");
assert(ship.includes("https://admin.phantomforce.online/"), "ship script must verify the public admin domain.");
assert(ship.includes("http://127.0.0.1:5177/"), "ship script must verify the local admin UI.");
assert(ship.includes("http://127.0.0.1:5190/"), "ship script must verify the local Hermes/API UI route.");
assert(ship.includes("git([\"commit\""), "ship script must commit.");
assert(ship.includes("git([\"push\", \"origin\", \"main\"]"), "ship script must push origin/main.");

console.log("Claude live ship guard OK");
