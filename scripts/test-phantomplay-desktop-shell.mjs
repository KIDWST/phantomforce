import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = path.join(repoRoot, "packages", "phantomplay-dioxus-shell", "Cargo.toml");
const environment = {
  ...process.env,
  PHANTOMPLAY_LIVE_ROOT: repoRoot,
};

const shellSourceRoot = path.join(repoRoot, "packages", "phantomplay-dioxus-shell", "src");
const shellRoot = path.dirname(manifest);
const mainSource = fs.readFileSync(path.join(shellSourceRoot, "main.rs"), "utf8");
const studioSource = fs.readFileSync(path.join(shellSourceRoot, "studio.rs"), "utf8");
const historySource = fs.readFileSync(path.join(shellSourceRoot, "project_history.rs"), "utf8");
const buildSource = fs.readFileSync(path.join(shellRoot, "build.rs"), "utf8");
const bundleConfig = fs.readFileSync(path.join(shellRoot, "Dioxus.toml"), "utf8");
const windowsInstaller = fs.readFileSync(
  path.join(shellRoot, "installer", "PhantomPlay.nsi"),
  "utf8",
);
const aiEditSource = fs.readFileSync(path.join(repoRoot, "server", "src", "phantomplay-ai-edit.ts"), "utf8");
const serverIndexSource = fs.readFileSync(path.join(repoRoot, "server", "src", "index.ts"), "utf8");

for (const [label, source, contract] of [
  ["history module", mainSource, "mod project_history;"],
  ["recoverable save", studioSource, "project_history::write_file("],
  ["recoverable undo", studioSource, "project_history::undo("],
  ["recoverable redo", studioSource, "project_history::redo("],
  ["safe ZIP traversal rejection", historySource, "ZIP contains an unsafe path"],
  ["import size ceiling", historySource, "MAX_IMPORT_BYTES"],
  ["external edit recovery", historySource, "recovered_conflicts"],
  ["Codex edit route", aiEditSource, "callCodexCliChat"],
  ["Claude edit route", aiEditSource, 'provider === "claude"'],
  ["OpenRouter edit route", aiEditSource, "callOpenRouterGlm52"],
  ["local Ollama edit route", aiEditSource, "callLocalOllamaChat"],
  ["desktop model selector", studioSource, 'option { value: "local", "Local Ollama" }'],
  ["app-wide control center", studioSource, "PHANTOMPLAY CONTROL CENTER"],
  ["connection diagnostics", studioSource, "Test all connections"],
  ["explicit Apply readiness", studioSource, "API offline — click Apply to open connection repair."],
  ["secure password field", studioSource, 'r#type: "password"'],
  ["encrypted desktop provider vault route", serverIndexSource, '/api/phantomplay/connections/openrouter'],
  ["encrypted provider vault persistence", serverIndexSource, "saveAiProviderCredential({"],
  ["fallback routing preference", aiEditSource, "fallbackProvider?: PhantomPlayAiProvider"],
  ["Windows executable icon", buildSource, 'resource.set_icon("assets/phantomplay.ico")'],
  ["Windows taskbar icon", mainSource, "window.with_taskbar_icon(icon.clone())"],
  ["Windows NSIS bundle config", bundleConfig, "[bundle.windows.nsis]"],
  ["Windows installer icon", windowsInstaller, "!define MUI_ICON"],
  ["Windows uninstall icon", windowsInstaller, "!define MUI_UNICON"],
  ["Windows Apps display icon", windowsInstaller, '"DisplayIcon" "$INSTDIR\\{{main_binary_name}},0"'],
  ["Windows shortcut icon", windowsInstaller, '"" "$INSTDIR\\{{main_binary_name}}" 0'],
]) {
  if (!source.includes(contract)) {
    throw new Error(`PhantomPlay desktop shell is missing ${label}: ${contract}`);
  }
}

if (studioSource.includes("disabled: playing_entry().is_none()")) {
  throw new Error("PhantomPlay must not disable Play, Split, or reload merely because a native project has no embedded web entry.");
}

if (!studioSource.includes('disabled: ai_busy(),')) {
  throw new Error("PhantomPlay Apply must remain clickable when configuration is missing so it can explain the exact blocker.");
}

for (const argumentsList of [
  ["fmt", "--manifest-path", manifest, "--", "--check"],
  ["test", "--manifest-path", manifest],
  ["clippy", "--manifest-path", manifest, "--all-targets", "--", "-D", "warnings"],
]) {
  const result = spawnSync("cargo", argumentsList, {
    cwd: repoRoot,
    env: environment,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
