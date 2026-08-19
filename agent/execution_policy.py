"""Model-agnostic execution policy and tool-protocol recovery.

This module is deliberately provider-neutral.  The transport layer remains
responsible for provider wire formats; this layer decides the behavioral
contract shared by every model that runs inside the agent:

* action requests should be executed, not merely acknowledged;
* false capability/scope refusals are retried when the runtime actually has
  tools that can make progress;
* tool calls leaked into ordinary text are recovered into the canonical
  ``ToolCall`` shape;
* models/endpoints that reject native function schemas can fall back to a
  text tool protocol without changing the durable conversation transcript.

The text bridge is a compatibility fallback, not the preferred path.  Native
structured tool calling is always used when it works.
"""

from __future__ import annotations

import json
import re
import uuid
from typing import Any, Iterable

from agent.message_content import flatten_message_text
from agent.transports.types import ToolCall


_ACTION_REQUEST_RE = re.compile(
    r"(?:"
    r"^\s*(?:please\s+)?(?:run|execute|launch|start|restart|stop|open|create|generate|build|"
    r"make|write|edit|change|update|fix|repair|debug|implement|install|uninstall|configure|set up|"
    r"test|verify|deploy|convert|download|upload|move|copy|delete|remove|find|inspect|search|"
    r"check|read|scan|review|refactor|patch|commit|push|pull|browse|navigate|handle)\b|"
    r"^\s*(?:please\s+)?(?:go\s+(?:into|to)|work\s+on|take\s+care\s+of)\b|"
    r"\b(?:on|in|from|to)\s+(?:my|this|the)\s+(?:pc|computer|machine|workspace|repo|"
    r"repository|terminal|browser|project|file|folder|database|server|site|app|application)\b|"
    r"\b(?:use|using)\s+(?:the\s+)?(?:terminal|powershell|command prompt|cmd|shell|"
    r"filesystem|browser|computer|tools?|git|docker|python|node)\b"
    r")",
    re.IGNORECASE | re.DOTALL,
)

_ASSISTANT_ACTION_RE = re.compile(
    r"\b(?:inspect|scan|check|analy[sz]e|review|explore|read|open|run|execute|test|verify|"
    r"fix|repair|debug|search|find|build|create|generate|write|edit|update|change|implement|install|"
    r"uninstall|configure|set up|deploy|download|upload|move|copy|delete|remove|restart|"
    r"start|commit|push|pull|browse|navigate|look into|look at)\b",
    re.IGNORECASE,
)

_FUTURE_ACTION_RE = re.compile(
    r"\b(?:i['’]ll|i\s+will|let\s+me|i\s+can\s+do\s+that|i\s+can\s+help\s+with\s+that|"
    r"i['’]m\s+going\s+to|i\s+am\s+going\s+to|next\s+i['’]ll|first\s+i['’]ll|"
    r"i['’]ll\s+start\s+by|i\s+will\s+start\s+by)\b",
    re.IGNORECASE,
)

_WORKSPACE_RE = re.compile(
    r"(?:\bdirectory\b|\bcurrent dir(?:ectory)?\b|\bcwd\b|\brepo(?:sitory)?\b|"
    r"\bcodebase\b|\bproject\b|\bfolder\b|\bfilesystem\b|\bfile tree\b|\bfiles?\b|"
    r"\bpath\b|~/|[A-Za-z]:\\|/(?:[^\s/]+/)+)",
    re.IGNORECASE,
)

_CAPABILITY_REFUSAL_RE = re.compile(
    r"(?:"
    r"\b(?:i\s+)?(?:can(?:not|'t)|am\s+unable\s+to|do\s+not\s+have\s+the\s+ability\s+to)\s+"
    r"(?:access|open|read|write|edit|modify|run|execute|browse|control|inspect|check|"
    r"generate|create|complete|implement|build|deliver|handle|finish|do|provide)\b.{0,140}"
    r"(?:files?|filesystem|terminal|shell|computer|machine|browser|repo(?:sitory)?|project|"
    r"environment|server|site|application|task|request)?|"
    r"\b(?:the\s+)?(?:task|request|project|requirements?)\s+(?:is|are|would be)\s+"
    r"(?:too|far too)\s+(?:extensive|large|complex|broad|ambitious)\b|"
    r"\bwould require\b.{0,100}\b(?:hundreds? of hours|hours|days|weeks|months)\b|"
    r"\bfar beyond\b.{0,100}\b(?:single response|reasonably handled|this environment)\b|"
    r"\bi must stop here\b|"
    r"\bi can (?:only|instead) help with (?:portions?|parts?)\b"
    r")",
    re.IGNORECASE | re.DOTALL,
)

