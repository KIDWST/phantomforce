import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/* Local background removal — a real Python (rembg) bridge, not a fake
   integration. The frontend can never see or run Python itself, so this is
   the one place that actually shells out to it: detect a working `python`
   command that can `import rembg`, then run scripts/remove_background.py
   through that exact interpreter. If rembg genuinely isn't importable on
   this machine, every caller gets an honest, specific error — never a
   silent failure and never a fake "available: true". */

const moduleDir = dirname(fileURLToPath(import.meta.url));
// server/src/phantom-ai/ -> repo root is three levels up.
const REPO_ROOT = resolve(moduleDir, "..", "..", "..");
export const REMOVE_BACKGROUND_SCRIPT = resolve(REPO_ROOT, "scripts", "remove_background.py");

export type RembgStatus = {
  available: boolean;
  pythonCommand: string | null;
  version: string | null;
  error: string | null;
  checkedAt: string;
};

/* Order matters: python3 is the unambiguous name on macOS/Linux; python is
   common on Windows and some Linux setups; py is the Windows launcher,
   which resolves to whichever interpreter has rembg regardless of which
   python.exe is "first" on PATH. */
const CANDIDATE_COMMANDS =
  process.platform === "win32" ? ["py", "python", "python3"] : ["python3", "python", "py"];

function spawnCapture(command: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string; spawnError: string | null }> {
  return new Promise((resolvePromise) => {
    let proc;
    try {
      proc = spawn(command, args, { windowsHide: true });
    } catch (error) {
      resolvePromise({ code: null, stdout: "", stderr: "", spawnError: error instanceof Error ? error.message : String(error) });
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: { code: number | null; stdout: string; stderr: string; spawnError: string | null }) => {
      if (settled) return;
      settled = true;
      resolvePromise(result);
    };
    proc.stdout?.on("data", (chunk) => { stdout += chunk; });
    proc.stderr?.on("data", (chunk) => { stderr += chunk; });
    proc.on("error", (error) => finish({ code: null, stdout, stderr, spawnError: error.message }));
    const killTimer = setTimeout(() => {
      try { proc.kill(); } catch { /* already gone */ }
      finish({ code: null, stdout, stderr, spawnError: `timed out after ${timeoutMs}ms` });
    }, timeoutMs);
    proc.on("exit", (code) => {
      clearTimeout(killTimer);
      finish({ code, stdout, stderr, spawnError: null });
    });
  });
}

let cache: RembgStatus | null = null;
let cacheAt = 0;
const CACHE_MS = 30_000;

async function probeOneCommand(command: string): Promise<RembgStatus | null> {
  const result = await spawnCapture(
    command,
    ["-c", "import rembg, sys; sys.stdout.write(getattr(rembg, '__version__', 'ok'))"],
    6000,
  );
  if (result.spawnError) return null; // this command doesn't exist on PATH at all
  if (result.code !== 0) {
    // command exists but `import rembg` failed — real, useful error, not a guess
    const detail = (result.stderr || result.stdout || `exited with code ${result.code}`).trim().split("\n").pop() ?? "import failed";
    return {
      available: false,
      pythonCommand: command,
      version: null,
      error: `${command} found, but "import rembg" failed: ${detail.slice(0, 240)}`,
      checkedAt: new Date().toISOString(),
    };
  }
  return {
    available: true,
    pythonCommand: command,
    version: result.stdout.trim().slice(0, 40) || "ok",
    error: null,
    checkedAt: new Date().toISOString(),
  };
}

export async function detectRembg(force = false): Promise<RembgStatus> {
  const now = Date.now();
  if (!force && cache && now - cacheAt < CACHE_MS) return cache;

  const attempts: RembgStatus[] = [];
  for (const command of CANDIDATE_COMMANDS) {
    const result = await probeOneCommand(command);
    if (!result) continue; // command not found on PATH — try the next one
    attempts.push(result);
    if (result.available) {
      cache = result;
      cacheAt = now;
      return result;
    }
  }

  const status: RembgStatus = attempts.length
    ? attempts[0] // real "found python, but rembg import failed" beats a generic not-found
    : {
        available: false,
        pythonCommand: null,
        version: null,
        error: `No Python interpreter found on PATH (tried: ${CANDIDATE_COMMANDS.join(", ")}). Install Python and rembg (pip install rembg), then re-check.`,
        checkedAt: new Date().toISOString(),
      };
  cache = status;
  cacheAt = now;
  return status;
}

export type RembgRunResult = { ok: true } | { ok: false; error: string };

export async function runRembgRemoveBackground(pythonCommand: string, inputPath: string, outputPath: string): Promise<RembgRunResult> {
  const result = await spawnCapture(pythonCommand, [REMOVE_BACKGROUND_SCRIPT, inputPath, outputPath], 45_000);
  if (result.spawnError) return { ok: false, error: `Could not run ${pythonCommand}: ${result.spawnError}` };
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout || `exited with code ${result.code}`).trim().slice(-400);
    return { ok: false, error: detail || "rembg failed with no error output." };
  }
  return { ok: true };
}
