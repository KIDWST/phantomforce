import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { findGitRepos } from "../../mission/repos.js";

async function makeFakeRepo(root, ...segments) {
  const dir = path.join(root, ...segments);
  await mkdir(path.join(dir, ".git"), { recursive: true });
  return dir;
}

test("finds a repo at the scan root and in a nested folder", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "termina-repos-test-"));
  try {
    const repoA = await makeFakeRepo(root, "project-a");
    const repoB = await makeFakeRepo(root, "work", "project-b");
    const found = findGitRepos([root]);
    const paths = found.map((r) => r.path);
    assert.ok(paths.includes(repoA));
    assert.ok(paths.includes(repoB));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not hunt for a nested repo inside another repo", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "termina-repos-test-"));
  try {
    const outer = await makeFakeRepo(root, "outer");
    await makeFakeRepo(root, "outer", "vendor", "inner");
    const found = findGitRepos([root]);
    const paths = found.map((r) => r.path);
    assert.ok(paths.includes(outer));
    assert.ok(!paths.some((p) => p.includes("vendor")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("skips node_modules and hidden directories while scanning", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "termina-repos-test-"));
  try {
    await makeFakeRepo(root, "node_modules", "some-pkg");
    await makeFakeRepo(root, ".hidden");
    const found = findGitRepos([root]);
    assert.equal(found.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("returns an empty list for a root that doesn't exist", () => {
  const found = findGitRepos([path.join(os.tmpdir(), "termina-repos-test-does-not-exist")]);
  assert.deepEqual(found, []);
});
