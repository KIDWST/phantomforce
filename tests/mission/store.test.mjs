import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { appendLedger, readLedger, readMission, readReport, writeMission, writeReport } from "../../mission/store.js";

async function withTempAppDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "termina-mission-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("mission.json round-trips through write/read", async () => {
  await withTempAppDir(async (appDir) => {
    const mission = { id: "abc123", name: "Test", objective: "Do the thing", workers: [] };
    await writeMission(appDir, "abc123", mission);
    assert.deepEqual(readMission(appDir, "abc123"), mission);
  });
});

test("reading a mission that was never written returns null", async () => {
  await withTempAppDir(async (appDir) => {
    assert.equal(readMission(appDir, "does-not-exist"), null);
  });
});

test("ledger events append in order and survive a round trip", async () => {
  await withTempAppDir(async (appDir) => {
    await appendLedger(appDir, "m1", { workerId: "w1", type: "STARTED" });
    await appendLedger(appDir, "m1", { workerId: "w1", type: "COMPLETE" });
    const ledger = readLedger(appDir, "m1");
    assert.equal(ledger.length, 2);
    assert.equal(ledger[0].type, "STARTED");
    assert.equal(ledger[1].type, "COMPLETE");
    assert.ok(typeof ledger[0].ts === "number");
  });
});

test("report round-trips through write/read", async () => {
  await withTempAppDir(async (appDir) => {
    await writeReport(appDir, "m1", "# Report\n\nDone.");
    assert.equal(readReport(appDir, "m1"), "# Report\n\nDone.");
  });
});

test("reading a report that was never written returns null", async () => {
  await withTempAppDir(async (appDir) => {
    assert.equal(readReport(appDir, "m1"), null);
  });
});
