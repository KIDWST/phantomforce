import assert from "node:assert/strict";
import { mkdtemp, readFile as fsReadFile, rm, writeFile as fsWriteFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { listDirectory, readFile, runCommand, writeFile } from "../../openrouter-agent/tools.mjs";

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "termina-openrouter-tools-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("readFile returns file contents", async () => {
  await withTempDir(async (cwd) => {
    await fsWriteFile(path.join(cwd, "a.txt"), "hello world", "utf8");
    const result = await readFile({ path: "a.txt" }, { cwd });
    assert.equal(result.content, "hello world");
  });
});

test("readFile on a missing file returns an error, not a throw", async () => {
  await withTempDir(async (cwd) => {
    const result = await readFile({ path: "nope.txt" }, { cwd });
    assert.ok(result.error);
  });
});

test("writeFile is blocked in plan mode", async () => {
  await withTempDir(async (cwd) => {
    const result = await writeFile({ path: "b.txt", content: "x" }, { cwd, mode: "plan" });
    assert.match(result.error, /plan mode/i);
    await assert.rejects(fsReadFile(path.join(cwd, "b.txt"), "utf8"));
  });
});

test("writeFile succeeds in auto mode", async () => {
  await withTempDir(async (cwd) => {
    const result = await writeFile({ path: "b.txt", content: "hello" }, { cwd, mode: "auto" });
    assert.equal(result.ok, true);
    assert.equal(await fsReadFile(path.join(cwd, "b.txt"), "utf8"), "hello");
  });
});

test("listDirectory lists entries in a populated directory", async () => {
  await withTempDir(async (cwd) => {
    await fsWriteFile(path.join(cwd, "one.txt"), "", "utf8");
    await fsWriteFile(path.join(cwd, "two.txt"), "", "utf8");
    const result = await listDirectory({ path: "." }, { cwd });
    assert.deepEqual(result.entries.sort(), ["one.txt", "two.txt"]);
  });
});

test("runCommand executes a real command and captures stdout/exitCode", async () => {
  await withTempDir(async (cwd) => {
    const result = await runCommand({ command: "echo hi" }, { cwd, mode: "auto" });
    assert.match(result.stdout, /hi/);
    assert.equal(result.exitCode, 0);
  });
});

test("runCommand is blocked in plan mode", async () => {
  await withTempDir(async (cwd) => {
    const result = await runCommand({ command: "echo hi" }, { cwd, mode: "plan" });
    assert.match(result.error, /plan mode/i);
  });
});