# Keep this intentionally narrow: the execution recovery must never try to
# bulldoze a genuine safety refusal.  It only needs to recognize common
# high-signal words because retries are additionally gated on an actionable
# environment request.
_SAFETY_REFUSAL_RE = re.compile(
    r"\b(?:malware|ransomware|credential theft|phishing|steal credentials|weapon|"
    r"self-harm|sexual content involving minors?|csam)\b",
    re.IGNORECASE,
)

_TOOL_CALL_BLOCK_RE = re.compile(
    r"<(?:tool_call|function_call)\b[^>]*>\s*(\{.*?\})\s*</(?:tool_call|function_call)>",
    re.IGNORECASE | re.DOTALL,
)
_TOOL_CALLS_BLOCK_RE = re.compile(
    r"<(?:tool_calls|function_calls)\b[^>]*>\s*(\[.*?\])\s*</(?:tool_calls|function_calls)>",
    re.IGNORECASE | re.DOTALL,
)
_QWEN_FUNCTION_RE = re.compile(
    r"(?:^|\n)[ \t]*<function=([A-Za-z_][A-Za-z0-9_]*)>[ \t]*\r?\n"
    r"((?:[ \t]*<parameter=[A-Za-z_][A-Za-z0-9_]*>[ \t]*\r?\n"
    r".*?[ \t]*</parameter>[ \t]*(?:\r?\n|$))+)",
    re.DOTALL,
)
_QWEN_PARAMETER_RE = re.compile(
    r"<parameter=([A-Za-z_][A-Za-z0-9_]*)>[ \t]*\r?\n(.*?)[ \t]*</parameter>",
    re.DOTALL,
)
_GEMMA_FUNCTION_RE = re.compile(
    r'(?:^|\n)[ \t]*<function\b[^>]*\bname\s*=\s*["\']([A-Za-z_][A-Za-z0-9_]*)["\'][^>]*>'
    r"(.*?)</function>",
    re.IGNORECASE | re.DOTALL,
)
_GEMMA_PARAMETER_RE = re.compile(
    r'<parameter\b[^>]*\bname\s*=\s*["\']([A-Za-z_][A-Za-z0-9_]*)["\'][^>]*>'
    r"(.*?)</parameter>",
    re.IGNORECASE | re.DOTALL,
)


TEXT_TOOL_PROTOCOL_HEADER = (
    "[Runtime tool compatibility mode]\n"
    "This endpoint is not accepting native function/tool schemas, but PhantomBot's local tools are still available. "
    "To call a tool, output one or more blocks in EXACTLY this form and do not merely describe the action:\n"
    '<tool_call>{"name":"TOOL_NAME","arguments":{"arg":"value"}}</tool_call>\n'
    "Use only tools listed below. Arguments must match the listed JSON schema. After execution you will receive "
    "<tool_response> blocks and should continue until the task is complete.\n"
)


def is_actionable_execution_request(content: Any) -> bool:
    """Whether *content* asks for an action the local runtime may perform."""
    text = flatten_message_text(content).strip()
    if not text or text.startswith("/"):
        return False
    return bool(_ACTION_REQUEST_RE.search(text))


def turn_has_tool_activity(agent: Any, messages: list[dict[str, Any]] | None = None) -> bool:
    """Return current-turn tool activity only, never historical session state.

    Production turns expose an explicit counter. Minimal test/plugin agents may
    not; in that case inspect only the tail after the most recent user message.
    """
    if hasattr(agent, "_turn_tool_call_count"):
        try:
            return int(getattr(agent, "_turn_tool_call_count", 0) or 0) > 0
        except Exception:
            return False
    if messages:
        last_user = -1
        for idx, msg in enumerate(messages):
            if isinstance(msg, dict) and msg.get("role") == "user":
                last_user = idx
        return any(
            isinstance(msg, dict) and msg.get("role") == "tool"
            for msg in messages[last_user + 1 :]
        )
    return False


