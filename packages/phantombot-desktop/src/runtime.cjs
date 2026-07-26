"use strict";

const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 2500;
const DEFAULT_STARTUP_TIMEOUT_MS = 30000;

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function probeUrl(value, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    if (!isHttpUrl(value)) {
      resolve(false);
      return;
    }

    let settled = false;
    let request = null;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      request?.destroy();
      resolve(Boolean(result));
    };

    try {
      const parsed = new URL(value);
      const transport = parsed.protocol === "https:" ? https : http;
      request = transport.request(
        parsed,
        {
          method: "GET",
          timeout: timeoutMs,
          headers: {
            "Cache-Control": "no-cache",
            "User-Agent": "PhantomBotDesktopRuntime"
          }
        },
        (response) => {
          response.resume();
          const status = Number(response.statusCode || 0);
          finish(status >= 200 && status < 500);
        }
      );
      request.on("timeout", () => finish(false));
      request.on("error", () => finish(false));
      request.end();
    } catch {
      finish(false);
    }
  });
}

async function waitForUrl(
  value,
  {
    timeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
    intervalMs = 350
  } = {}
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeUrl(value)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

function uniqueExistingFiles(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (!candidate) {
      return false;
    }
    const resolved = path.resolve(candidate);
    const key = process.platform === "win32"
      ? resolved.toLowerCase()
      : resolved;
    if (seen.has(key) || !fs.existsSync(resolved)) {
      return false;
    }
    seen.add(key);
    try {
      return fs.statSync(resolved).isFile();
    } catch {
      return false;
    }
  }).map((candidate) => path.resolve(candidate));
}

function pathExecutables(executableName, env = process.env) {
  const pathValue = String(env.PATH || env.Path || "");
  const extensions = process.platform === "win32"
    ? ["", ".exe", ".cmd", ".bat"]
    : [""];
  const candidates = [];
  for (const directory of pathValue.split(path.delimiter)) {
    const cleanDirectory = directory.trim().replace(/^"|"$/g, "");
    if (!cleanDirectory) {
      continue;
    }
    for (const extension of extensions) {
      candidates.push(path.join(cleanDirectory, `${executableName}${extension}`));
    }
  }
  return candidates;
}

function findHermesExecutable(env = process.env) {
  const localAppData = env.LOCALAPPDATA || "";
  const userProfile = env.USERPROFILE || "";
  const explicit = String(env.PHANTOMBOT_HERMES_EXECUTABLE || "").trim();
  const candidates = [
    explicit,
    ...pathExecutables("hermes", env),
    localAppData && path.join(
      localAppData,
      "Hermes",
      "hermes-agent",
      "venv",
      "Scripts",
      "hermes.exe"
    ),
    userProfile && path.join(
      userProfile,
      ".hermes",
      "hermes-agent",
      "venv",
      "Scripts",
      "hermes.exe"
    )
  ];
  return uniqueExistingFiles(candidates)[0] || null;
}

function compactVersion(stdout) {
  const firstLine = String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine ? firstLine.slice(0, 120) : null;
}

async function inspectHermes(env = process.env) {
  const executable = findHermesExecutable(env);
  if (!executable) {
    return {
      installed: false,
      healthy: false,
      acpReady: false,
      executable: null,
      version: null,
      errorCode: "hermes_not_found"
    };
  }

  try {
    const versionResult = await execFileAsync(
      executable,
      ["--version"],
      {
        windowsHide: true,
        timeout: 8000,
        maxBuffer: 128 * 1024,
        env
      }
    );
    const acpResult = await execFileAsync(
      executable,
      ["acp", "--check"],
      {
        windowsHide: true,
        timeout: 15000,
        maxBuffer: 256 * 1024,
        env
      }
    );
    return {
      installed: true,
      healthy: true,
      acpReady: /ACP check OK/i.test(
        `${acpResult.stdout || ""}\n${acpResult.stderr || ""}`
      ),
      executable,
      version: compactVersion(versionResult.stdout || versionResult.stderr),
      errorCode: null
    };
  } catch (error) {
    return {
      installed: true,
      healthy: false,
      acpReady: false,
      executable,
      version: null,
      errorCode:
        error?.code === "ETIMEDOUT"
          ? "hermes_check_timed_out"
          : "hermes_check_failed"
    };
  }
}

