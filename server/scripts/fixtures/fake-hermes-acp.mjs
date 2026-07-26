import readline from "node:readline";

const mode = process.env.FAKE_HERMES_ACP_MODE || "normal";
const lines = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function respond(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function update(sessionId, value) {
  send({
    jsonrpc: "2.0",
    method: "session/update",
    params: { sessionId, update: value },
  });
}

lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    respond(message.id, {
      protocolVersion: 1,
      agentInfo: { name: "fake-hermes", title: "Fake Hermes", version: "1.0.0" },
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: true, audio: false, embeddedContext: true },
        sessionCapabilities: { close: {}, fork: {}, list: {}, resume: {} },
      },
      authMethods: [],
    });
    return;
  }
  if (message.method === "session/new") {
    respond(message.id, { sessionId: "fake-hermes-session-1" });
    return;
  }
  if (message.method === "session/load") {
    respond(message.id, {});
    return;
  }
  if (message.method === "session/prompt") {
    const sessionId = message.params.sessionId;
    if (mode === "drop") {
      process.exit(17);
      return;
    }
    if (mode === "timeout") return;
    if (mode === "malformed") {
      process.stdout.write("{not-json}\n");
    }
    update(sessionId, {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "private hidden reasoning" },
    });
    update(sessionId, {
      sessionUpdate: "plan",
      entries: [
        { content: "Inspect documentation", status: "completed", priority: "medium" },
        { content: "Propose exact patch", status: "in_progress", priority: "high" },
      ],
    });
    update(sessionId, {
      sessionUpdate: "tool_call",
      toolCallId: "tool-read-1",
      title: "Read docs/PHANTOMBOT_DESKTOP_VERTICAL_SLICE.md",
      kind: "read",
      status: "pending",
      locations: [{ path: "docs/PHANTOMBOT_DESKTOP_VERTICAL_SLICE.md", line: 1 }],
    });
    const responseText = process.env.FAKE_HERMES_ACP_PLAN === "read"
      ? [
          "I prepared a bounded read-only orientation plan.",
          "<phantom_engineering_plan>",
          JSON.stringify({
            version: 1,
            workspace: "fixture-workspace",
            summary: "Inspect the canonical fixture workspace without modification.",
            operations: [
              {
                id: "document",
                kind: "read_text_file",
                summary: "Read the canonical desktop slice document",
                path: "docs/PHANTOMBOT_DESKTOP_VERTICAL_SLICE.md",
                maxBytes: 65536,
              },
              {
                id: "scripts",
                kind: "inspect_package_scripts",
                summary: "Inspect declared repository scripts",
                path: "package.json",
              },
            ],
            verification: { inspectDiff: true, requireCleanRollback: true },
          }),
          "</phantom_engineering_plan>",
        ].join("\n")
      : [
      "I found the canonical documentation and prepared one harmless change.",
      "<phantom_tool_intent>",
      JSON.stringify({
        version: 1,
        operation: "documentation_patch",
        relativePath: "docs/PHANTOMBOT_DESKTOP_VERTICAL_SLICE.md",
        expectedText: "Status: implemented desktop/runtime foundation; the complete master mission is not finished.",
        replacementText: "Status: implemented desktop/runtime foundation and governed ACP operator slice; the complete master mission is not finished.",
        testCommand: "npm run test:phantombot-desktop",
        summary: "Update the PhantomBot milestone status and run desktop runtime tests.",
      }),
      "</phantom_tool_intent>",
        ].join("\n");
    update(sessionId, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: responseText },
    });
    respond(message.id, { stopReason: "end_turn" });
    return;
  }
  if (message.method === "session/cancel") {
    update(message.params.sessionId, {
      sessionUpdate: "session_info_update",
      title: "Cancellation acknowledged",
    });
    return;
  }
  if (message.id !== undefined) {
    send({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32601, message: "unknown method" },
    });
  }
});