def looks_like_intermediate_action_response(
    agent: Any,
    user_message: Any,
    assistant_content: Any,
    *,
    require_workspace: bool = False,
    messages: list[dict[str, Any]] | None = None,
) -> bool:
    """Detect a short promise/plan that incorrectly ends an actionable turn."""
    # A promise can be incomplete even after one or more tools already ran
    # (e.g. "I found the config; I'll edit it now" and then the model stops).
    # Therefore historical/current tool activity must not suppress this detector.
    assistant_text = flatten_message_text(assistant_content)
    try:
        assistant_text = agent._strip_think_blocks(assistant_text)
    except Exception:
        pass
    assistant_text = assistant_text.strip()
    if not assistant_text or len(assistant_text) > 1600:
        return False
    if not _FUTURE_ACTION_RE.search(assistant_text):
        return False
    if not _ASSISTANT_ACTION_RE.search(assistant_text):
        return False

    user_text = flatten_message_text(user_message).strip()
    if require_workspace:
        return bool(_WORKSPACE_RE.search(user_text) or _WORKSPACE_RE.search(assistant_text))

    # General mode still requires an actionable user request.  This prevents
    # conversational phrases such as "I'll help you think through that" from
    # being turned into an autonomous execution loop.
    return is_actionable_execution_request(user_text)


def is_false_capability_refusal(user_message: Any, assistant_content: Any) -> bool:
    """Detect an environment/scope excuse that conflicts with available tools."""
    if not is_actionable_execution_request(user_message):
        return False
    text = flatten_message_text(assistant_content).strip()
    if not text or _SAFETY_REFUSAL_RE.search(text):
        return False
    return bool(_CAPABILITY_REFUSAL_RE.search(text))


def build_execution_recovery_nudge(user_message: Any, *, supervisor_plan: str | None = None) -> str:
    """Small API-only continuation hint used after a no-action response."""
    base = (
        "[Runtime continuation: The current user request is not complete. Continue working now. "
        "Use the available local tools when they can perform or verify the requested action. "
        "Do not claim that filesystem, terminal, browser, or project access is unavailable when those tools are advertised. "
        "Do not narrate future work and stop; either take the next concrete action or deliver the completed, verified result.]"
    )
    if supervisor_plan:
        return base + "\n\nPrivate execution plan:\n" + str(supervisor_plan).strip()
    return base


def append_runtime_nudge(content: Any, nudge: str | None) -> Any:
    """Append an ephemeral runtime note to an API-copy message content value."""
    if not nudge:
        return content
    if isinstance(content, str):
        return content.rstrip() + "\n\n" + nudge
    if isinstance(content, list):
        copied = list(content)
        copied.append({"type": "text", "text": nudge})
        return copied
    if content is None:
        return nudge
    return str(content) + "\n\n" + nudge


def _coerce_tool_call_object(obj: Any, valid_tool_names: set[str]) -> ToolCall | None:
    if not isinstance(obj, dict):
        return None

    # Accept both the compact Hermes trajectory shape
    # {"name": ..., "arguments": {...}} and OpenAI's nested shape.
    fn = obj.get("function") if isinstance(obj.get("function"), dict) else obj
    name = fn.get("name") if isinstance(fn, dict) else None
    if not isinstance(name, str) or name.strip() not in valid_tool_names:
        return None
    name = name.strip()
    args = fn.get("arguments", {})
    if isinstance(args, str):
        # Keep a valid JSON string verbatim; for plain text values, wrap it so
        # normal tool-argument validation can produce a useful correction.
        try:
            parsed = json.loads(args)
            args_str = json.dumps(parsed, ensure_ascii=False)
        except Exception:
            args_str = args
    else:
        args_str = json.dumps(args if isinstance(args, dict) else {}, ensure_ascii=False)
    call_id = obj.get("id")
    if not isinstance(call_id, str) or not call_id.strip():
        call_id = f"call_text_{uuid.uuid4().hex[:12]}"
    return ToolCall(id=call_id, name=name, arguments=args_str)


