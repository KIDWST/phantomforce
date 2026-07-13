// The four tools available to the OpenRouter agent. plan/approval/auto
// gating for write_file/run_command happens here for "plan" (outright
// blocked); the "approval" y/n gate itself lives in agent.mjs (needs
// access to the raw-mode stdin loop, which these pure functions
// deliberately don't touch, so they stay unit-testable without faking
// terminal input).
import { execFile } from "node:child_process";
import { readdir, readFile as fsReadFile, writeFile as fsWriteFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const MAX_READ_BYTES = 100 * 1024;
const MAX_COMMAND_BUFFER = 4 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 60000;

function resolveWithin(cwd, relPath) {
  return path.resolve(cwd, relPath);
}

export async function readFile({ path: relPath }, { cwd }) {
  try {
    const full = resolveWithin(cwd, relPath);
    const content = await fsReadFile(full, "utf8");
    return { content: content.length > MAX_READ_BYTES ? content.slice(0, MAX_READ_BYTES) + "\n...(truncated)" : content };
  } catch (error) {
    return { error: error.message };
  }
}

export async function writeFile({ path: relPath, content }, { cwd, mode }) {
  if (mode === "plan") return { error: "blocked: plan mode is read-only" };
  try {
    const full = resolveWithin(cwd, relPath);
    await fsWriteFile(full, content, "utf8");
    return { ok: true };
  } catch (error) {
    return { error: error.message };
  }
}

export async function listDirectory({ path: relPath }, { cwd }) {
  try {
    const full = resolveWithin(cwd, relPath ?? ".");
    const entries = await readdir(full);
    return { entries };
  } catch (error) {
    return { error: error.message };
  }
}

export async function runCommand({ command }, { cwd, mode }) {
  if (mode === "plan") return { error: "blocked: plan mode is read-only" };
  try {
    const { stdout, stderr } = await run("pwsh.exe", ["-NoLogo", "-NoProfile", "-Command", command], {
      cwd,
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_COMMAND_BUFFER,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    return { stdout: error.stdout ?? "", stderr: error.stderr ?? "", exitCode: typeof error.code === "number" ? error.code : 1 };
  }
}
