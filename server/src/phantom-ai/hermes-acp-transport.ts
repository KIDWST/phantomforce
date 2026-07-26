import { EventEmitter } from "node:events";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface as ReadLineInterface } from "node:readline";
import { isAbsolute, relative, resolve } from "node:path";
import { realpath } from "node:fs/promises";

import { redactSensitiveText } from "./hermes-ledger.js";

export const HERMES_ACP_PROTOCOL_VERSION = 1;

export type HermesAcpNormalizedEventType =
  | "connecting"
  | "connected"
  | "analyzing"
  | "context_inspection"
  | "plan_created"
  | "approval_required"
  | "operation_started"
  | "operation_progress"
  | "tool_result"
  | "usage"
  | "message_delta"
  | "completed"
  | "blocked"
  | "cancelled"
  | "disconnected"
  | "failed";

export type HermesAcpNormalizedEvent = {
  sequence: number;
  at: string;
  type: HermesAcpNormalizedEventType;
  summary: string;
  data?: Record<string, unknown>;
};

export type HermesAcpCapabilities = {
  protocolVersion: number;
  agentName: string;
  agentVersion: string;
  loadSession: boolean;
  prompt: {
    image: boolean;
    audio: boolean;
    embeddedContext: boolean;
  };
  session: {
    close: boolean;
    fork: boolean;
    list: boolean;
    resume: boolean;
  };
};

