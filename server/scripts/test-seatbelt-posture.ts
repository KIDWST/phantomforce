import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const ENV_KEYS = [
  "PHANTOMFORCE_SEATBELT_POSTURE_ENABLED",
  "PHANTOMFORCE_SEATBELT_PATH",
  "PHANTOMFORCE_SEATBELT_SHA256",
  "PHANTOMFORCE_SEATBELT_TIMEOUT_MS",
] as const;
const original = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
for (const key of ENV_KEYS) delete process.env[key];

try {
  const posture = await import("../src/phantom-ai/seatbelt-posture.js");
  const disabled = posture.getSeatbeltDefensivePostureStatus();
  assert.equal(disabled.state, "disabled", "Seatbelt posture must default to disabled");
  assert.equal(disabled.safety.remote_enumeration, false, "Remote enumeration must be unavailable");
  assert.equal(disabled.safety.credential_collection, false, "Credential collection must be unavailable");
  assert.equal(disabled.safety.raw_output_returned, false, "Raw host output must never be returned");
  assert.equal(disabled.safety.command_allowlist.includes("SecureBoot"), true, "Safe posture commands must be declared");
  assert.equal(disabled.safety.command_allowlist.includes("CloudCredentials" as never), false, "Credential-oriented commands must never be allowed");

  const temp = await mkdtemp(path.join(tmpdir(), "pf-seatbelt-posture-"));
  try {
    const fakeBinary = path.join(temp, "Seatbelt.exe");
    const fakeBytes = Buffer.from("not-a-seatbelt-binary", "utf8");
    await writeFile(fakeBinary, fakeBytes);
    process.env.PHANTOMFORCE_SEATBELT_POSTURE_ENABLED = "true";
    process.env.PHANTOMFORCE_SEATBELT_PATH = fakeBinary;
    process.env.PHANTOMFORCE_SEATBELT_SHA256 = createHash("sha256").update(fakeBytes).digest("hex");
    const configured = posture.getSeatbeltDefensivePostureStatus();
    assert.equal(configured.state, "ready", "An explicit absolute binary path and hash are required before a run can be considered ready");
    assert.equal(configured.binary_path_exposed, false, "Status must not disclose the host binary path");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }

  const summarized = posture.summarizeSeatbeltDefensiveOutput([
    "AntivirusEnabled : True",
    "SecureBoot : True",
    "EnableLUA : 1",
    "Credential Guard : False",
    "EnableFirewall : 0",
    "do-not-return=secret-token-value",
  ].join("\n"));
  const serialized = JSON.stringify(summarized);
  assert.equal(summarized.find((item) => item.id === "antivirus_realtime")?.outcome, "pass", "Defensive antivirus state should normalize to a pass");
  assert.equal(summarized.find((item) => item.id === "credential_guard")?.outcome, "review", "Disabled Credential Guard should normalize to review");
  assert.equal(summarized.find((item) => item.id === "firewall")?.outcome, "review", "Disabled firewall should normalize to review");
  assert.equal(serialized.includes("secret-token-value"), false, "Raw Seatbelt output must not leak through normalized signals");

  console.log("Seatbelt defensive posture checks passed.");
} finally {
  for (const key of ENV_KEYS) {
    const value = original.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
