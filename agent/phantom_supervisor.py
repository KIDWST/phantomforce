"""Phantom routing, execution-refusal recovery, and private bridge helpers.

Phantom is the only public model identity. Its profile-scoped Auto routes may
use private local services for reasoning or media while terminal/file/browser
execution remains in the local agent runtime.
"""

from __future__ import annotations

import json
import logging
import re
import urllib.error
import urllib.parse
import urllib.request
import uuid
from types import SimpleNamespace
from typing import Any, Literal

logger = logging.getLogger(__name__)

_PHANTOM_MODELS = ("phantom", "phantom-v1", "phantomcoder-k3j", "phantom 1.0")
_PHANTOM_UNLEASHED_MODELS = ("phantom-unleashed", "phantom unleashed")
_CODING_RE = re.compile(
    r"(?:```|\b(code|coding|repo|repository|file|function|class|bug|debug|fix|"
    r"implement|refactor|patch|pull request|commit|git|terminal|powershell|"
    r"python|typescript|javascript|rust|golang|compile|compiler|test|pytest|"
    r"stack trace|exception|api integration|sql|yaml|json|css|html)\b|"
    r"[A-Za-z]:\\|/[^\s]+/)",
    re.IGNORECASE,
)
_ACTION_RE = re.compile(
    r"(?:"
    r"^\s*(?:please\s+)?(?:run|execute|launch|start|open|create|generate|build|"
    r"make|write|edit|change|update|fix|repair|debug|install|configure|set up|"
    r"test|verify|deploy|convert|download|find|inspect|search)\b|"
    r"\b(?:on|in)\s+(?:my|this|the)\s+(?:pc|computer|machine|workspace|repo|"
    r"repository|terminal|browser|project|file)\b|"
    r"\b(?:use|using)\s+(?:the\s+)?(?:terminal|powershell|command prompt|"
    r"filesystem|browser|tools?)\b"
    r")",
    re.IGNORECASE,
)
_SIMPLE_VISIBLE_COMMAND_RE = re.compile(
    r"^\s*(?:please\s+)?(?:run|execute|launch|start|open)\b.{0,120}\b"
    r"(?:terminal|powershell|command prompt|cmd|matrix rain|rainbow matrix|"
    r"on my pc|pop up|visible|show me|bring up)\b",
    re.IGNORECASE | re.DOTALL,
)
_CAPABILITY_REFUSAL_RE = re.compile(
    r"(?:"
    r"\b(?:i\s+)?cannot\s+(?:generate|create|complete|implement|build|deliver|"
    r"handle|finish|do|provide)\b.{0,100}\b(?:project|request|task|requirements?|"
    r"environment|single response)\b|"
    r"\b(?:the\s+)?(?:task|request|project|requirements?)\s+(?:is|are|would be)\s+"
    r"(?:too|far too)\s+(?:extensive|large|complex|broad|ambitious)\b|"
    r"\bwould require\b.{0,80}\b(?:hundreds? of hours|hours|days|weeks|months)\b|"
    r"\bfar beyond\b.{0,80}\b(?:single response|reasonably handled|this environment)\b|"
    r"\bi must stop here\b|"
    r"\bi can (?:only|instead) help with (?:portions?|parts?)\b"
    r")",
    re.IGNORECASE | re.DOTALL,
)
_SAFETY_REFUSAL_RE = re.compile(
    r"\b(?:illegal|malware|ransomware|credential theft|phishing|weapon|"
    r"self-harm|sexual content involving minors?)\b",
    re.IGNORECASE,
)

_GREETING_RE = re.compile(
    r"^\s*(?:hi|hey|hello|hiya|howdy|yo|sup)(?:\s+(?:p(?:\s+bot)?|phantom|phantombot|bot))?[!.?]*\s*$",
    re.IGNORECASE,
)
_EXTRA_HIGH_RE = re.compile(
    r"\b(?:extra[ -]?high|xhigh|maximum reasoning|deepest|exhaustive|"
    r"comprehensive audit|patiently executed|research-grade|production-grade audit|"
    r"threat model|root cause analysis)\b",
    re.IGNORECASE,
)
_HIGH_RE = re.compile(
    r"\b(?:analy[sz]e|compare|evaluate|strategy|architecture|design|plan|audit|"
    r"investigate|diagnose|tradeoffs?|multi[- ]?step|security|privacy|migration|"
    r"performance|optimi[sz]e|complex|detailed|thorough|production[- ]?ready)\b",
    re.IGNORECASE,
)

