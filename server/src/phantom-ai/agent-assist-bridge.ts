import { redactSensitiveText } from "./hermes-ledger.js";

export type AgentAssistCaller =
  | "codex"
  | "phantombot"
  | "phantom_ai"
  | "agent_workforce"
  | "operator"
  | "unknown";

export type AgentAssistMode = "instant" | "review" | "strategy" | "copy" | "debug";
export type AgentAssistEffort = "instant" | "standard" | "deep";

export type AgentAssistRequest = {
  caller?: AgentAssistCaller | string;
  mode?: AgentAssistMode | string;
  effort?: AgentAssistEffort | string;
  task: string;
  context?: string;
  constraints?: string[];
  desired_output?: string;
  execute_bridge?: boolean;
};

export type AgentAssistStatus = {
  bridge_id: "phantom-agent-assist-chatgpt";
  label: "Universal ChatGPT Assist Bridge";
  intended_provider: "chatgpt_plus";
  intended_mode: "instant";
  effort_levels: AgentAssistEffort[];
  universal: true;
  session_scoped: false;
  configured: boolean;
  executable: boolean;
  transport: "http" | "relay_packet";
  bridge_url_configured: boolean;
  setup_required: boolean;
  subscription_billing_note: string;
  setup_options: Array<{
    id: "relay_packet" | "local_chatgpt_adapter" | "openai_api_key";
    label: string;
    ready: boolean;
    note: string;
  }>;
  env: {
    bridge_enabled: "PHANTOM_AGENT_ASSIST_BRIDGE_ENABLED";
    bridge_url: "PHANTOM_AGENT_ASSIST_BRIDGE_URL";
    bridge_token: "PHANTOM_AGENT_ASSIST_BRIDGE_TOKEN";
    openai_api_key: "OPENAI_API_KEY";
  };
  callable_by: AgentAssistCaller[];
  safety: {
    stores_secrets: false;
    exposes_raw_secret: false;
    sends_external_actions: false;
    writes_database: false;
    requires_explicit_execute_bridge: true;
    output_bounded: true;
  };
  note: string;
};

export type AgentAssistBridgeResult = {
  ok: boolean;
  bridge_id: AgentAssistStatus["bridge_id"];
  caller: AgentAssistCaller;
  mode: AgentAssistMode;
  effort: AgentAssistEffort;
  status: "relay_packet_ready" | "bridge_called" | "bridge_unavailable" | "bridge_error";
  provider: "chatgpt_plus";
  provider_mode: AgentAssistEffort;
  output_text: string;
  relay_packet: {
    title: string;
    prompt: string;
    constraints: string[];
    desired_output: string;
  };
  bridge_called: boolean;
  provider_called: boolean;
  network_call_performed: boolean;
  external_action_executed: false;
  database_written: false;
  raw_secret_exposed: false;
  error_message: string | null;
};

const MAX_TASK_CHARS = 1800;
const MAX_CONTEXT_CHARS = 4200;
const MAX_CONSTRAINTS = 18;
const MAX_CONSTRAINT_CHARS = 260;
const MAX_OUTPUT_CHARS = 2200;
const VALID_CALLERS: AgentAssistCaller[] = ["codex", "phantombot", "phantom_ai", "agent_workforce", "operator", "unknown"];
const VALID_MODES: AgentAssistMode[] = ["instant", "review", "strategy", "copy", "debug"];
const VALID_EFFORTS: AgentAssistEffort[] = ["instant", "standard", "deep"];

function clean(value: unknown, maxChars: number) {
  return redactSensitiveText(String(value ?? "").replace(/\s+/g, " ").trim()).slice(0, maxChars);
}

function cleanMultiline(value: unknown, maxChars: number) {
  return redactSensitiveText(String(value ?? "").replace(/\r\n/g, "\n").trim()).slice(0, maxChars);
}

function safeCaller(value: unknown): AgentAssistCaller {
  const candidate = clean(value, 80).toLowerCase().replace(/[^a-z0-9_]+/g, "_") as AgentAssistCaller;
  return VALID_CALLERS.includes(candidate) ? candidate : "unknown";
}

