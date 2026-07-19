import json

from router import route_chat

MAX_TOOL_CALLS = 60


def extract_json_object(text):
    s = (text or "").strip()
    if s.startswith("```"):
        s = s.strip("`").strip()
        if s.lower().startswith("json"):
            s = s[4:].strip()
    if s.startswith("{") and s.endswith("}"):
        return s
    start = s.find("{")
    end = s.rfind("}")
    if start >= 0 and end > start:
        candidate = s[start:end + 1]
        try:
            json.loads(candidate)
            return candidate
        except json.JSONDecodeError:
            return ""
    return ""


def compact_messages(messages, max_chars=60000):
    """Keeps the system message and the most recent turns verbatim; drops
    the oldest middle turns once total size exceeds max_chars."""
    if not messages:
        return messages
    system = [messages[0]] if messages[0].get("role") == "system" else []
    rest = messages[len(system):]
    total = sum(len(m.get("content", "")) for m in messages)
    if total <= max_chars:
        return messages
    kept = []
    running = sum(len(m.get("content", "")) for m in system)
    for m in reversed(rest):
        size = len(m.get("content", ""))
        if running + size > max_chars:
            break
        kept.append(m)
        running += size
    kept.reverse()
    return system + kept


class AgentLoop:
    def __init__(self, endpoint, model, tool_dispatch, on_event, mode="general"):
        self.endpoint = endpoint
        self.model = model
        self.tool_dispatch = tool_dispatch
        self.on_event = on_event
        self.mode = mode

    def _call_model(self, messages):
        chunks = []

        def handle_delta(delta):
            chunks.append(delta)
            self.on_event("delta", delta)

        def handle_fallback(reason):
            self.on_event("fallback", reason)

        return route_chat(
            messages,
            on_delta=handle_delta,
            mode=self.mode,
            on_fallback=handle_fallback,
            local_model=self.model,
            local_endpoint=self.endpoint,
        )

    def run_turn(self, messages, user_prompt):
        messages = compact_messages(messages)
        messages = messages + [{"role": "user", "content": user_prompt}]
        answer = self._call_model(messages)
        messages = messages + [{"role": "assistant", "content": answer}]

        for _ in range(MAX_TOOL_CALLS):
            raw = extract_json_object(answer)
            if not raw:
                break
            try:
                tool_call = json.loads(raw)
            except json.JSONDecodeError:
                break
            tool_name = tool_call.get("tool", "")
            fn = self.tool_dispatch.get(tool_name)
            if fn is None:
                break
            self.on_event("tool_call", tool_call)
            kwargs = {k: v for k, v in tool_call.items() if k != "tool"}
            try:
                result = fn(**kwargs)
            except Exception as e:
                result = {"ok": False, "error": str(e)}
            self.on_event("tool_result", result)
            if isinstance(result, dict) and result.get("approvalRequired"):
                messages = messages + [{"role": "user", "content": "Tool result:\n" + json.dumps(result)}]
                answer = "I need your approval before I do that: " + result.get("reason", "protected action.")
                messages = messages + [{"role": "assistant", "content": answer}]
                break
            messages = compact_messages(messages)
            messages = messages + [{
                "role": "user",
                "content": "Tool result:\n" + json.dumps(result) + "\nContinue if another tool is needed. Otherwise give a concise final answer.",
            }]
            answer = self._call_model(messages)
            messages = messages + [{"role": "assistant", "content": answer}]

        self.on_event("final", answer)
        return messages