ChatGptEffort = Literal["instant", "high", "xhigh"]
_BRIDGE_TIMEOUTS: dict[ChatGptEffort, float] = {
    "instant": 50,
    "high": 150,
    "xhigh": 300,
}

_CHATGPT_SUBSCRIPTION_ROUTE = "chatgpt.subscription"
_BRIDGE_HISTORY_MAX_MESSAGES = 18
_BRIDGE_HISTORY_MAX_CHARS = 96_000
_BRIDGE_HISTORY_ITEM_MAX_CHARS = 10_000
_BRIDGE_HISTORY_ANCHOR_MAX_CHARS = 20_000
_EMBEDDED_FUNCTION_RE = re.compile(
    r"(?:^|\n)[ \t]*<function=([A-Za-z_][A-Za-z0-9_]*)>[ \t]*\r?\n"
    r"((?:[ \t]*<parameter=[A-Za-z_][A-Za-z0-9_]*>[ \t]*\r?\n"
    r".*?[ \t]*</parameter>[ \t]*(?:\r?\n|$))+)",
    re.DOTALL,
)
_EMBEDDED_PARAMETER_RE = re.compile(
    r"<parameter=([A-Za-z_][A-Za-z0-9_]*)>[ \t]*\r?\n"
    r"(.*?)[ \t]*</parameter>",
    re.DOTALL,
)


def subscription_bridge_enabled(lane: str) -> bool:
    """Return whether the active PhantomBot profile routes ``lane`` to Plus."""
    try:
        from hermes_cli.config import load_config_readonly

        cfg = load_config_readonly() or {}
        routing = ((cfg.get("phantombot") or {}).get("autoRouting") or {})
        routes = routing.get("routes") or {}
        route = routes.get(str(lane).strip().lower()) or {}
        return route.get("option_id") == _CHATGPT_SUBSCRIPTION_ROUTE
    except Exception:
        return False


def recover_embedded_tool_calls(message: Any, valid_tool_names: set[str]) -> bool:
    """Recover Qwen-style text tool calls when an OpenAI shim misses them.

    The recovery is deliberately strict: the function name must be one of the
    runtime's advertised tools and every argument must use a complete parameter
    block. The normal tool executor still performs schema and safety checks.
    """
    if getattr(message, "tool_calls", None):
        return False
    content = getattr(message, "content", None)
    if not isinstance(content, str) or "<function=" not in content:
        return False

    recovered = []
    spans = []
    for match in _EMBEDDED_FUNCTION_RE.finditer(content):
        name = match.group(1)
        if name not in valid_tool_names:
            continue
        params = {
            param.group(1): param.group(2).strip()
            for param in _EMBEDDED_PARAMETER_RE.finditer(match.group(2))
        }
        if not params:
            continue
        recovered.append(
            SimpleNamespace(
                id=f"call_phantom_{uuid.uuid4().hex[:12]}",
                type="function",
                function=SimpleNamespace(
                    name=name,
                    arguments=json.dumps(params, ensure_ascii=False),
                ),
            )
        )
        spans.append(match.span())

    if not recovered:
        return False

    visible = content
    for start, end in reversed(spans):
        visible = visible[:start] + visible[end:]
    message.content = visible.strip()
    message.tool_calls = recovered
    return True


def is_phantom_model(model: Any) -> bool:
    value = str(model or "").strip().lower()
    if is_phantom_unleashed_model(value):
        return False
    return any(marker in value for marker in _PHANTOM_MODELS)


def is_phantom_unleashed_model(model: Any) -> bool:
    value = str(model or "").strip().lower()
    return any(marker in value for marker in _PHANTOM_UNLEASHED_MODELS)


def is_phantom_family_model(model: Any) -> bool:
    return is_phantom_model(model) or is_phantom_unleashed_model(model)


