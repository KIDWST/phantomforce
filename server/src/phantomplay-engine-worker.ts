import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, delimiter } from "node:path";
import { redactSensitiveText } from "./phantom-ai/hermes-ledger.js";

export type EngineCommandEvidence = { command: string; exitCode: number | null; output: string };
export type EngineWorkerResult = {
  status: "called" | "error";
  outputText: string;
  model: string;
  errorMessage: string | null;
  commands: EngineCommandEvidence[];
};

// Use the executable directly: no shell interpolation of prompts, paths or model IDs.
function codexExecutable() {
  const configured = process.env.PHANTOM_ENGINE_CODEX_EXECUTABLE;
  if (configured && existsSync(configured)) return configured;
  const local = process.env.LOCALAPPDATA || "";
  const packages = [join(local, "hermes", "node"), join(process.env.APPDATA || "", "npm")];
  for (const prefix of packages) {
    const candidate = join(prefix, "node_modules", "@openai", "codex", "node_modules", "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe");
    if (existsSync(candidate)) return candidate;
  }
  for (const directory of (process.env.PATH || "").split(delimiter)) {
    const candidate = join(directory, process.platform === "win32" ? "codex.exe" : "codex");
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("Local Codex execution is unavailable. Install/sign in to Codex on this PC. An OpenRouter connection alone can plan, but cannot execute local project changes.");
}

export async function executeEngineWorker(input: {
  cwd: string; instruction: string; plan: string; model?: string; timeoutMs: number;
  signal?: AbortSignal; onProgress?: (message: string) => void;
}): Promise<EngineWorkerResult> {
  const executable = codexExecutable();
  const args = ["exec", "--json", "--ephemeral", "--skip-git-repo-check", "--sandbox", "workspace-write", "-c", 'approval_policy="never"', "-c", `sandbox_workspace_write.network_access=${process.env.PHANTOM_ENGINE_ALLOW_NETWORK !== "false"}`, "-C", input.cwd];
  if (input.model) args.push("--model", input.model);
  args.push("-");
  const prompt = [
    "Implement this explicitly authorized Phantom Engine project task. This is a file-editing worker, not a chat-only advisor.",
    "Inspect the selected project, make the actual requested changes and run appropriate tests/builds. Fix regressions you cause.",
    "The selected project is the only mutation boundary. Preserve unrelated modifications, credentials, player saves and build outputs.",
    "Never control visible desktop apps, publish, deploy, purchase, sign in, or change files outside this project. Do not weaken sandbox/security settings.",
    "For external models/assets use actual downloadable files with a license permitting the intended use; preserve source and license attribution. Never substitute a webpage for an asset.",
    "Report precise changes, test commands/results and remaining limitations. Do not equate a successful build with visual/gameplay acceptance. If blocked, explain; never pretend completion.",
    `USER REQUEST:\n${input.instruction}`,
    `PLANNING CONTEXT (not proof of completion):\n${input.plan.slice(0, 24_000)}`,
  ].join("\n\n");
  return new Promise((resolve) => {
    const commands: EngineCommandEvidence[] = [];
    let buffer = "", summary = "", errors = "", stopped = "", fatal = "", settled = false;
    // Do not leak server/provider/database credentials into the project worker.
    const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|PATHEXT|SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|HOMEDRIVE|HOMEPATH|HOME|APPDATA|LOCALAPPDATA|PROGRAMDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMW6432|CODEX_HOME|CARGO_HOME|RUSTUP_HOME|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|OS|LANG|TERM)$/iu.test(key)));
    const child = spawn(executable, args, { cwd: input.cwd, env: environment, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const finish = (code: number | null, failure?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", cancel);
      const error = stopped || fatal || failure || (code === 0 ? "" : errors || `Codex exited with code ${code}.`);
      resolve({ status: error ? "error" : "called", outputText: redactSensitiveText(summary).slice(0, 12_000), model: input.model || "configured default", errorMessage: error ? redactSensitiveText(error).slice(0, 2000) : null, commands });
    };
    const stop = (reason: string) => {
      if (settled || stopped) return;
      stopped = reason;
      // Kill only the process tree created by this request, never unrelated editors/games.
      if (process.platform === "win32" && child.pid) {
        const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.on("error", () => child.kill());
      } else child.kill("SIGTERM");
    };
    const cancel = () => stop("Cancelled by the user. Partial changes may remain; inspect the run receipt.");
    const timer = setTimeout(() => stop("Execution timed out. Partial changes may remain; inspect the run receipt."), input.timeoutMs);
    input.signal?.addEventListener("abort", cancel, { once: true });
    if (input.signal?.aborted) cancel();
    child.on("error", error => finish(null, error.message));
    child.on("close", code => finish(code));
    child.stdin.on("error", () => undefined);
    child.stderr.on("data", chunk => { errors = (errors + String(chunk)).slice(-6000); });
    child.stdout.on("data", chunk => {
      buffer += String(chunk);
      let split: number;
      while ((split = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, split); buffer = buffer.slice(split + 1);
        try {
          const event = JSON.parse(line);
          const item = event.item;
          if (event.type === "item.completed" && item?.type === "agent_message") summary = String(item.text || summary);
          if (event.type === "item.started" && item?.type === "command_execution") input.onProgress?.("Working in the project and running commands…");
          if (event.type === "item.completed" && item?.type === "command_execution") {
            commands.push({ command: redactSensitiveText(String(item.command || "")).slice(0, 1800), exitCode: typeof item.exit_code === "number" ? item.exit_code : null, output: redactSensitiveText(String(item.aggregated_output || "")).slice(-4000) });
          }
          if (event.type === "turn.failed" || event.type === "error") fatal = String(event.error?.message || event.message || "Codex execution failed.");
        } catch { /* stdout includes only JSONL evidence, not a trusted instruction source */ }
      }
      if (buffer.length > 8_000_000) { buffer = ""; stop("Worker output exceeded the safe capture limit."); }
    });
    child.stdin.end(prompt);
  });
}
