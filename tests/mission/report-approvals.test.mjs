import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { readReportApprovals, writeReportApproval } from "../../mission/store.js";

async function withTempAppDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "termina-report-approvals-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("readReportApprovals returns an empty object when nothing was ever approved", async () => {
  await withTempAppDir(async (appDir) => {
    assert.deepEqual(readReportApprovals(appDir, "m1"), {});
  });
});

test("writeReportApproval records a decision and round-trips via readReportApprovals", async () => {
  await withTempAppDir(async (appDir) => {
    const all = await writeReportApproval(appDir, "m1", "step-1", "approved");
    assert.equal(all["step-1"], "approved");
    assert.deepEqual(readReportApprovals(appDir, "m1"), { "step-1": "approved" });
  });
});

test("concurrent writes to two different step ids both land", async () => {
  await withTempAppDir(async (appDir) => {
    await Promise.all([
      writeReportApproval(appDir, "m1", "step-1", "approved"),
      writeReportApproval(appDir, "m1", "step-2", "skipped"),
    ]);
    const all = readReportApprovals(appDir, "m1");
    assert.equal(all["step-1"], "approved");
    assert.equal(all["step-2"], "skipped");
  });
});
