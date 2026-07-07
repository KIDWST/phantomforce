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
        note: "Launches the Codex CLI in a shell. Drops to a prompt when Codex exits.",
      },
      {
        id: "claude",
        label: "Claude CLI",
        command: PWSH,
        args: ["-NoLogo", "-NoExit", "-Command", "claude"],
        cwd: HOME,
        note: "Launches the Claude CLI in a shell.",
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

// A minimal environment for spawned terminals — don't inherit Termina's own env
// (which holds the launch token). Keep what a shell needs to work.
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
    return parsed.profiles.map((p, index) => ({
      id: String(p.id ?? `custom-${index}`),
      label: String(p.label ?? p.id ?? `Custom ${index}`),
      command: String(p.command ?? PWSH),
      args: Array.isArray(p.args) ? p.args.map(String) : [],
      cwd: p.cwd ? path.resolve(String(p.cwd).replace(/^~/, HOME)) : HOME,
      note: String(p.note ?? ""),
    }));
  } catch (error) {
    console.warn(`termina.config.json ignored (${error.message}); using built-in profiles.`);
    return BUILT_IN;
  }
}