def recover_embedded_tool_calls(message: Any, valid_tool_names: Iterable[str]) -> bool:
    """Recover text-emitted tool calls from *any* model into canonical calls.

    The parser is intentionally strict and only accepts names that were
    actually advertised by the runtime.  The normal executor still performs
    JSON/schema validation, approvals, guardrails, and dispatch.
    """
    if getattr(message, "tool_calls", None):
        return False
    content = getattr(message, "content", None)
    if not isinstance(content, str) or not content.strip():
        return False

    valid = {str(n) for n in valid_tool_names if str(n)}
    if not valid:
        return False

    recovered: list[ToolCall] = []
    spans: list[tuple[int, int]] = []

    for match in _TOOL_CALL_BLOCK_RE.finditer(content):
        try:
            obj = json.loads(match.group(1))
        except Exception:
            continue
        call = _coerce_tool_call_object(obj, valid)
        if call is None:
            continue
        recovered.append(call)
        spans.append(match.span())

    # Some OpenAI-compatible shims emit a plural wrapper containing a JSON
    # array.  Treat it exactly like multiple native calls rather than making
    # the model retry merely because the wrapper name differs.
    for match in _TOOL_CALLS_BLOCK_RE.finditer(content):
        try:
            objects = json.loads(match.group(1))
        except Exception:
            continue
        if not isinstance(objects, list):
            continue
        block_calls = [
            call
            for obj in objects
            if (call := _coerce_tool_call_object(obj, valid)) is not None
        ]
        if not block_calls:
            continue
        recovered.extend(block_calls)
        spans.append(match.span())

    # Qwen/Gemma-style function blocks used by several local/OpenAI-compatible
    # shims.  Keep this fallback separate so prose JSON is never interpreted as
    # a tool call.
    for match in _QWEN_FUNCTION_RE.finditer(content):
        name = match.group(1)
        if name not in valid:
            continue
        params: dict[str, Any] = {}
        for param in _QWEN_PARAMETER_RE.finditer(match.group(2)):
            raw = param.group(2).strip()
            try:
                params[param.group(1)] = json.loads(raw)
            except Exception:
                params[param.group(1)] = raw
        if not params:
            continue
        recovered.append(
            ToolCall(
                id=f"call_text_{uuid.uuid4().hex[:12]}",
                name=name,
                arguments=json.dumps(params, ensure_ascii=False),
            )
        )
        spans.append(match.span())

    # Gemma-style XML uses attributes instead of ``<function=name>`` and is
    # already recognized by the content scrubber elsewhere in Hermes. Recover
    # it before that scrubber can hide a perfectly usable tool request.
    for match in _GEMMA_FUNCTION_RE.finditer(content):
        name = match.group(1)
        if name not in valid:
            continue
        params: dict[str, Any] = {}
        for param in _GEMMA_PARAMETER_RE.finditer(match.group(2)):
            raw = param.group(2).strip()
            try:
                params[param.group(1)] = json.loads(raw)
            except Exception:
                params[param.group(1)] = raw
        if not params:
            continue
        recovered.append(
            ToolCall(
                id=f"call_text_{uuid.uuid4().hex[:12]}",
                name=name,
                arguments=json.dumps(params, ensure_ascii=False),
            )
        )
        spans.append(match.span())

    if not recovered:
        return False

    visible = content
    for start, end in sorted(spans, reverse=True):
        visible = visible[:start] + visible[end:]
    message.content = visible.strip()
    message.tool_calls = recovered
    try:
        message.finish_reason = "tool_calls"
    except Exception:
        pass
    return True


