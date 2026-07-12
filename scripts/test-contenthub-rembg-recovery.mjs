import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../app/js/contenthub.js", import.meta.url), "utf8");

assert.match(source, /getRembgStatus/,
  "Content Hub should retain the full background-removal readiness result.");
assert.match(source, /data-ch-lb-rembg-recheck/,
  "Unavailable background removal should provide an in-place re-check action.");
assert.match(source, /refreshRembgAvailability\(\{ retryOnce: true \}\)/,
  "The initial readiness check should recover from a transient session/startup race.");
assert.match(source, /getRembgStatus\(\{ recheck: force \}\)/,
  "Manual re-check should bypass the cached readiness result.");
assert.doesNotMatch(source, />Unavailable\.<\/p>/,
  "The editor should not hide the real readiness reason behind a dead generic label.");

console.log(JSON.stringify({
  ok: true,
  recovery: "automatic retry plus manual re-check",
  status_detail_preserved: true,
}));
