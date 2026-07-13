// The one piece of this feature that requires a live OPENROUTER_API_KEY to
// verify — no key was available while building this, so this function is
// deliberately minimal and isolated. Standard OpenAI-compatible chat-
// completions shape, per OpenRouter's documented API.
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export async function chatCompletion({ apiKey, model, messages, tools }) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages, tools, tool_choice: tools?.length ? "auto" : undefined }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body?.error?.message || `OpenRouter request failed: HTTP ${res.status}`);
  }
  return body;
}

export const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file's contents, relative to the current working directory.",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write content to a file, relative to the current working directory. Creates or overwrites.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_directory",
      description: "List entries in a directory, relative to the current working directory.",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Run a shell command in the current working directory and return its output.",
      parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
    },
  },
];
