import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const localBinary = join(root, ".tools", "trufflehog", isWindows ? "trufflehog.exe" : "trufflehog");
const command = process.env.TRUFFLEHOG_BIN || localBinary;
const outputPath = resolve(root, "run-evidence", `trufflehog-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
const requestedResults = argValue("--results") || process.env.TRUFFLEHOG_RESULTS || "verified";
const scanTarget = argValue("--target") || ".";
const historyScan = process.argv.includes("--history");

function argValue(name) {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function safeJson(value) {
  if (Array.isArray(value)) return value.map(safeJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, raw]) => {
    if (/secret|token|password|credential|private|raw|key|value/i.test(key)) return [key, raw ? "[redacted]" : raw];
    return [key, safeJson(raw)];
  }));
}

function gitHistorySource() {
  const result = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: resolve(root, scanTarget),
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error(`Unable to resolve the repository history store: ${String(result.stderr || "git rev-parse failed").trim()}`);
  }
  const repositoryRoot = dirname(resolve(result.stdout.trim())).replaceAll("\\", "/");
  return `file://${repositoryRoot}`;
}

const sourceArgs = historyScan
  ? ["git", gitHistorySource()]
  : ["filesystem", scanTarget];
const args = [
  ...sourceArgs,
  "--json",
  "--no-update",
  "--fail",
  "--force-skip-binaries",
  "--force-skip-archives",
  "--results",
  requestedResults,
  "--exclude-paths",
  resolve(root, "scripts", "trufflehog-exclude.txt"),
];

mkdirSync(dirname(outputPath), { recursive: true });
const child = spawn(command, args, { cwd: root, shell: false, windowsHide: true });
let buffered = "";
let findings = 0;
let scanErrors = "";
const sanitizedLines = [];

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffered += chunk;
  const lines = buffered.split(/\r?\n/);
  buffered = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      findings += 1;
      sanitizedLines.push(JSON.stringify(safeJson(parsed)));
    } catch {
      sanitizedLines.push(JSON.stringify({ scanner: "trufflehog", unparsable: true, line: "[redacted]" }));
    }
  }
});
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  scanErrors += chunk;
});

child.on("error", (error) => {
  console.error(`TruffleHog is not available at ${command}. Install it there or set TRUFFLEHOG_BIN.`);
  console.error(error.message);
  process.exit(127);
});

child.on("close", (code) => {
  if (buffered.trim()) {
    try {
      findings += 1;
      sanitizedLines.push(JSON.stringify(safeJson(JSON.parse(buffered))));
    } catch {
      sanitizedLines.push(JSON.stringify({ scanner: "trufflehog", unparsable: true, line: "[redacted]" }));
    }
  }
  writeFileSync(outputPath, `${sanitizedLines.join("\n")}${sanitizedLines.length ? "\n" : ""}`, "utf8");
  if (scanErrors.trim()) {
    console.error(scanErrors.replace(/[A-Za-z0-9_./+=:-]{24,}/g, "[redacted]").trim());
  }
  const scannerFailed = /"level":"error"|git clone failed|error running scan/i.test(scanErrors);
  console.log(JSON.stringify({
    ok: findings === 0 && !scannerFailed,
    scanner: "trufflehog",
    source: historyScan ? "git-history" : "filesystem",
    results: requestedResults,
    findings,
    sanitizedReport: outputPath,
  }));
  /* Current Windows TruffleHog builds return 1 for a completed filesystem
     scan with no matching results when --fail is enabled. Findings are still
     authoritative from JSON output; 183 remains the documented finding
     status, while codes above 1 remain scanner failures. */
  process.exit(scannerFailed ? (code && code > 1 ? code : 2) : (findings > 0 ? 183 : (code && code > 1 && code !== 183 ? code : 0)));
});