def instant_phantom_reply(model: Any, text: str) -> str | None:
    """Answer social pings without paying any model or browser latency."""
    if not is_phantom_model(model) or not _GREETING_RE.fullmatch(str(text or "")):
        return None
    return "Yo — Phantom here. What are we building?"


def classify_chatgpt_effort(text: str) -> ChatGptEffort:
    """Choose the cheapest useful ChatGPT depth from prompt shape and intent."""
    clean = str(text or "").strip()
    words = re.findall(r"\b[\w'-]+\b", clean)
    line_count = sum(1 for line in clean.splitlines() if line.strip())
    constraint_count = len(re.findall(r"(?:^|\n)\s*(?:[-*]|\d+[.)])\s+", clean))

    if (
        _EXTRA_HIGH_RE.search(clean)
        or len(words) >= 220
        or constraint_count >= 6
        or (len(words) >= 120 and line_count >= 8)
    ):
        return "xhigh"
    if (
        _HIGH_RE.search(clean)
        or len(words) >= 55
        or constraint_count >= 3
        or clean.count("?") >= 3
    ):
        return "high"
    return "instant"


def execution_chatgpt_effort(text: str) -> ChatGptEffort:
    """Planning never uses the shallow lane, even for a short execution ask."""
    effort = classify_chatgpt_effort(text)
    return "high" if effort == "instant" else effort


def phantom_lane_status(effort: ChatGptEffort | str, *, direct: bool = False) -> str:
    """Return a stable, public route label suitable for every live UI."""
    if direct:
        return "Phantom lane · Direct"
    labels = {"instant": "Instant", "high": "Focus", "xhigh": "Deep"}
    return f"Phantom lane · {labels.get(str(effort).strip().lower(), 'Focus')}"


def should_supervise(model: Any, text: str, *, enabled: bool = False) -> bool:
    """Return whether an explicitly enabled paid bridge may answer this turn."""
    if not enabled or not is_phantom_model(model):
        return False
    clean = str(text or "").strip()
    if len(clean) < 3 or clean.startswith("/"):
        return False
    if _CODING_RE.search(clean) or _ACTION_RE.search(clean):
        return False
    return True


def should_plan_execution(model: Any, text: str, *, enabled: bool = True) -> bool:
    """Return whether Phantom should receive deterministic execution guidance."""
    if not enabled or not is_phantom_model(model):
        return False
    clean = str(text or "").strip()
    if len(clean) < 3 or clean.startswith("/"):
        return False
    return bool(_CODING_RE.search(clean) or _ACTION_RE.search(clean))


def fast_execution_plan(text: str) -> str | None:
    """Return a deterministic brief for obvious visible command requests.

    These should skip the ChatGPT bridge so the local executor starts working
    immediately instead of over-planning a one-command task.
    """
    clean = str(text or "").strip()
    if not clean or not _SIMPLE_VISIBLE_COMMAND_RE.search(clean):
        return None
    return (
        "1. Treat this as a direct local Windows command request, not a repository task.\n"
        "2. Do not search the workspace or inspect unrelated files.\n"
        "3. Use terminal(command=..., visible=true) so a real Windows terminal appears.\n"
        "4. For matrix rain, launch a short PowerShell or Python console animation in that visible terminal.\n"
        "5. Verify the command started or report the exact terminal error."
    )


def is_capability_refusal(text: str) -> bool:
    """Detect scope/environment excuses without overriding safety refusals."""
    clean = str(text or "").strip()
    if not clean or _SAFETY_REFUSAL_RE.search(clean):
        return False
    return bool(_CAPABILITY_REFUSAL_RE.search(clean))


def _bridge_url() -> str:
    try:
        from hermes_cli.config import load_config_readonly

        cfg = load_config_readonly() or {}
        provider = (cfg.get("providers") or {}).get("chatgpt-plus") or {}
        base_url = str(provider.get("base_url") or "http://127.0.0.1:8792/v1")
    except Exception:
        base_url = "http://127.0.0.1:8792/v1"
    # This feature must never silently become an external API route.
    host = urllib.parse.urlsplit(base_url).hostname
    if host not in {"127.0.0.1", "localhost", "::1"}:
        return ""
    return base_url.rstrip("/") + "/chat/completions"


