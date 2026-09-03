import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { requestPhantomPlayEngineCommand } from "../src/phantomplay-engine-agent.js";

// Explicit opt-in: consumes a real local Codex run. Never touches installed games.
if (!process.argv.includes("--live")) throw Error("Pass --live to test the actual Codex execution bridge.");
const evidence = process.env.PHANTOM_ENGINE_TEST_OUTPUT || "G:/Codex/artifacts/phantom-engine/2026-09-03";
await mkdir(evidence, { recursive: true });
const root = await mkdtemp(join(evidence, "live-fixture-"));
await writeFile(join(root, "package.json"), JSON.stringify({ name: "engine-live-fixture", type: "module", scripts: { test: "node --test" } }));
await writeFile(join(root, "game.js"), "export function damage(health, amount) { return health + amount; }\n");
await writeFile(join(root, "game.test.js"), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { damage } from './game.js';\ntest('damage reduces health and never goes below zero', () => { assert.equal(damage(100,25),75); assert.equal(damage(10,25),0); });\n");
const testBefore = await readFile(join(root, "game.test.js"), "utf8");
const result = await requestPhantomPlayEngineCommand({ gameId: "engine-live-fixture", projectTitle: "Isolated bridge proof", cwd: root, provider: "codex", timeoutMs: 240_000,
  instruction: "Fix game.js damage so damage reduces health and clamps the result to zero. Do not modify tests or package.json. Run node --test, fix any failure, then report the actual result. No other work is requested." },
  { onProgress: phase => console.log(phase) });
await writeFile(join(root, "bridge-result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ root, result }, null, 2));
assert(result.ok, result.ok ? "" : result.error);
assert(result.changedFiles.includes("game.js"));
assert(result.commands.length > 0, "No real CLI command evidence");
assert.equal(await readFile(join(root, "game.test.js"), "utf8"), testBefore);
const testOutput = execFileSync(process.execPath, ["--test", "game.test.js"], { cwd: root, encoding: "utf8", windowsHide: true });
await writeFile(join(root, "independent-test.txt"), testOutput);
console.log("PASS: actual worker edited the fixture; unchanged tests pass independently.");
