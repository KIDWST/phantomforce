// Termina terminal templates.
//
// Each template is a kind of terminal you can drop onto a wall tile. Every tile
// gets its OWN independent session, so you can run several Codex CLIs and shells
// at the same time. Commands are predefined here and run on this machine as you.
//
// Override or extend with a termina.config.json next to server.js (see below).

import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getApiKeyEnv } from "./connections.js";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const HOME = os.homedir();
const isWin = process.platform === "win32";

// Prefer PowerShell 7 (pwsh) if present, else Windows PowerShell.
const PWSH = "pwsh.exe";

/** @type {Array<{id:string,label:string,command:string,args:string[],cwd:string,note:string}>} */
const BUILT_IN = isWin
  ? [
      {
        id: "pwsh",
        label: "PowerShell",
        command: PWSH,
        args: ["-NoLogo"],
        cwd: HOME,
        note: "A PowerShell shell.",
      },
      {
        id: "codex",
        label: "Codex CLI",
        command: PWSH,
        args: ["-NoLogo", "-NoExit", "-Command", "codex"],
        cwd: HOME,
        detector: "codex",
        note: "Launches the Codex CLI in a shell. Drops to a prompt when Codex exits.",
      },
      {
        id: "claude",
        label: "Claude CLI",
        command: PWSH,
        args: ["-NoLogo", "-NoExit", "-Command", "claude"],
        cwd: HOME,
        detector: "claude",
        note: "Launches the Claude CLI in a shell.",
      },
      {
        id: "openrouter",
        label: "OpenRouter CLI",
        command: PWSH,
        args: ["-NoLogo", "-NoExit", "-Command", `node ${JSON.stringify(path.join(appDir, "openrouter-agent", "agent.mjs"))} --mode approval`],
        cwd: HOME,
        detector: "openrouter",
        note: "Launches the OpenRouter agent (model configured via Connections) in a shell.",
      },
      {
        id: "cmd",
        label: "Command Prompt",
        command: "cmd.exe",
        args: [],
        cwd: HOME,
        note: "A classic cmd.exe shell.",
      },
      {
        id: "wsl",
        label: "WSL / bash",
        command: "wsl.exe",
        args: [],
        cwd: HOME,
        note: "A Linux shell via WSL.",
      },
      {
        id: "python",
        label: "Python",
        command: "python.exe",
        args: ["-i"],
        cwd: HOME,
        note: "A Python REPL.",
      },
      {
        id: "node",
        label: "Node",
        command: "node.exe",
        args: [],
        cwd: HOME,
        note: "A Node.js REPL.",
      },
    ]
  : [
      {
        id: "shell",
        label: "Shell",
        command: process.env.SHELL || "/bin/bash",
        args: ["-i"],
        cwd: HOME,
        note: "An interactive shell.",
      },
    ];

// Single-quote escaping for a pwsh -Command string — same shape as
// mission/claude-print.js / mission/adapters.js.
function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

// Which model flag/env a profile understands, keyed by its provider identity
// (detector when set, else the profile id). Plain shells have no model
// concept and ignore the request entirely.
const MODEL_CAPABLE = new Set(["claude", "codex", "openrouter"]);

export function profileSupportsModel(profile) {
  return MODEL_CAPABLE.has(profile?.detector ?? profile?.id);
}

// Launch-time model injection. Returns { args, env }:
// - claude/codex profiles: appends `--model '<id>'` inside the existing
//   pwsh -Command string (the CLI invocation itself), psQuoted so arbitrary
//   ids can never break out of the command;
// - openrouter: the agent reads OPENROUTER_MODEL from its environment
//   (openrouter-agent/agent.mjs), so the model becomes a spawn-env override
//   (applied after terminalEnv so it wins over the Connections default);
// - everything else, or no model requested: args unchanged, env empty.
// Never mutates the profile.
export function buildProfileArgs(profile, { model } = {}) {
  const args = [...(profile.args ?? [])];
  const env = {};
  if (!model || !profileSupportsModel(profile)) return { args, env };
  const kind = profile.detector ?? profile.id;
  if (kind === "openrouter") {
    env.OPENROUTER_MODEL = String(model);
    return { args, env };
  }
  // claude/codex run as `pwsh -Command "<cli> ..."` — append to that string.
  const commandIdx = args.indexOf("-Command");
  if (commandIdx !== -1 && commandIdx + 1 < args.length) {
    args[commandIdx + 1] = `${args[commandIdx + 1]} --model ${psQuote(model)}`;
  } else {
    // Direct-exe custom profile: pass the flag as real argv.
    args.push("--model", String(model));
  }
  return { args, env };
}

// A minimal environment for spawned terminals — don't inherit Termina's own env
// (which holds the launch token). Keep what a shell needs to work.
export function terminalEnv(providerId) {
  const keep = [
    "PATH",
    "PATHEXT",
    "SYSTEMROOT",
    "SYSTEMDRIVE",
    "WINDIR",
    "COMSPEC",
    "TEMP",
    "TMP",
    "HOME",
    "HOMEDRIVE",
    "HOMEPATH",
    "USERPROFILE",
    "USERNAME",
    "APPDATA",
    "LOCALAPPDATA",
    "PROGRAMDATA",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "OS",
    "NUMBER_OF_PROCESSORS",
    "LANG",
    "SHELL",
  ];
  const env = { TERM: "xterm-256color" };
  for (const key of keep) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }
  if (providerId) Object.assign(env, getApiKeyEnv(appDir, providerId));
  return env;
}

// Auto-trust defaults to ON for every terminal type: whatever CLI a tile runs,
// if it shows a "do you trust this folder?" prompt, Termina answers it. Set
// "autoTrust": false on a profile to opt a specific one out.
function withAutoTrustDefault(profile) {
  return { ...profile, autoTrust: profile.autoTrust !== false };
}

export function loadProfiles() {
  const configPath = path.join(appDir, "termina.config.json");
  if (!existsSync(configPath)) {
    return BUILT_IN.map(withAutoTrustDefault);
  }
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    if (!Array.isArray(parsed.profiles)) {
      return BUILT_IN.map(withAutoTrustDefault);
    }
    return parsed.profiles.map((p, index) =>
      withAutoTrustDefault({
        id: String(p.id ?? `custom-${index}`),
        label: String(p.label ?? p.id ?? `Custom ${index}`),
        command: String(p.command ?? PWSH),
        args: Array.isArray(p.args) ? p.args.map(String) : [],
        cwd: p.cwd ? path.resolve(String(p.cwd).replace(/^~/, HOME)) : HOME,
        autoTrust: p.autoTrust,
        detector: p.detector ? String(p.detector) : undefined,
        note: String(p.note ?? ""),
      }),
    );
  } catch (error) {
    console.warn(`termina.config.json ignored (${error.message}); using built-in profiles.`);
    return BUILT_IN.map(withAutoTrustDefault);
  }
}
