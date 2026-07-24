import { createServer } from "node:http";
import { spawn } from "node:child_process";

const host = process.env.PHANTOM_CHATGPT_ADAPTER_HOST || "127.0.0.1";
const port = Number(process.env.PHANTOM_CHATGPT_ADAPTER_PORT || 8791);
const command = String(process.env.PHANTOM_CHATGPT_ADAPTER_COMMAND || "").trim();
const token = String(process.env.PHANTOM_AGENT_ASSIST_BRIDGE_TOKEN || "").trim();
const maxBodyBytes = 96_000;

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function authorized(req) {
  if (!token) return true;
  return req.headers.authorization === `Bearer ${token}`;
}

function runAdapterCommand(payload) {
  return new Promise((resolve) => {
    if (!command) {
      resolve({
        ok: false,
        status: "chatgpt_session_not_connected",
        error: "PHANTOM_CHATGPT_ADAPTER_COMMAND is not configured. Connect a user-owned ChatGPT session adapter command; no ChatGPT password is stored here.",
      });
      return;
    }

    const child = spawn(command, {
      shell: true,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PHANTOM_CHATGPT_ADAPTER_REQUEST: "",
      },
    });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => child.kill(), Number(process.env.PHANTOM_CHATGPT_ADAPTER_TIMEOUT_MS || 30000));
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, status: "adapter_command_error", error: String(error.message || error) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const output = Buffer.concat(stdout).toString("utf8").trim();
      const errorText = Buffer.concat(stderr).toString("utf8").trim();
      if (code !== 0) {
        resolve({ ok: false, status: "adapter_command_failed", error: errorText || `adapter command exited ${code}` });
        return;
      }
      try {
        const parsed = JSON.parse(output);
        resolve(parsed);
      } catch {
        resolve({ ok: Boolean(output), output_text: output, message: output, status: output ? "ok" : "empty_adapter_output" });
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${host}:${port}`);
  if (req.socket.remoteAddress && !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress)) {
    json(res, 403, { ok: false, error: "local_only" });
    return;
  }
  if (url.pathname === "/health" && req.method === "GET") {
    json(res, 200, {
      ok: true,
      adapter: "phantomforce-chatgpt-assist-adapter",
      local_only: true,
      command_configured: Boolean(command),
      session_connected: Boolean(command),
      stores_password: false,
      sends_external_actions: false,
    });
    return;
  }
  if (url.pathname !== "/assist" || req.method !== "POST") {
    json(res, 404, { ok: false, error: "not_found" });
    return;
  }
  if (!authorized(req)) {
    json(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  try {
    const body = await readBody(req);
    const payload = body ? JSON.parse(body) : {};
    const result = await runAdapterCommand(payload);
    if (!result?.ok && !result?.output_text && !result?.message) {
      json(res, 503, result);
      return;
    }
    json(res, 200, {
      ok: true,
      provider: "chatgpt_plus",
      output_text: String(result.output_text || result.message || "").slice(0, 6000),
      raw_status: result.status || "ok",
    });
  } catch (error) {
    json(res, 400, { ok: false, error: String(error instanceof Error ? error.message : error) });
  }
});

server.listen(port, host, () => {
  console.log(`PhantomForce ChatGPT assist adapter listening on http://${host}:${port}`);
  console.log(command ? "Adapter command configured." : "No PHANTOM_CHATGPT_ADAPTER_COMMAND configured; /assist will safely report not connected.");
});