type PendingRequest = {
  method: string;
  timer: NodeJS.Timeout;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type JsonRpcMessage = {
  jsonrpc?: string;
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
};

type HermesAcpTransportOptions = {
  executable: string;
  args?: string[];
  workspaceRoot: string;
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
  idleTimeoutMs?: number;
  spawnProcess?: typeof spawn;
};

const MAX_STDERR_CHARS = 12_000;
const MAX_EVENT_SUMMARY_CHARS = 800;
const READ_ONLY_KINDS = new Set(["read", "search", "think", "fetch"]);

function clean(value: unknown, max = MAX_EVENT_SUMMARY_CHARS) {
  return redactSensitiveText(String(value ?? "").replace(/\s+/g, " ").trim()).slice(0, max);
}

function cleanStreamChunk(value: unknown, max = 2_000) {
  return redactSensitiveText(String(value ?? "").replace(/\u0000/g, "")).slice(0, max);
}

function safeBoolean(value: unknown) {
  return value === true;
}

function isPathInside(root: string, candidate: string) {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function validateLocationsInsideWorkspace(
  workspaceRoot: string,
  locations: unknown,
) {
  if (!Array.isArray(locations) || locations.length === 0) return true;
  const canonicalRoot = await realpath(workspaceRoot);
  for (const item of locations) {
    const rawPath = item && typeof item === "object"
      ? String((item as Record<string, unknown>).path ?? "")
      : "";
    if (!rawPath) return false;
    const target = resolve(canonicalRoot, rawPath);
    let canonicalTarget = target;
    try {
      canonicalTarget = await realpath(target);
    } catch {
      try {
        canonicalTarget = await realpath(resolve(target, ".."));
      } catch {
        return false;
      }
    }
    if (!isPathInside(canonicalRoot, canonicalTarget)) return false;
  }
  return true;
}

export function normalizeHermesAcpUpdate(
  update: Record<string, unknown>,
  sequence: number,
): HermesAcpNormalizedEvent | null {
  const kind = String(update.sessionUpdate || "");
  const at = new Date().toISOString();
  if (kind === "agent_message_chunk") {
    const content = update.content as Record<string, unknown> | undefined;
    const text = content?.type === "text" ? cleanStreamChunk(content.text, 2_000) : "";
    if (!text) return null;
    return { sequence, at, type: "message_delta", summary: text };
  }
  if (kind === "agent_thought_chunk") {
    return {
      sequence,
      at,
      type: "analyzing",
      summary: "Hermes is analyzing the request.",
    };
  }
  if (kind === "plan") {
    const entries = Array.isArray(update.entries)
      ? update.entries.slice(0, 20).map((entry) => {
          const row = entry && typeof entry === "object"
            ? entry as Record<string, unknown>
            : {};
          return {
            content: clean(row.content, 240),
            status: clean(row.status, 40),
            priority: clean(row.priority, 40),
          };
        })
      : [];
    return {
      sequence,
      at,
      type: "plan_created",
      summary: entries.length
        ? `Hermes created a ${entries.length}-step plan.`
        : "Hermes updated the plan.",
      data: { entries },
    };
  }
  if (kind === "tool_call") {
    const toolKind = clean(update.kind, 40) || "other";
    return {
      sequence,
      at,
      type: READ_ONLY_KINDS.has(toolKind)
        ? "context_inspection"
        : "approval_required",
      summary: READ_ONLY_KINDS.has(toolKind)
        ? clean(update.title, 300) || "Hermes is inspecting workspace context."
        : clean(update.title, 300) || "Hermes proposed a consequential operation.",
      data: {
        toolCallId: clean(update.toolCallId, 120),
        kind: toolKind,
        locations: Array.isArray(update.locations)
          ? update.locations.slice(0, 20).map((item) => ({
              path: clean((item as Record<string, unknown>)?.path, 260),
              line: Number((item as Record<string, unknown>)?.line || 0) || null,
            }))
          : [],
      },
    };
  }
  if (kind === "tool_call_update") {
    const status = clean(update.status, 40);
    return {
      sequence,
      at,
      type: status === "completed" || status === "failed"
        ? "tool_result"
        : "operation_progress",
      summary: clean(update.title, 300)
        || (status ? `Tool ${status}.` : "Hermes reported tool progress."),
      data: {
        toolCallId: clean(update.toolCallId, 120),
        status,
        kind: clean(update.kind, 40),
      },
    };
  }
  if (kind === "usage_update") {
    return {
      sequence,
      at,
      type: "usage",
      summary: "Hermes updated context usage.",
      data: {
        used: Number(update.used || 0),
        size: Number(update.size || 0),
      },
    };
  }
  if (kind === "session_info_update") {
    return {
      sequence,
      at,
      type: "operation_progress",
      summary: clean(update.title, 300) || "Hermes updated the session.",
    };
  }
  return null;
}

export class HermesAcpTransport extends EventEmitter {
  private readonly options: HermesAcpTransportOptions;
  private process: ChildProcessWithoutNullStreams | null = null;
  private stdoutLines: ReadLineInterface | null = null;
  private stderrLines: ReadLineInterface | null = null;
  private nextRequestId = 1;
  private sequence = 0;
  private pending = new Map<string | number, PendingRequest>();
  private stderrTail = "";
  private stopped = false;
  private lastActivityAt = 0;
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(options: HermesAcpTransportOptions) {
    super();
    this.options = options;
  }

  private emitNormalized(
    type: HermesAcpNormalizedEventType,
    summary: string,
    data?: Record<string, unknown>,
  ) {
    const event: HermesAcpNormalizedEvent = {
      sequence: ++this.sequence,
      at: new Date().toISOString(),
      type,
      summary: clean(summary),
      ...(data ? { data } : {}),
    };
    this.emit("event", event);
    return event;
  }

  private touch() {
    this.lastActivityAt = Date.now();
  }

  private armIdleTimeout() {
    if (this.idleTimer) clearInterval(this.idleTimer);
    const idleTimeoutMs = Math.max(5_000, this.options.idleTimeoutMs ?? 180_000);
    this.idleTimer = setInterval(() => {
      if (
        this.process
        && Date.now() - this.lastActivityAt > idleTimeoutMs
        && this.pending.size === 0
      ) {
        this.emitNormalized("disconnected", "Hermes closed after being idle.");
        this.close();
      }
    }, Math.min(10_000, Math.floor(idleTimeoutMs / 2)));
    this.idleTimer.unref();
  }

  async start() {
    if (this.process) return;
    this.emitNormalized("connecting", "Connecting to Hermes ACP.");
    this.stopped = false;
    this.process = (this.options.spawnProcess ?? spawn)(
      this.options.executable,
      this.options.args ?? ["acp"],
      {
        cwd: this.options.workspaceRoot,
        env: {
          ...this.options.env,
          HERMES_DISPLAY_BACKEND: "none",
        },
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.process.once("error", (error) => {
      this.failAll(new Error(`hermes_acp_spawn_failed:${clean(error.message, 160)}`));
      this.emitNormalized("failed", "Hermes ACP could not start.");
    });
    this.process.once("exit", (code, signal) => {
      const expected = this.stopped;
      this.process = null;
      this.failAll(new Error(`hermes_acp_disconnected:${code ?? "null"}:${signal ?? "none"}`));
      this.emitNormalized(
        expected ? "disconnected" : "failed",
        expected ? "Hermes disconnected." : "Hermes ACP disconnected unexpectedly.",
        { exitCode: code, signal: signal || null },
      );
    });
    this.stdoutLines = createInterface({ input: this.process.stdout });
    this.stderrLines = createInterface({ input: this.process.stderr });
    this.stdoutLines.on("line", (line) => void this.handleLine(line));
    this.stderrLines.on("line", (line) => {
      this.stderrTail = `${this.stderrTail}\n${clean(line, 1_000)}`.slice(-MAX_STDERR_CHARS);
    });
    this.touch();
    this.armIdleTimeout();
  }

  private send(message: JsonRpcMessage) {
    if (!this.process || this.process.killed || !this.process.stdin.writable) {
      throw new Error("hermes_acp_not_connected");
    }
    this.touch();
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private request(method: string, params: Record<string, unknown>) {
    const id = this.nextRequestId++;
    const timeoutMs = Math.max(1_000, this.options.requestTimeoutMs ?? 180_000);
    return new Promise<unknown>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(new Error(`hermes_acp_timeout:${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        method,
        timer,
        resolve: resolvePromise,
        reject: rejectPromise,
      });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  private response(id: string | number, result: unknown) {
    this.send({ jsonrpc: "2.0", id, result });
  }

  private async handleLine(line: string) {
    this.touch();
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      this.emitNormalized("failed", "Hermes ACP returned a malformed event.");
      return;
    }
    if (message.method && message.id !== undefined) {
      await this.handleIncomingRequest(message);
      return;
    }
    if (message.method === "session/update") {
      const update = message.params?.update;
      if (update && typeof update === "object") {
        const event = normalizeHermesAcpUpdate(
          update as Record<string, unknown>,
          ++this.sequence,
        );
        if (event) this.emit("event", event);
      }
      return;
    }
    if (message.id === undefined) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(
        `hermes_acp_error:${pending.method}:${message.error.code ?? "unknown"}:${clean(message.error.message, 160)}`,
      ));
      return;
    }
    pending.resolve(message.result);
  }

  private async handleIncomingRequest(message: JsonRpcMessage) {
    if (message.method !== "session/request_permission" || message.id === undefined) {
      if (message.id !== undefined) {
        this.send({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: "Method not supported by PhantomBot." },
        });
      }
      return;
    }
    const toolCall = message.params?.toolCall;
    const row = toolCall && typeof toolCall === "object"
      ? toolCall as Record<string, unknown>
      : {};
    const kind = clean(row.kind, 40) || "other";
    const locationsSafe = await validateLocationsInsideWorkspace(
      this.options.workspaceRoot,
      row.locations,
    );
    const options = Array.isArray(message.params?.options)
      ? message.params?.options as Array<Record<string, unknown>>
      : [];
    const allowOption = options.find((option) => option.kind === "allow_once");
    if (READ_ONLY_KINDS.has(kind) && locationsSafe && allowOption?.optionId) {
      this.emitNormalized(
        "context_inspection",
        clean(row.title, 300) || "Hermes requested an allowed read-only operation.",
        { kind },
      );
      this.response(message.id, {
        outcome: {
          outcome: "selected",
          optionId: String(allowOption.optionId),
        },
      });
      return;
    }
    this.emitNormalized(
      "approval_required",
      clean(row.title, 300) || "Hermes proposed a consequential operation.",
      {
        kind,
        toolCallId: clean(row.toolCallId, 120),
        locationsSafe,
      },
    );
    this.response(message.id, { outcome: { outcome: "cancelled" } });
  }

  async initialize(): Promise<HermesAcpCapabilities> {
    await this.start();
    const result = await this.request("initialize", {
      protocolVersion: HERMES_ACP_PROTOCOL_VERSION,
      clientCapabilities: {
        auth: { terminal: false },
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      clientInfo: {
        name: "phantombot",
        title: "PhantomBot",
        version: "0.3.0",
      },
    }) as Record<string, unknown>;
    const agentCapabilities = (result.agentCapabilities || {}) as Record<string, unknown>;
    const prompt = (agentCapabilities.promptCapabilities || {}) as Record<string, unknown>;
    const session = (agentCapabilities.sessionCapabilities || {}) as Record<string, unknown>;
    const agentInfo = (result.agentInfo || {}) as Record<string, unknown>;
    const capabilities: HermesAcpCapabilities = {
      protocolVersion: Number(result.protocolVersion || 0),
      agentName: clean(agentInfo.title || agentInfo.name || "Hermes", 100),
      agentVersion: clean(agentInfo.version || "unknown", 100),
      loadSession: safeBoolean(agentCapabilities.loadSession),
      prompt: {
        image: safeBoolean(prompt.image),
        audio: safeBoolean(prompt.audio),
        embeddedContext: safeBoolean(prompt.embeddedContext),
      },
      session: {
        close: Boolean(session.close),
        fork: Boolean(session.fork),
        list: Boolean(session.list),
        resume: Boolean(session.resume),
      },
    };
    if (capabilities.protocolVersion !== HERMES_ACP_PROTOCOL_VERSION) {
      throw new Error(`hermes_acp_protocol_mismatch:${capabilities.protocolVersion}`);
    }
    this.emitNormalized(
      "connected",
      `Connected to ${capabilities.agentName} ${capabilities.agentVersion}.`,
      { capabilities },
    );
    return capabilities;
  }

  async newSession() {
    const result = await this.request("session/new", {
      cwd: this.options.workspaceRoot,
      mcpServers: [],
    }) as Record<string, unknown>;
    const sessionId = clean(result.sessionId, 180);
    if (!sessionId) throw new Error("hermes_acp_session_id_missing");
    return { sessionId, raw: result };
  }

  async loadSession(sessionId: string) {
    const result = await this.request("session/load", {
      sessionId,
      cwd: this.options.workspaceRoot,
      mcpServers: [],
    }) as Record<string, unknown>;
    return { sessionId, raw: result };
  }

  async prompt(sessionId: string, prompt: string) {
    this.emitNormalized("analyzing", "Hermes is analyzing the request.");
    const result = await this.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: prompt.slice(0, 16_000) }],
    }) as Record<string, unknown>;
    const stopReason = clean(result.stopReason, 80) || "end_turn";
    this.emitNormalized(
      stopReason === "cancelled" ? "cancelled" : "completed",
      stopReason === "cancelled"
        ? "Hermes stopped the request."
        : "Hermes completed the planning turn.",
      { stopReason },
    );
    return result;
  }

  cancel(sessionId: string) {
    this.send({
      jsonrpc: "2.0",
      method: "session/cancel",
      params: { sessionId },
    });
    this.emitNormalized("cancelled", "Cancellation was sent to Hermes.");
  }

  getDiagnostics() {
    return {
      connected: Boolean(this.process && !this.process.killed),
      pendingRequests: this.pending.size,
      stderrAvailable: Boolean(this.stderrTail),
    };
  }

  private failAll(error: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  close() {
    this.stopped = true;
    if (this.idleTimer) clearInterval(this.idleTimer);
    this.idleTimer = null;
    this.stdoutLines?.close();
    this.stderrLines?.close();
    this.stdoutLines = null;
    this.stderrLines = null;
    if (this.process && !this.process.killed) {
      this.process.kill();
    }
    this.process = null;
    this.failAll(new Error("hermes_acp_closed"));
  }
}
