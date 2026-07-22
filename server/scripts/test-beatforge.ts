import assert from "node:assert/strict";

import { buildBeatForgePreview } from "../src/phantom-ai/beatforge.js";

const preview = buildBeatForgePreview({
  beatName: "Northside Bounce",
  beatPath: "C:\\Users\\jorda\\Music\\owned\\northside-bounce.wav",
  bpm: 147,
  key: "F minor",
  daw: "fl-studio",
  kitName: "Jordan Drill Kit",
  stylePrompt: "bouncy Chicago drill drums with clean 808 slides",
  kitSounds: [
    { name: "JD Hard Kick", role: "kick", note: "C1" },
    { name: "JD Snare 02", role: "snare", note: "D1" },
    { name: "JD Closed Hat Tight", role: "hat", note: "F#1" },
    { name: "JD 808 Glide", role: "808", note: "C2" },
    { name: "JD Rise FX", role: "fx", note: "C5" },
  ],
});

assert.equal(preview.product, "BeatForge");
assert.equal(preview.mode, "deterministic_preview");
assert.equal(preview.beat.bpm, 147);
assert.equal(preview.beat.daw, "fl-studio");
assert.equal(preview.kit.name, "Jordan Drill Kit");
assert.ok(preview.lanes.some((lane) => lane.role === "kick" && lane.kitSound === "JD Hard Kick"));
assert.ok(preview.lanes.some((lane) => lane.role === "808" && lane.kitSound === "JD 808 Glide"));
assert.ok(preview.kit.missingRoles.includes("open_hat"));
assert.ok(preview.arrangement.length >= 5);
assert.ok(preview.dawChecklist.some((item) => item.includes("FL") || item.includes("fl-studio")));
assert.equal(preview.safety.writesFiles, false);
assert.equal(preview.safety.mutatesDaw, false);
assert.equal(preview.safety.uploadsAudio, false);
assert.equal(preview.safety.startsPlugins, false);

const clamped = buildBeatForgePreview({ bpm: 999, daw: "unknown" });
assert.equal(clamped.beat.bpm, 220);
assert.equal(clamped.beat.daw, "generic-midi");

console.log("BeatForge deterministic preview checks passed.");