def _clip_bridge_history_content(content: str, limit: int) -> str:
    clean = str(content or "").strip()
    if limit <= 64:
        return clean[: max(0, limit)]
    if len(clean) <= limit:
        return clean
    head = max(1, int(limit * 0.72))
    tail = max(1, limit - head - 30)
    return f"{clean[:head]}\n[...context clipped...]\n{clean[-tail:]}"


def _safe_history(history: list[dict[str, Any]] | None) -> list[dict[str, str]]:
    """Keep the original request and a bounded recent bridge transcript."""
    cleaned: list[dict[str, str]] = []
    for item in history or []:
        if not isinstance(item, dict) or item.get("role") not in {"user", "assistant"}:
            continue
        content = item.get("content")
        if not isinstance(content, str) or not content.strip():
            continue
        cleaned.append({"role": str(item["role"]), "content": content.strip()})

    if not cleaned:
        return []

    first_user = next(
        (item for item in cleaned if item["role"] == "user"),
        None,
    )
    tail = cleaned[-_BRIDGE_HISTORY_MAX_MESSAGES:]
    anchor_is_separate = first_user is not None and not any(
        item is first_user for item in tail
    )
    result: list[dict[str, str]] = []
    remaining = _BRIDGE_HISTORY_MAX_CHARS

    if anchor_is_separate and first_user is not None:
        content = _clip_bridge_history_content(
            first_user["content"],
            min(_BRIDGE_HISTORY_ANCHOR_MAX_CHARS, remaining),
        )
        result.append({"role": "user", "content": content})
        remaining -= len(content)

    recent_reversed: list[dict[str, str]] = []
    for item in reversed(tail):
        if remaining <= 0:
            break
        content = _clip_bridge_history_content(
            item["content"], min(_BRIDGE_HISTORY_ITEM_MAX_CHARS, remaining)
        )
        recent_reversed.append({"role": item["role"], "content": content})
        remaining -= len(content)

    result.extend(reversed(recent_reversed))
    return result


def _bridge_is_available() -> bool:
    url = _bridge_url()
    if not url:
        return False
    health_url = url.rsplit("/v1/chat/completions", 1)[0] + "/health"
    try:
        with urllib.request.urlopen(health_url, timeout=1.5) as response:
            body = json.loads(response.read().decode("utf-8"))
        return bool(body.get("ok"))
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return False


def _ask_bridge_with_system(
    text: str,
    history: list[dict[str, Any]] | None,
    *,
    system: str,
    max_tokens: int,
    effort: ChatGptEffort,
) -> str | None:
    url = _bridge_url()
    if not url:
        logger.warning("Phantom supervisor disabled: ChatGPT bridge is not local")
        return None
    if not _bridge_is_available():
        logger.info("Phantom supervisor bridge is not healthy; using local model")
        return None
    messages: list[dict[str, str]] = [
        {"role": "system", "content": system},
        *_safe_history(history),
        {"role": "user", "content": str(text)},
    ]
    payload = json.dumps(
        {
            "model": "chatgpt-plus",
            "messages": messages,
            "stream": False,
            "max_tokens": max_tokens,
            "reasoning_effort": effort,
            "effort": effort,
        },
        ensure_ascii=False,
    ).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=_BRIDGE_TIMEOUTS[effort]) as response:
            body = json.loads(response.read().decode("utf-8"))
        content = ((body.get("choices") or [{}])[0].get("message") or {}).get("content")
        return str(content).strip() if content else None
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, KeyError) as exc:
        logger.info("Phantom supervisor bridge unavailable; using local model: %s", exc)
        return None


def ask_bridge(
    text: str,
    history: list[dict[str, Any]] | None = None,
    *,
    allow_paid_bridge: bool = False,
    effort: ChatGptEffort | None = None,
) -> str | None:
    """Ask ChatGPT only after an explicit per-call opt-in."""
    if not allow_paid_bridge:
        return None
    effort = effort or classify_chatgpt_effort(text)
    return _ask_bridge_with_system(
        text,
        history,
        system=(
            "You are PhantomForce's general-knowledge supervisor. Answer the "
            "user directly and naturally. Use current information when the "
            "question asks for it. Do not mention routing, delegation, the "
            "browser, or internal model names. Be concise but useful."
        ),
        max_tokens=4096,
        effort=effort,
    )


