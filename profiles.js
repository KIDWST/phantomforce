// Termina terminal profile registry.
//
// Each profile is a predefined local terminal you can put on a wall tile. Every
// command is a fixed argv defined here (never assembled from client input), and
// everything runs on this one machine as the user who launched Termina.
//
// You can override or extend this list with a termina.config.json file next to
// server.js (see loadProfiles below). Keep it to shells and tools you own.

import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const HOME = os.homedir();

// Resolve a usable interactive shell for this OS.
function defaultShell() {
  if (process.platform === "win32") {
    return { command: "powershell.exe", args: ["-NoLogo"] };
  }
  return { command: process.env.SHELL || "/bin/bash", args: ["-i"] };
}

const shell = defaultShell();

/**
 * @typedef {Object} Profile
 * @property {string} id
 * @property {string} label
 * @property {string} type      control|shell|service|ops|ai|lab|logs|custom
 * @property {string} description
 * @property {string} cwd       absolute working directory
 * @property {string} command   executable (predefined)
 * @property {string[]} args     predefined argv
 * @property {boolean} interactive  accepts keystrokes
 * @property {string} note      honest status/placeholder text
 * @property {boolean} [blocked]    true = never launches until you configure it
 */

/** @type {Profile[]} */
const BUILT_IN = [
  {
    id: "programs",
    label: "PROGRAMS",
    type: "monitor",
    description: "Live list of the open programs / windows on this PC.",
    cwd: HOME,
    command: "",
    args: [],
    interactive: false,
    monitor: true,
    note: "Your open windows. Focus, minimize, restore, maximize, or close them from here.",
  },
  {
    id: "control",
    label: "CONTROL",
    type: "control",
    description: "Primary shell in your home directory.",
    cwd: HOME,
    command: shell.command,
    args: shell.args,
    interactive: true,
    note: "Your main interactive shell.",
  },
  {
    id: "shell-a",
    label: "SHELL A",
    type: "shell",
    description: "A second working shell.",
    cwd: HOME,
    command: shell.command,
    args: shell.args,
    interactive: true,
    note: "A spare interactive shell.",
  },
  {
    id: "shell-b",
    label: "SHELL B",
    type: "shell",
    description: "A third working shell.",
    cwd: HOME,
    command: shell.command,
    args: shell.args,
    interactive: true,
    note: "A spare interactive shell.",
  },
  {
    id: "git",
    label: "GIT",
    type: "shell",
    description: "Shell for git work.",
    cwd: HOME,
    command: shell.command,
    args: shell.args,
    interactive: true,
    note: "Interactive shell — run git commands here.",
  },
  {
    id: "node",
    label: "NODE",
    type: "shell",
    description: "Node.js REPL.",
    cwd: HOME,
    command: process.platform === "win32" ? "node.exe" : "node",
    args: [],
    interactive: true,
    note: "Live Node REPL.",
  },
  {
    id: "python",
    label: "PYTHON",
    type: "shell",
    description: "Python REPL.",
    cwd: HOME,
    command: process.platform === "win32" ? "python.exe" : "python3",
    args: ["-i"],
    interactive: true,
    note: "Live Python REPL (needs Python on PATH).",
  },
  {
    id: "ops-docker",
    label: "OPS / DOCKER",
    type: "ops",
    description: "Shell for docker / ops commands.",
    cwd: HOME,
    command: shell.command,
    args: shell.args,
    interactive: true,
    note: "Interactive ops shell. Try: docker ps",
  },
  {
    id: "codex",
    label: "CODEX",
    type: "ai",
    description: "Shell for the Codex CLI.",
    cwd: HOME,
    command: shell.command,
    args: shell.args,
    interactive: true,
    note: "Opens a shell. Nothing auto-runs — start your agent when you want.",
  },
  {
    id: "claude",
    label: "CLAUDE / FABLE",
    type: "ai",
    description: "Shell for the Claude / Fable CLI.",
    cwd: HOME,
    command: shell.command,
    args: shell.args,
    interactive: true,
    note: "Opens a shell. Nothing auto-runs — start your agent when you want.",
  },
  {
    id: "kali-lab",
    label: "KALI LAB",
    type: "lab",
    description: "Authorized lab profile — owned machines only.",
    cwd: HOME,
    command: shell.command,
    args: shell.args,
    interactive: true,
    blocked: true,
    note: "Blocked until you configure an authorized lab profile in termina.config.json. Nothing offensive auto-runs.",
  },
];

// A minimal environment for spawned terminals — do not inherit the parent's full
// env (which may hold Termina's own token). Keep what a shell needs to work.
export function terminalEnv() {
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
  return env;
}

export function loadProfiles() {
  const configPath = path.join(appDir, "termina.config.json");
  if (!existsSync(configPath)) {
    return BUILT_IN;
  }
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    if (!Array.isArray(parsed.profiles)) {
      return BUILT_IN;
    }
    // Config profiles replace built-ins entirely so you have full control.
    return parsed.profiles.map((p, index) => ({
      id: String(p.id ?? `custom-${index}`),
      label: String(p.label ?? p.id ?? `CUSTOM ${index}`),
      type: String(p.type ?? "custom"),
      description: String(p.description ?? ""),
      cwd: p.cwd ? path.resolve(p.cwd.replace(/^~/, HOME)) : HOME,
      command: String(p.command ?? shell.command),
      args: Array.isArray(p.args) ? p.args.map(String) : shell.args,
      interactive: p.interactive !== false,
      blocked: Boolean(p.blocked),
      monitor: Boolean(p.monitor),
      note: String(p.note ?? ""),
    }));
  } catch (error) {
    console.warn(`termina.config.json ignored (${error.message}); using built-in profiles.`);
    return BUILT_IN;
  }
}
