#!/usr/bin/env node
// OpenRouter Agent — a from-scratch interactive coding agent, spawned by
// Termina exactly like claude/codex (same PTY, same wall tile, same
// detection/ledger/DVR infrastructure). Reads OPENROUTER_API_KEY and
// OPENROUTER_MODEL from its environment (populated by connections.js via
// terminalEnv()); exits with a clear one-line error in its own PTY output
// if either is missing.
import { createPasteParser } from "./paste.mjs";
import { chatCompletion, TOOL_DEFINITIONS } from "./openrouter-client.mjs";
import { listDirectory, readFile, runCommand, writeFile } from "./tools.mjs";
import { appendUsage } from "./usage-log.mjs";

const IDLE_PROMPT = "openrouter▸ ";

function parseArgs(argv) {
  const args = { mode: "approval", usageLogPath: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--mode") args.mode = argv[++i];
    else if (argv[i] === "--usage-log") args.usageLogPath = argv[++i];
  }
  return args;
}

const TOOL_FNS = { read_file: readFile, write_file: writeFile, list_directory: listDirectory, run_command: runCommand };
const WRITE_TOOLS = new Set(["write_file", "run_command"]);

// A single stdin listener is registered once in main() and dispatches
// based on state.pendingApproval — NOT a second competing "data" listener
// per approval prompt. Two listeners on the same stream would both fire on
// every keypress (the paste parser would absorb the 'y'/'n' byte as stray
// buffered text, corrupting the next real submission) — this resolver
// hand-off avoids that entirely.
function askApproval(state, toolName) {
  process.stdout.write(`APPROVE ${toolName}? (y/n) `);
  return new Promise((resolve) => {
    state.pendingApproval = (chunk) => {
      state.pendingApproval = null;
      process.stdout.write("\r\n");
      resolve(chunk.toString("utf8").toLowerCase().startsWith("y"));
    };
  });
}

async function runTool(name, toolArgs, state) {
  const fn = TOOL_FNS[name];
  if (!fn) return { error: `unknown tool: ${name}` };
  if (state.mode === "approval" && WRITE_TOOLS.has(name)) {
    const approved = await askApproval(state, `${name}(${JSON.stringify(toolArgs)})`);
    if (!approved) return { error: "denied by user" };
  }
  process.stdout.write(`\r\n→ ${name}(${JSON.stringify(toolArgs)})\r\n`);
  return fn(toolArgs, { cwd: process.cwd(), mode: state.mode });
}

async function handleSubmission(text, state) {
  state.messages.push({ role: "user", content: text });
  for (let turn = 0; turn < 20; turn += 1) {
    let response;
    try {
      response = await chatCompletion({
        apiKey: state.apiKey,
        model: state.model,
        messages: state.messages,
        tools: TOOL_DEFINITIONS,
      });
    } catch (error) {
      process.stdout.write(`\r\n[error] ${error.message}\r\n`);
      break;
    }
    const usage = response.usage ?? {};
    await appendUsage(state.usageLogPath, {
      ts: Date.now(),
      promptTokens: usage.prompt_tokens ?? 0,
      completionTokens: usage.completion_tokens ?? 0,
      model: state.model,
      costUsd: typeof response.usage?.cost === "number" ? response.usage.cost : null,
    });

    const choice = response.choices?.[0];
    const message = choice?.message ?? {};
    state.messages.push(message);

    if (!message.tool_calls?.length) {
      process.stdout.write(`\r\n${message.content ?? ""}\r\n`);
      break;
    }
    for (const call of message.tool_calls) {
      const toolArgs = JSON.parse(call.function.arguments || "{}");
      const result = await runTool(call.function.name, toolArgs, state);
      state.messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  process.stdout.write(`\r\n${IDLE_PROMPT}`);
}

function main() {
  const { mode, usageLogPath } = parseArgs(process.argv.slice(2));
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL;
  if (!apiKey || !model) {
    process.stdout.write("[error] OPENROUTER_API_KEY and OPENROUTER_MODEL must be set (Connections panel) — exiting.\r\n");
    process.exit(1);
  }

  const state = {
    apiKey,
    model,
    mode,
    usageLogPath,
    pendingApproval: null,
    messages: [
      {
        role: "system",
        content: "You are a capable coding agent operating inside a real project directory via read_file/write_file/list_directory/run_command tools.",
      },
    ],
  };

  process.stdout.write(`OpenRouter agent — model ${model}, mode ${mode}\r\n${IDLE_PROMPT}`);
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  const parser = createPasteParser();
  process.stdin.on("data", async (chunk) => {
    if (state.pendingApproval) {
      state.pendingApproval(chunk);
      return;
    }
    const result = parser.feed(chunk.toString("utf8"));
    if (result.type === "submitted" && result.text.trim()) {
      await handleSubmission(result.text, state);
    }
  });
}

main();