def ask_execution_plan(
    text: str,
    refusal: str = "",
    history: list[dict[str, Any]] | None = None,
    *,
    allow_paid_bridge: bool = False,
    effort: ChatGptEffort | None = None,
) -> str | None:
    """Return a paid planning brief only after an explicit per-call opt-in."""
    if not allow_paid_bridge:
        return None
    prompt_parts = ["USER REQUEST:", str(text).strip()]
    if str(refusal).strip():
        prompt_parts.extend(
            [
                "",
                "LOCAL EXECUTOR RESPONSE THAT MUST BE CORRECTED:",
                str(refusal).strip()[:8000],
            ]
        )
    prompt = "\n".join(prompt_parts)
    effort = effort or execution_chatgpt_effort(text)
    return _ask_bridge_with_system(
        prompt,
        history,
        system=(
            "You are the planning supervisor for Phantom's local Windows tool "
            "executor. Return a compact private execution brief, not a user-facing "
            "answer and not hidden chain-of-thought. Choose the shortest reliable "
            "path. Use at most 8 numbered steps. Name the exact tool category and "
            "PowerShell command or file operation when known. For simple requests, "
            "use one direct command instead of searching repositories or inspecting "
            "framework internals. When the user asks to run a command that should "
            "pop up or be visible on their PC, explicitly instruct the local executor "
            "to call terminal(command=..., visible=true). State one concrete success check and a bounded "
            "fallback. Never claim anything ran, never expose credentials, and do "
            "not suggest paid APIs. Assume execution happens locally on Windows."
        ),
        max_tokens=1200,
        effort=effort,
    )


def format_execution_brief(user_text: str, supervisor_plan: str) -> str:
    """Wrap an optional plan as private per-turn executor context."""
    return (
        "PRIVATE PHANTOM EXECUTION BRIEF\n"
        "Do not quote or mention this private planning context to the user. "
        "Execute it with the available "
        "local tools. Prefer the direct path, do not perform broad exploratory "
        "searches unless a named prerequisite is missing, stop retrying the same "
        "failed approach, and verify the result before reporting success. If the "
        "user wants a command to appear on their PC, use terminal(..., visible=true) "
        "so Phantom opens a real Windows terminal window.\n\n"
        f"Original user goal:\n{str(user_text).strip()}\n\n"
        f"Execution brief:\n{str(supervisor_plan).strip()[:12000]}"
    )


def build_execution_recovery_nudge(
    user_text: str,
    *,
    supervisor_plan: str | None = None,
) -> str:
    """Build the ephemeral retry instruction used by the conversation loop."""
    plan = (
        f"\n\nSupervisor execution guidance:\n{supervisor_plan.strip()}"
        if supervisor_plan and supervisor_plan.strip()
        else ""
    )
    return (
        "Your previous response was a scope/capability refusal and is not an "
        "acceptable completion. Do not estimate hours or days, stop at a plan, "
        "or claim the environment lacks capabilities without first testing them. "
        "Resume the original request now: inspect the real environment, use the "
        "available tools, implement the highest-value complete result, run focused "
        "validation, and continue through recoverable failures. If the entire "
        "scope cannot be completed, finish the largest working end-to-end slice "
        "and report only concrete completed work and verified blockers.\n\n"
        f"Original request:\n{str(user_text).strip()}"
        f"{plan}"
    )


__all__ = [
    "ask_bridge",
    "ask_execution_plan",
    "build_execution_recovery_nudge",
    "classify_chatgpt_effort",
    "execution_chatgpt_effort",
    "format_execution_brief",
    "fast_execution_plan",
    "is_capability_refusal",
    "is_phantom_model",
    "instant_phantom_reply",
    "phantom_lane_status",
    "recover_embedded_tool_calls",
    "subscription_bridge_enabled",
    "should_plan_execution",
    "should_supervise",
]