function findRepoRoot(startDirectory) {
  let current = path.resolve(startDirectory);
  for (let depth = 0; depth < 8; depth += 1) {
    const packageJson = path.join(current, "package.json");
    const serverPackage = path.join(current, "server", "package.json");
    if (fs.existsSync(packageJson) && fs.existsSync(serverPackage)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

function findPhantomForceRoot({
  env = process.env,
  packageDirectory = __dirname,
  resourcesPath = process.resourcesPath
} = {}) {
  const explicit = String(env.PHANTOMBOT_PHANTOMFORCE_ROOT || "").trim();
  const userProfile = env.USERPROFILE || "";
  const candidates = [
    explicit,
    resourcesPath && path.join(resourcesPath, "phantomforce-runtime"),
    findRepoRoot(packageDirectory),
    userProfile && path.join(
      userProfile,
      "Documents",
      "Codex",
      "deployments",
      "phantomforce-live"
    )
  ].filter(Boolean);

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (
      fs.existsSync(path.join(resolved, "package.json")) &&
      fs.existsSync(path.join(resolved, "server", "package.json"))
    ) {
      return resolved;
    }
  }
  return null;
}

function safeRuntimeSummary(status) {
  return {
    app: {
      reachable: Boolean(status?.app?.reachable),
      source: String(status?.app?.source || "unavailable"),
      checkedAt: status?.app?.checkedAt || null,
      errorCode: status?.app?.errorCode || null
    },
    hermes: {
      installed: Boolean(status?.hermes?.installed),
      healthy: Boolean(status?.hermes?.healthy),
      acpReady: Boolean(status?.hermes?.acpReady),
      version: status?.hermes?.version || null,
      errorCode: status?.hermes?.errorCode || null
    },
    supervisor: {
      startedByDesktop: Boolean(status?.supervisor?.startedByDesktop),
      pid: Number.isInteger(status?.supervisor?.pid)
        ? status.supervisor.pid
        : null,
      errorCode: status?.supervisor?.errorCode || null
    }
  };
}

class RuntimeSupervisor {
  constructor({
    healthUrl,
    packageDirectory,
    resourcesPath,
    logsDirectory,
    env = process.env,
    spawnProcess = spawn
  }) {
    this.healthUrl = healthUrl;
    this.packageDirectory = packageDirectory;
    this.resourcesPath = resourcesPath;
    this.logsDirectory = logsDirectory;
    this.env = env;
    this.spawnProcess = spawnProcess;
    this.child = null;
    this.logStream = null;
    this.lastStatus = null;
  }

  async inspect() {
    const [appReachable, hermes] = await Promise.all([
      probeUrl(this.healthUrl),
      inspectHermes(this.env)
    ]);
    this.lastStatus = safeRuntimeSummary({
      app: {
        reachable: appReachable,
        source: appReachable ? "local" : "unavailable",
        checkedAt: new Date().toISOString(),
        errorCode: appReachable ? null : "phantomforce_unreachable"
      },
      hermes,
      supervisor: {
        startedByDesktop: Boolean(this.child && !this.child.killed),
        pid: this.child?.pid || null,
        errorCode: null
      }
    });
    return this.lastStatus;
  }

  async ensureStarted() {
    const current = await this.inspect();
    if (current.app.reachable) {
      return current;
    }
    if (this.child && !this.child.killed) {
      return current;
    }

    const root = findPhantomForceRoot({
      env: this.env,
      packageDirectory: this.packageDirectory,
      resourcesPath: this.resourcesPath
    });
    if (!root) {
      this.lastStatus.supervisor.errorCode = "phantomforce_runtime_not_found";
      return this.lastStatus;
    }

    const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
    fs.mkdirSync(this.logsDirectory, { recursive: true });
    this.logStream = fs.createWriteStream(
      path.join(this.logsDirectory, "phantombot-runtime.log"),
      { flags: "a" }
    );
    this.child = this.spawnProcess(
      npmExecutable,
      ["run", "dev:server"],
      {
        cwd: root,
        env: {
          ...this.env,
          PHANTOMBOT_DESKTOP_SUPERVISED: "true"
        },
        windowsHide: true,
        detached: false,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    this.child.stdout?.pipe(this.logStream, { end: false });
    this.child.stderr?.pipe(this.logStream, { end: false });
    this.child.once("error", () => {
      if (this.lastStatus) {
        this.lastStatus.supervisor.errorCode =
          "phantomforce_start_failed";
      }
      this.child = null;
    });
    this.child.once("exit", () => {
      this.child = null;
    });

    const reachable = await waitForUrl(this.healthUrl);
    this.lastStatus = safeRuntimeSummary({
      app: {
        reachable,
        source: reachable ? "local" : "unavailable",
        checkedAt: new Date().toISOString(),
        errorCode: reachable ? null : "phantomforce_start_timed_out"
      },
      hermes: await inspectHermes(this.env),
      supervisor: {
        startedByDesktop: Boolean(this.child && !this.child.killed),
        pid: this.child?.pid || null,
        errorCode: reachable ? null : "phantomforce_start_timed_out"
      }
    });
    return this.lastStatus;
  }

  stop() {
    if (this.child && !this.child.killed) {
      this.child.kill();
    }
    this.child = null;
    this.logStream?.end();
    this.logStream = null;
  }
}

module.exports = {
  RuntimeSupervisor,
  findHermesExecutable,
  findPhantomForceRoot,
  inspectHermes,
  isHttpUrl,
  probeUrl,
  safeRuntimeSummary,
  waitForUrl
};
