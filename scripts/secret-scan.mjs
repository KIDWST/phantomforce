import { spawn } from "node:child_process";
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

const args = [
  "filesystem",
  scanTarget,
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
  console.log(JSON.stringify({
    ok: findings === 0,
    scanner: "trufflehog",
    results: requestedResults,
    findings,
    sanitizedReport: outputPath,
  }));
  process.exit(findings > 0 ? 183 : (code && code !== 183 ? code : 0));
});