function safeMode(value: unknown): AgentAssistMode {
  const candidate = clean(value, 80).toLowerCase().replace(/[^a-z0-9_]+/g, "_") as AgentAssistMode;
  return VALID_MODES.includes(candidate) ? candidate : "instant";
}

function safeEffort(value: unknown): AgentAssistEffort {
  const candidate = clean(value, 80).toLowerCase().replace(/[^a-z0-9_]+/g, "_") as AgentAssistEffort;
  return VALID_EFFORTS.includes(candidate) ? candidate : "standard";
}

function bridgeUrl() {
  return clean(process.env.PHANTOM_AGENT_ASSIST_BRIDGE_URL || "http://127.0.0.1:8791/assist", 500);
}

function bridgeEnabled() {
  return process.env.PHANTOM_AGENT_ASSIST_BRIDGE_ENABLED !== "false";
}

function bridgeTimeoutMs() {
  const parsed = Number(process.env.PHANTOM_AGENT_ASSIST_TIMEOUT_MS ?? 8000);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1000), 20000) : 8000;
}

function baseConstraints(input: AgentAssistRequest) {
  const callerConstraints = Array.isArray(input.constraints)
    ? input.constraints.map((item) => clean(item, MAX_CONSTRAINT_CHARS)).filter(Boolean).slice(0, MAX_CONSTRAINTS)
    : [];
  return [
    "Use ChatGPT Plus instant mode when available: fast, clear, high-signal.",
    "Return judgment or help only; do not send, post, upload, deploy, charge, scan, or mutate external systems.",
    "Do not claim execution happened unless the calling agent provides a real receipt.",
    "Do not expose secrets, credentials, tokens, cookies, raw prompts, or hidden chain-of-thought.",
    "Prefer practical, direct answers over broad brainstorming.",
    ...callerConstraints,
  ];
}

export function getAgentAssistBridgeStatus(): AgentAssistStatus {
  const url = bridgeUrl();
  const executable = bridgeEnabled() && !!url;
  return {
    bridge_id: "phantom-agent-assist-chatgpt",
    label: "Universal ChatGPT Assist Bridge",
    intended_provider: "chatgpt_plus",
    intended_mode: "instant",
    effort_levels: [...VALID_EFFORTS],
    universal: true,
    session_scoped: false,
    configured: !!url,
    executable,
    transport: executable ? "http" : "relay_packet",
    bridge_url_configured: !!url,
    setup_required: !executable,
    subscription_billing_note: "ChatGPT Plus/Pro subscriptions are for ChatGPT apps. PhantomForce can use a user-owned local ChatGPT adapter when configured; OpenAI API/Codex automation remains a separate billing path. PhantomForce never stores a ChatGPT password.",
    setup_options: [
      {
        id: "relay_packet",
        label: "Relay packet",
        ready: true,
        note: "Always available. PhantomForce prepares a bounded prompt for a human or browser assistant to review.",
      },
      {
        id: "local_chatgpt_adapter",
        label: "Local ChatGPT adapter",
        ready: executable,
        note: "Defaults to http://127.0.0.1:8791/assist. Start server/scripts/chatgpt-assist-adapter.mjs and connect a user-owned ChatGPT session/adapter command.",
      },
      {
        id: "openai_api_key",
        label: "OpenAI API key",
        ready: Boolean(process.env.OPENAI_API_KEY),
        note: "Best for Codex/OpenAI capabilities. API usage is billed separately from ChatGPT Plus/Pro.",
      },
    ],
    env: {
      bridge_enabled: "PHANTOM_AGENT_ASSIST_BRIDGE_ENABLED",
      bridge_url: "PHANTOM_AGENT_ASSIST_BRIDGE_URL",
      bridge_token: "PHANTOM_AGENT_ASSIST_BRIDGE_TOKEN",
      openai_api_key: "OPENAI_API_KEY",
    },
    callable_by: [...VALID_CALLERS.filter((caller) => caller !== "unknown")],
    safety: {
      stores_secrets: false,
      exposes_raw_secret: false,
      sends_external_actions: false,
      writes_database: false,
      requires_explicit_execute_bridge: true,
      output_bounded: true,
    },
    note: executable
      ? "A configured local/HTTP ChatGPT assist adapter can be called when requests explicitly set execute_bridge=true."
      : "No executable ChatGPT adapter is configured yet; agents receive a bounded relay packet instead of a fake answer.",
  };
}

