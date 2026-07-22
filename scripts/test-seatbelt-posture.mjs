import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const adapter = read("server/src/phantom-ai/seatbelt-posture.ts");
const server = read("server/src/index.ts");

assert.match(adapter, /PHANTOMFORCE_SEATBELT_POSTURE_ENABLED/u, "Seatbelt posture must be an explicit server-side opt-in.");
assert.match(adapter, /PHANTOMFORCE_SEATBELT_SHA256/u, "Seatbelt posture must require a SHA-256 pin.");
assert.match(adapter, /SEATBELT_DEFENSIVE_COMMANDS/u, "Seatbelt posture must use a fixed allowlist.");
assert.match(adapter, /shell: false/u, "The host tool must not run through a shell.");
assert.match(adapter, /remote_enumeration: false/u, "Remote enumeration must be forbidden.");
assert.match(adapter, /raw_output_returned: false/u, "Raw host survey output must never be returned.");
assert.match(adapter, /raw_output_persisted: false/u, "Raw host survey output must never be persisted.");
assert.doesNotMatch(adapter, /CloudCredentials|CredEnum|PowerShellHistory|ChromiumHistory|WindowsVault|computername|outputfile|group=all/u,
  "Credential, browser, user-history, remote, and bulk-enumeration paths must not enter the defensive adapter.");

assert.match(server, /"\/phantom-ai\/security\/host-posture\/seatbelt\/status"/u, "An operator status endpoint must exist.");
assert.match(server, /"\/phantom-ai\/security\/host-posture\/seatbelt\/run"/u, "An operator run endpoint must exist.");
assert.match(server, /confirmation: "RUN_LOCAL_SEATBELT_POSTURE"/u, "Host posture runs must require an explicit confirmation phrase.");
assert.match(server, /requireAdminAccessSession\(request, reply\)/u, "Host posture routes must be administrator-gated.");

console.log("Seatbelt defensive posture source checks passed.");