def _tool_specs(tools: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    specs: list[dict[str, Any]] = []
    for tool in tools or []:
        if not isinstance(tool, dict):
            continue
        fn = tool.get("function")
        if not isinstance(fn, dict):
            continue
        name = fn.get("name")
        if not isinstance(name, str) or not name.strip():
            continue
        specs.append(
            {
                "name": name.strip(),
                "description": fn.get("description", ""),
                "parameters": fn.get("parameters", {}),
            }
        )
    return specs


def text_tool_bridge_enabled(agent: Any) -> bool:
    """Whether the active request should use the text tool compatibility path."""
    mode = getattr(agent, "_text_tool_fallback", True)
    if mode is False or (isinstance(mode, str) and mode.strip().lower() in {"false", "off", "no", "never"}):
        return False
    if getattr(agent, "_force_text_tool_bridge", False):
        return True

    # Bedrock has an explicit local compatibility denylist; use it without any
    # network/model-registry lookup so startup stays fast.
    if getattr(agent, "api_mode", "") == "bedrock_converse":
        try:
            from agent.bedrock_adapter import _model_supports_tool_use
            return not _model_supports_tool_use(str(getattr(agent, "model", "") or ""))
        except Exception:
            return False
    return False


def looks_like_native_tooling_unsupported_error(error: Any) -> bool:
    """Best-effort detector for endpoints that reject native tool schemas."""
    try:
        status = getattr(error, "status_code", None)
        if status is not None and not (400 <= int(status) < 500):
            return False
    except Exception:
        pass
    text = str(getattr(error, "body", None) or getattr(error, "message", None) or error).lower()
    phrases = (
        "does not support tool calling",
        "doesn't support tool calling",
        "tool calling is not supported",
        "tool use is not supported",
        "tools are not supported",
        "tools is not supported",
        "unsupported parameter: tools",
        "unsupported parameter 'tools'",
        'unsupported parameter "tools"',
        "unknown field: tools",
        "unknown field `tools`",
        "unknown field 'tools'",
        "toolconfig is not supported",
        "tool config is not supported",
        "function calling is not supported",
        "functions are not supported",
        "no endpoints found that support tools",
    )
    return any(p in text for p in phrases)


def prepare_text_tool_bridge_messages(
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Return an API-only transcript compatible with text-only tool models.

    Structured assistant tool calls become ``<tool_call>`` text and tool-role
    results become a user ``<tool_response>`` block. Consecutive tool results
    are merged to preserve strict assistant/user alternation.  The full schema
    is appended only to the latest user-role message in this API copy.
    """
    out: list[dict[str, Any]] = []

    for original in messages:
        if not isinstance(original, dict):
            continue
        msg = {k: v for k, v in original.items() if not (isinstance(k, str) and k.startswith("_"))}
        role = msg.get("role")

        if role == "assistant" and msg.get("tool_calls"):
            pieces: list[str] = []
            visible = flatten_message_text(msg.get("content")).strip()
            if visible:
                pieces.append(visible)
            for tc in msg.get("tool_calls") or []:
                if not isinstance(tc, dict):
                    continue
                fn = tc.get("function") or {}
                if not isinstance(fn, dict):
                    continue
                args = fn.get("arguments", "{}")
                try:
                    args_obj = json.loads(args) if isinstance(args, str) else args
                except Exception:
                    args_obj = args
                payload = {
                    "id": tc.get("id"),
                    "name": fn.get("name"),
                    "arguments": args_obj if isinstance(args_obj, dict) else {},
                }
                pieces.append("<tool_call>" + json.dumps(payload, ensure_ascii=False) + "</tool_call>")
            cleaned = {"role": "assistant", "content": "\n".join(pieces).strip()}
            out.append(cleaned)
            continue

        if role == "tool":
            name = str(msg.get("name") or msg.get("tool_name") or "tool")
            call_id = str(msg.get("tool_call_id") or "")
            content = flatten_message_text(msg.get("content"))
            block = (
                f'<tool_response name="{name}" id="{call_id}">\n{content}\n</tool_response>'
            )
            if out and out[-1].get("role") == "user" and out[-1].get("_bridge_tool_result"):
                out[-1]["content"] = str(out[-1].get("content") or "") + "\n" + block
            else:
                out.append({"role": "user", "content": block, "_bridge_tool_result": True})
            continue

        # Provider-only state that makes no sense without structured tool
        # replay.  Keep content/reasoning fields otherwise intact.
        msg.pop("tool_calls", None)
        msg.pop("tool_call_id", None)
        msg.pop("tool_name", None)
        out.append(msg)

    specs = _tool_specs(tools)
    protocol = TEXT_TOOL_PROTOCOL_HEADER + json.dumps(specs, ensure_ascii=False)

    # Attach to the latest user message. If the latest user is a tool-response
    # bridge row, this also refreshes the schema after each execution step.
    for idx in range(len(out) - 1, -1, -1):
        if out[idx].get("role") == "user":
            out[idx]["content"] = append_runtime_nudge(out[idx].get("content"), protocol)
            break

    # Remove bridge bookkeeping before wire transport.
    for msg in out:
        msg.pop("_bridge_tool_result", None)
    return out