export function buildAgentAssistRelayPacket(input: AgentAssistRequest) {
  const caller = safeCaller(input.caller);
  const mode = safeMode(input.mode);
  const effort = safeEffort(input.effort);
  const task = cleanMultiline(input.task, MAX_TASK_CHARS);
  const context = cleanMultiline(input.context, MAX_CONTEXT_CHARS);
  const desiredOutput = clean(input.desired_output || "Return a concise verdict, recommendation, or replacement wording that the calling agent can use.", 500);
  const constraints = baseConstraints(input);
  const prompt = [
    "You are ChatGPT Plus acting as the universal assist brain for PhantomForce agents.",
    `Caller: ${caller}`,
    `Mode: ${mode}`,
    `Effort: ${effort}`,
    "",
    "Task:",
    task || "No task text provided.",
    "",
    context ? `Context:\n${context}\n` : "",
    "Constraints:",
    constraints.map((constraint) => `- ${constraint}`).join("\n"),
    "",
    `Desired output: ${desiredOutput}`,
  ].filter(Boolean).join("\n");

  return {
    caller,
    mode,
    effort,
    relay_packet: {
      title: `ChatGPT Plus ${mode} assist for ${caller}`,
      prompt: prompt.slice(0, MAX_CONTEXT_CHARS + MAX_TASK_CHARS + 1400),
      constraints,
      desired_output: desiredOutput,
    },
  };
}

async function callHttpBridge(packet: ReturnType<typeof buildAgentAssistRelayPacket>["relay_packet"], effort: AgentAssistEffort) {
  const url = bridgeUrl();
  if (!bridgeEnabled() || !url) {
    return { ok: false as const, status: "bridge_unavailable" as const, output_text: "", error_message: "ChatGPT assist bridge is not configured for execution." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), bridgeTimeoutMs());
  try {
    const token = process.env.PHANTOM_AGENT_ASSIST_BRIDGE_TOKEN?.trim();
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        provider: "chatgpt_plus",
        mode: effort,
        effort,
        packet,
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as { output_text?: unknown; message?: unknown; error?: unknown } | null;
    const output = cleanMultiline(payload?.output_text ?? payload?.message ?? "", MAX_OUTPUT_CHARS);
    if (!response.ok || !output) {
      return {
        ok: false as const,
        status: "bridge_error" as const,
        output_text: "",
        error_message: clean(payload?.error ?? `Bridge returned HTTP ${response.status} without usable text.`, 500),
      };
    }
    return { ok: true as const, status: "bridge_called" as const, output_text: output, error_message: null };
  } catch (error) {
    return {
      ok: false as const,
      status: "bridge_error" as const,
      output_text: "",
      error_message: clean(error instanceof Error ? error.message : error, 500),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function requestAgentAssist(input: AgentAssistRequest): Promise<AgentAssistBridgeResult> {
  const { caller, mode, effort, relay_packet } = buildAgentAssistRelayPacket(input);
  const shouldExecute = input.execute_bridge === true;
  const bridge = shouldExecute ? await callHttpBridge(relay_packet, effort) : null;
  const status = bridge?.status ?? (getAgentAssistBridgeStatus().executable ? "relay_packet_ready" : "bridge_unavailable");
  const called = bridge?.status === "bridge_called";
  const outputText = called
    ? bridge.output_text
    : "ChatGPT Plus assist is ready as a universal relay packet. Configure PHANTOM_AGENT_ASSIST_BRIDGE_URL and set execute_bridge=true to call an approved adapter.";

  return {
    ok: called || status === "relay_packet_ready" || status === "bridge_unavailable",
    bridge_id: "phantom-agent-assist-chatgpt",
    caller,
    mode,
    effort,
    status,
    provider: "chatgpt_plus",
    provider_mode: effort,
    output_text: outputText,
    relay_packet,
    bridge_called: called,
    provider_called: called,
    network_call_performed: called,
    external_action_executed: false,
    database_written: false,
    raw_secret_exposed: false,
    error_message: bridge?.error_message ?? null,
  };
}
