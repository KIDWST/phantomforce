import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { initialDocument, migrateDocument } from "../src/platform.mjs";

const root = resolve(import.meta.dirname, "..");

test("empty and representative documents migrate without discarding domain records", () => {
  const empty = migrateDocument(null, "2026-08-17T00:00:00.000Z"); assert.equal(empty.schemaVersion, 2); assert.equal(Object.keys(empty.workspaces["ai-demo-workspace"].entitlements).length, 10); assert.ok(Array.isArray(empty.sources)); assert.ok(Array.isArray(empty.consentRecords)); assert.ok(Array.isArray(empty.traces));
  const representative = initialDocument("2026-08-16T00:00:00.000Z"); representative.artifacts.push({ id: "existing", workspaceId: "ai-demo-workspace", productId: "phantom-oracle" }); const migrated = migrateDocument(representative, "2026-08-17T00:00:00.000Z"); assert.equal(migrated.artifacts[0].id, "existing");
  assert.throws(() => migrateDocument({ schemaVersion: 99 }), (error) => error.code === "SCHEMA_TOO_NEW");
});

test("UI provides semantic landmarks, labels, live status, keyboard close, and synchronized drawer state", async () => {
  const html = await readFile(resolve(root, "public/index.html"), "utf8"); const app = await readFile(resolve(root, "public/app.js"), "utf8");
  for (const token of ['<html lang="en">', 'class="skip-link"', '<main id="main"', 'aria-live="polite"', 'aria-label="Exactly ten AI products"', '<form id="artifact-form">']) assert.ok(html.includes(token), token);
  assert.equal(/onclick=|onchange=|onsubmit=/i.test(html), false);
  assert.match(app, /event\.key === "Escape"/); assert.match(app, /aria-expanded", "false"/); assert.match(app, /Formula and inputs/); assert.match(app, /Source fields were preserved/);
  assert.match(app, /Complete core loop/); assert.match(app, /role=\"alertdialog\"/); assert.match(app, /data-edit/); assert.match(app, /aria-busy/);
  assert.equal(/event\.currentTarget\.reset\(\)/.test(app), false, "async workflow must not reset through a cleared event.currentTarget");
});

test("responsive and inclusive CSS covers touch, narrow screens, focus, reduced motion, and forced colors", async () => {
  const css = await readFile(resolve(root, "public/styles.css"), "utf8");
  for (const token of ["min-height:44px", "min-width:320px", "max-width:1100px", "max-width:760px", "max-width:420px", "prefers-reduced-motion:reduce", "forced-colors:active", ":focus-visible", ".core-loop", ".status-region.loading"]) assert.ok(css.includes(token), token);
  assert.match(css, /\.create-panel\{order:1\}\.list-panel\{order:2\}/, "mobile first-run action must precede the empty artifact list");
});
