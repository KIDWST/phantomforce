# PhantomPT Router Service — Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the PhantomPT router service — a local Python process, ported from the existing `phantombot-engine` prototype into the Termina repo — that actually performs cloud-preferred, local-guaranteed chat routing end to end, with two distinct model slots (general "PhantomPT" and paywall-deferred "Unleashed").

**Architecture:** Port the five proven engine modules (`guardrails.py`, `tools.py`, `ollama_client.py`, `agent_loop.py`, `ws_server.py`) and their 59 passing tests into `Termina/phantombot-engine/` unchanged first, to prove the port itself introduces no regressions. Then add two new modules — `cloud_client.py` (OpenAI-compatible streaming client) and `router.py` (the fallback policy) — and wire `AgentLoop` to call the router instead of calling `ollama_client.stream_chat` directly.

**Tech Stack:** Python 3, `websockets>=12.0`, `pytest`, stdlib `urllib.request` for HTTP (matches the existing engine's zero-extra-deps style).

## Global Constraints

- Fallback direction is cloud-preferred, local-guaranteed: try cloud first if configured, fall back to local on any failure, never hard-fail. (Spec: 2026-07-19-phantombot-merger-design.md)
- Two distinct model slots: general "PhantomPT" (no uncensored requirement) vs. "Unleashed" (must validate against `UNLEASHED_MARKERS`). This phase does NOT build the license-key gate or model-picker UI — those are Phase 2. This phase only needs the routing to correctly support both slots so Phase 2 can gate them.
- Existing 59 engine tests must stay green through the port — this is the regression floor.
- No placeholders, no `TODO` — every step below is real, runnable code.

---

### Task 1: Port the engine into Termina as `phantombot-engine/`

**Files:**
- Create: `C:\Users\jorda\Termina\phantombot-engine\__init__.py`
- Create: `C:\Users\jorda\Termina\phantombot-engine\requirements.txt`
- Create: `C:\Users\jorda\Termina\phantombot-engine\guardrails.py` (copy of source, unchanged)
- Create: `C:\Users\jorda\Termina\phantombot-engine\tools.py` (copy of source, unchanged)
- Create: `C:\Users\jorda\Termina\phantombot-engine\ollama_client.py` (copy of source — modified in Task 2)
- Create: `C:\Users\jorda\Termina\phantombot-engine\agent_loop.py` (copy of source — modified in Task 5)
- Create: `C:\Users\jorda\Termina\phantombot-engine\ws_server.py` (copy of source, unchanged)
- Create: `C:\Users\jorda\Termina\phantombot-engine\__main__.py` (copy of source — modified in Task 5)
- Create: `C:\Users\jorda\Termina\phantombot-engine\tests\__init__.py`
- Create: `C:\Users\jorda\Termina\phantombot-engine\tests\test_guardrails.py` (copy of source, unchanged)
- Create: `C:\Users\jorda\Termina\phantombot-engine\tests\test_tools.py` (copy of source, unchanged)
- Create: `C:\Users\jorda\Termina\phantombot-engine\tests\test_ollama_client.py` (copy of source, unchanged)
- Create: `C:\Users\jorda\Termina\phantombot-engine\tests\test_agent_loop.py` (copy of source, unchanged)
- Create: `C:\Users\jorda\Termina\phantombot-engine\tests\test_ws_server.py` (copy of source, unchanged)
- Create: `C:\Users\jorda\Termina\phantombot-engine\tests\test_main.py` (copy of source, unchanged)

Source directory to copy from: `C:\Users\jorda\Documents\Codex\2026-06-20\role-you-are-codex-the-primary\work\Phantombot-Unleashed\.claude\worktrees\phantombot-2-0\phantombot-engine\`

**Interfaces:**
- Produces: `ollama_client.stream_chat(endpoint, model, messages, on_delta, temperature=0.35, max_tokens=4096, timeout=300, num_ctx=8192)` → `str`; `ollama_client.MODEL` (str, `"huihui-qwen3.6-35b-uncensored:q3"`); `ollama_client.default_endpoint()` → `str`; `ollama_client.validate_unleashed(model)`; `agent_loop.AgentLoop(endpoint, model, tool_dispatch, on_event)` with `.run_turn(messages, user_prompt)` → `list[dict]`; `agent_loop.compact_messages(messages, max_chars=60000)` → `list[dict]`.

- [ ] **Step 1: Copy the five source modules and their tests verbatim**

```bash
mkdir -p "C:/Users/jorda/Termina/phantombot-engine/tests"
SRC="C:/Users/jorda/Documents/Codex/2026-06-20/role-you-are-codex-the-primary/work/Phantombot-Unleashed/.claude/worktrees/phantombot-2-0/phantombot-engine"
DST="C:/Users/jorda/Termina/phantombot-engine"
cp "$SRC/__init__.py" "$DST/__init__.py"
cp "$SRC/guardrails.py" "$DST/guardrails.py"
cp "$SRC/tools.py" "$DST/tools.py"
cp "$SRC/ollama_client.py" "$DST/ollama_client.py"
cp "$SRC/agent_loop.py" "$DST/agent_loop.py"
cp "$SRC/ws_server.py" "$DST/ws_server.py"
cp "$SRC/__main__.py" "$DST/__main__.py"
cp "$SRC/tests/__init__.py" "$DST/tests/__init__.py"
cp "$SRC/tests/test_guardrails.py" "$DST/tests/test_guardrails.py"
cp "$SRC/tests/test_tools.py" "$DST/tests/test_tools.py"
cp "$SRC/tests/test_ollama_client.py" "$DST/tests/test_ollama_client.py"
cp "$SRC/tests/test_agent_loop.py" "$DST/tests/test_agent_loop.py"
cp "$SRC/tests/test_ws_server.py" "$DST/tests/test_ws_server.py"
cp "$SRC/tests/test_main.py" "$DST/tests/test_main.py"
```

- [ ] **Step 2: Write `requirements.txt`**

```text
websockets>=12.0
pytest>=8.0
pytest-asyncio>=0.24
```

- [ ] **Step 3: Run the ported test suite to confirm zero regressions from the copy**

Run: `cd "C:/Users/jorda/Termina/phantombot-engine" && python -m pytest tests/ -v`
Expected: `59 passed` (same count as the source project — if any test fails here, the copy introduced a path/import problem, stop and fix before continuing; do not proceed to Task 2 with a red suite).

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/jorda/Termina"
git add phantombot-engine/
git commit -m "feat(phantombot-engine): port engine modules and tests from Unleashed 2.0 prototype"
```

---

### Task 2: Add a general (non-uncensored) mode to `ollama_client.stream_chat`

The current `stream_chat` unconditionally calls `validate_unleashed(model)`, which raises for any model without an uncensored marker. The router needs to call a *general* local model (the free "PhantomPT" slot) that is explicitly NOT required to be uncensored, while Unleashed-mode calls keep the existing validation. Add an opt-out flag, defaulting to today's behavior so all 4 existing `ollama_client` tests stay green unmodified.

**Files:**
- Modify: `C:\Users\jorda\Termina\phantombot-engine\ollama_client.py`
- Test: `C:\Users\jorda\Termina\phantombot-engine\tests\test_ollama_client.py`

**Interfaces:**
- Consumes: nothing new from other tasks.
- Produces: `ollama_client.stream_chat(endpoint, model, messages, on_delta, temperature=0.35, max_tokens=4096, timeout=300, num_ctx=8192, require_unleashed=True)` — new keyword-only-by-convention param `require_unleashed`, default `True` (unchanged behavior). `router.py` (Task 4) will call this with `require_unleashed=False` for the general PhantomPT slot.

- [ ] **Step 1: Write the failing test**

Add to `C:\Users\jorda\Termina\phantombot-engine\tests\test_ollama_client.py`:

```python
def test_stream_chat_allows_non_uncensored_model_when_require_unleashed_false():
    sse_lines = [
        b'data: {"choices":[{"delta":{"content":"hi"}}]}\n',
        b'data: [DONE]\n',
    ]
    with patch("urllib.request.urlopen", return_value=_FakeResponse(sse_lines)):
        result = ollama_client.stream_chat(
            "http://127.0.0.1:11434/v1",
            "llama3.1:8b",
            [{"role": "user", "content": "hi"}],
            on_delta=lambda d: None,
            require_unleashed=False,
        )
    assert result == "hi"


def test_stream_chat_still_validates_unleashed_by_default():
    with pytest.raises(RuntimeError):
        ollama_client.stream_chat(
            "http://127.0.0.1:11434/v1",
            "llama3.1:8b",
            [{"role": "user", "content": "hi"}],
            on_delta=lambda d: None,
        )
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd "C:/Users/jorda/Termina/phantombot-engine" && python -m pytest tests/test_ollama_client.py -v`
Expected: `test_stream_chat_allows_non_uncensored_model_when_require_unleashed_false` FAILS with `RuntimeError: Blocked: PhantomBot only allows unleashed/uncensored models, got 'llama3.1:8b'.` (the second new test passes already, since it matches current behavior).

- [ ] **Step 3: Implement**

In `C:\Users\jorda\Termina\phantombot-engine\ollama_client.py`, replace the `stream_chat` signature line and its first body line:

```python
def stream_chat(endpoint, model, messages, on_delta, temperature=0.35, max_tokens=4096, timeout=300, num_ctx=8192, require_unleashed=True):
    """Streams a chat completion. Calls on_delta(text_chunk) for each token
    chunk as it arrives and returns the full accumulated response text.
    num_ctx defaults to 8192 (down from the model's max 32768) to leave more
    VRAM headroom for GPU-resident weight layers on a 12GB card.
    require_unleashed=False lets the general PhantomPT model slot (not
    required to be uncensored) use this same client; Unleashed-mode callers
    must leave it at the default True."""
    if require_unleashed:
        validate_unleashed(model)
```

(Everything after that line is unchanged.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd "C:/Users/jorda/Termina/phantombot-engine" && python -m pytest tests/test_ollama_client.py -v`
Expected: `7 passed` (5 pre-existing tests in this file + 2 new ones)

- [ ] **Step 5: Commit**

```bash
git add phantombot-engine/ollama_client.py phantombot-engine/tests/test_ollama_client.py
git commit -m "feat(phantombot-engine): add require_unleashed opt-out for the general PhantomPT model slot"
```

---

### Task 3: Build `cloud_client.py` — OpenAI-compatible streaming client

**Files:**
- Create: `C:\Users\jorda\Termina\phantombot-engine\cloud_client.py`
- Test: `C:\Users\jorda\Termina\phantombot-engine\tests\test_cloud_client.py`

**Interfaces:**
- Consumes: nothing from other tasks (stdlib only, matches `ollama_client.py`'s zero-extra-deps style).
- Produces: `cloud_client.is_configured() -> bool`; `cloud_client.stream_chat(messages, on_delta, model=None, endpoint="https://api.openai.com/v1/chat/completions", temperature=0.35, max_tokens=4096, timeout=60) -> str`; `cloud_client.DEFAULT_MODEL` (str). Raises `RuntimeError` if no API key is configured. `router.py` (Task 4) calls `is_configured()` before calling `stream_chat`.

- [ ] **Step 1: Write the failing tests**

Create `C:\Users\jorda\Termina\phantombot-engine\tests\test_cloud_client.py`:

```python
import json
import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import cloud_client  # noqa: E402


class _FakeResponse:
    def __init__(self, lines):
        self._lines = lines

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def __iter__(self):
        return iter(self._lines)


def test_is_configured_false_without_api_key(monkeypatch):
    monkeypatch.delenv("PHANTOMBOT_CLOUD_API_KEY", raising=False)
    assert cloud_client.is_configured() is False


def test_is_configured_true_with_api_key(monkeypatch):
    monkeypatch.setenv("PHANTOMBOT_CLOUD_API_KEY", "sk-test-123")
    assert cloud_client.is_configured() is True


def test_stream_chat_raises_without_api_key(monkeypatch):
    monkeypatch.delenv("PHANTOMBOT_CLOUD_API_KEY", raising=False)
    try:
        cloud_client.stream_chat([{"role": "user", "content": "hi"}], on_delta=lambda d: None)
        assert False, "expected RuntimeError"
    except RuntimeError as e:
        assert "API key" in str(e)


def test_stream_chat_accumulates_deltas_and_sends_bearer_token(monkeypatch):
    monkeypatch.setenv("PHANTOMBOT_CLOUD_API_KEY", "sk-test-123")
    sse_lines = [
        b'data: {"choices":[{"delta":{"content":"Hel"}}]}\n',
        b'data: {"choices":[{"delta":{"content":"lo"}}]}\n',
        b'data: [DONE]\n',
    ]
    captured = {}

    class _Req:
        def __init__(self, url, data=None, headers=None, method=None):
            captured["url"] = url
            captured["headers"] = headers
            captured["body"] = json.loads(data.decode())

    deltas = []
    with patch("urllib.request.Request", side_effect=_Req), \
         patch("urllib.request.urlopen", return_value=_FakeResponse(sse_lines)):
        result = cloud_client.stream_chat(
            [{"role": "user", "content": "hi"}],
            on_delta=lambda d: deltas.append(d),
        )
    assert result == "Hello"
    assert deltas == ["Hel", "lo"]
    assert captured["headers"]["Authorization"] == "Bearer sk-test-123"
    assert captured["body"]["stream"] is True


def test_stream_chat_skips_non_dict_json_lines_without_crashing(monkeypatch):
    monkeypatch.setenv("PHANTOMBOT_CLOUD_API_KEY", "sk-test-123")
    sse_lines = [
        b'data: null\n',
        b'data: []\n',
        b'data: {"choices":[{"delta":{"content":"ok"}}]}\n',
        b'data: [DONE]\n',
    ]
    with patch("urllib.request.urlopen", return_value=_FakeResponse(sse_lines)):
        result = cloud_client.stream_chat([{"role": "user", "content": "hi"}], on_delta=lambda d: None)
    assert result == "ok"
```

- [ ] **Step 2: Run to verify all fail (module doesn't exist yet)**

Run: `cd "C:/Users/jorda/Termina/phantombot-engine" && python -m pytest tests/test_cloud_client.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'cloud_client'`

- [ ] **Step 3: Implement `cloud_client.py`**

```python
import json
import os
import urllib.request

DEFAULT_MODEL = "gpt-4o-mini"
DEFAULT_ENDPOINT = "https://api.openai.com/v1/chat/completions"


def is_configured():
    return bool(os.environ.get("PHANTOMBOT_CLOUD_API_KEY", ""))


def stream_chat(messages, on_delta, model=None, endpoint=DEFAULT_ENDPOINT, temperature=0.35, max_tokens=4096, timeout=60):
    """Streams a chat completion from an OpenAI-compatible cloud endpoint.
    Calls on_delta(text_chunk) for each token chunk as it arrives and
    returns the full accumulated response text. Raises RuntimeError if no
    PHANTOMBOT_CLOUD_API_KEY is configured — callers (router.py) should
    check is_configured() first, or catch this and fall back to local."""
    key = os.environ.get("PHANTOMBOT_CLOUD_API_KEY", "")
    if not key:
        raise RuntimeError("No cloud API key configured (PHANTOMBOT_CLOUD_API_KEY).")
    body = {
        "model": model or DEFAULT_MODEL,
        "messages": messages,
        "stream": True,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    req = urllib.request.Request(
        endpoint,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
        method="POST",
    )
    full_text = []
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        for raw_line in resp:
            line = raw_line.decode("utf-8", errors="replace").strip()
            if not line or not line.startswith("data:"):
                continue
            payload = line[len("data:"):].strip()
            if payload == "[DONE]":
                break
            try:
                chunk = json.loads(payload)
            except json.JSONDecodeError:
                continue
            if not isinstance(chunk, dict):
                continue
            choices = chunk.get("choices") or []
            if not choices:
                continue
            delta = (choices[0].get("delta") or {}).get("content", "")
            if delta:
                full_text.append(delta)
                on_delta(delta)
    return "".join(full_text)
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd "C:/Users/jorda/Termina/phantombot-engine" && python -m pytest tests/test_cloud_client.py -v`
Expected: `5 passed`

- [ ] **Step 5: Commit**

```bash
git add phantombot-engine/cloud_client.py phantombot-engine/tests/test_cloud_client.py
git commit -m "feat(phantombot-engine): add OpenAI-compatible cloud_client for the router's cloud leg"
```

---

### Task 4: Build `router.py` — cloud-preferred, local-guaranteed fallback policy

**Files:**
- Create: `C:\Users\jorda\Termina\phantombot-engine\router.py`
- Test: `C:\Users\jorda\Termina\phantombot-engine\tests\test_router.py`

**Interfaces:**
- Consumes: `cloud_client.is_configured()`, `cloud_client.stream_chat(messages, on_delta, model=None, ...)` (Task 3); `ollama_client.stream_chat(endpoint, model, messages, on_delta, ..., require_unleashed=True)`, `ollama_client.default_endpoint()`, `ollama_client.MODEL` (Task 2 / Task 1).
- Produces: `router.route_chat(messages, on_delta, mode="general", on_fallback=None, cloud_model=None, local_model=None, local_endpoint=None) -> str`. `mode` is `"general"` (PhantomPT slot, local fallback does NOT require an uncensored model) or `"unleashed"` (local fallback must be an uncensored model). `on_fallback(reason: str)` is called, if provided, whenever the local path is used instead of cloud — this is how a UI shows a status indicator instead of an error. Task 5 wires `AgentLoop` to call this instead of `ollama_client.stream_chat` directly.

- [ ] **Step 1: Write the failing tests**

Create `C:\Users\jorda\Termina\phantombot-engine\tests\test_router.py`:

```python
import os
import sys
from unittest.mock import patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import router  # noqa: E402


def test_route_chat_uses_cloud_when_configured(monkeypatch):
    monkeypatch.setenv("PHANTOMBOT_CLOUD_API_KEY", "sk-test-123")
    fallback_calls = []
    with patch("cloud_client.stream_chat", return_value="cloud answer") as mock_cloud, \
         patch("ollama_client.stream_chat") as mock_local:
        result = router.route_chat(
            [{"role": "user", "content": "hi"}],
            on_delta=lambda d: None,
            on_fallback=lambda reason: fallback_calls.append(reason),
        )
    assert result == "cloud answer"
    mock_cloud.assert_called_once()
    mock_local.assert_not_called()
    assert fallback_calls == []


def test_route_chat_falls_back_to_local_when_cloud_not_configured(monkeypatch):
    monkeypatch.delenv("PHANTOMBOT_CLOUD_API_KEY", raising=False)
    fallback_calls = []
    with patch("ollama_client.stream_chat", return_value="local answer") as mock_local:
        result = router.route_chat(
            [{"role": "user", "content": "hi"}],
            on_delta=lambda d: None,
            on_fallback=lambda reason: fallback_calls.append(reason),
        )
    assert result == "local answer"
    mock_local.assert_called_once()
    assert fallback_calls == ["no cloud provider configured"]
    # general mode must not require an uncensored model
    _, kwargs = mock_local.call_args
    assert kwargs.get("require_unleashed") is False


def test_route_chat_falls_back_to_local_when_cloud_call_fails(monkeypatch):
    monkeypatch.setenv("PHANTOMBOT_CLOUD_API_KEY", "sk-test-123")
    fallback_calls = []
    with patch("cloud_client.stream_chat", side_effect=RuntimeError("rate limited")), \
         patch("ollama_client.stream_chat", return_value="local answer") as mock_local:
        result = router.route_chat(
            [{"role": "user", "content": "hi"}],
            on_delta=lambda d: None,
            on_fallback=lambda reason: fallback_calls.append(reason),
        )
    assert result == "local answer"
    mock_local.assert_called_once()
    assert fallback_calls == ["rate limited"]


def test_route_chat_unleashed_mode_requires_uncensored_local_model(monkeypatch):
    monkeypatch.delenv("PHANTOMBOT_CLOUD_API_KEY", raising=False)
    with patch("ollama_client.stream_chat", return_value="local answer") as mock_local:
        router.route_chat(
            [{"role": "user", "content": "hi"}],
            on_delta=lambda d: None,
            mode="unleashed",
        )
    _, kwargs = mock_local.call_args
    assert kwargs.get("require_unleashed") is True


def test_route_chat_never_raises_when_both_cloud_and_local_are_tried(monkeypatch):
    # Cloud fails, and this call proves local is always attempted as the
    # unconditional last resort — the "never ever fallout" requirement.
    monkeypatch.setenv("PHANTOMBOT_CLOUD_API_KEY", "sk-test-123")
    with patch("cloud_client.stream_chat", side_effect=RuntimeError("network down")), \
         patch("ollama_client.stream_chat", return_value="local answer") as mock_local:
        result = router.route_chat([{"role": "user", "content": "hi"}], on_delta=lambda d: None)
    assert result == "local answer"
    assert mock_local.call_count == 1
```

- [ ] **Step 2: Run to verify all fail**

Run: `cd "C:/Users/jorda/Termina/phantombot-engine" && python -m pytest tests/test_router.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'router'`

- [ ] **Step 3: Implement `router.py`**

```python
import cloud_client
import ollama_client


def route_chat(messages, on_delta, mode="general", on_fallback=None, cloud_model=None, local_model=None, local_endpoint=None):
    """Cloud-preferred, local-guaranteed chat routing. Tries the configured
    cloud provider first; on ANY failure (no key, network error, HTTP
    error, timeout, rate limit) falls back to the local Ollama-backed
    model so the caller never hard-fails for lack of a subscription.

    mode="general" routes to the free PhantomPT local slot (no uncensored
    requirement). mode="unleashed" routes to the paywalled Unleashed local
    slot and requires an uncensored-marked model.

    on_fallback(reason: str), if provided, is called whenever the local
    path is taken instead of cloud, so a UI can show a status indicator
    without treating it as an error.
    """
    if cloud_client.is_configured():
        try:
            return cloud_client.stream_chat(messages, on_delta, model=cloud_model)
        except Exception as exc:
            if on_fallback:
                on_fallback(str(exc))
    elif on_fallback:
        on_fallback("no cloud provider configured")

    endpoint = local_endpoint or ollama_client.default_endpoint()
    require_unleashed = mode == "unleashed"
    model = local_model or (ollama_client.MODEL if require_unleashed else (local_model or _default_general_model()))
    return ollama_client.stream_chat(
        endpoint,
        model,
        messages,
        on_delta,
        require_unleashed=require_unleashed,
    )


def _default_general_model():
    import os
    return os.environ.get("PHANTOMPT_MODEL", "llama3.1:8b")
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd "C:/Users/jorda/Termina/phantombot-engine" && python -m pytest tests/test_router.py -v`
Expected: `5 passed`

- [ ] **Step 5: Run the full suite to confirm no cross-module regressions**

Run: `cd "C:/Users/jorda/Termina/phantombot-engine" && python -m pytest tests/ -v`
Expected: `71 passed`, zero failures (59 original + 2 from Task 2 + 5 from Task 3 + 5 from Task 4). If the printed total differs, read the output to see which file's count is off before continuing — don't just eyeball it.

- [ ] **Step 6: Commit**

```bash
git add phantombot-engine/router.py phantombot-engine/tests/test_router.py
git commit -m "feat(phantombot-engine): add cloud-preferred/local-guaranteed router with general and unleashed modes"
```

---

### Task 5: Wire `AgentLoop` to route through `router.py`

**Files:**
- Modify: `C:\Users\jorda\Termina\phantombot-engine\agent_loop.py:1-4,50-64`
- Modify: `C:\Users\jorda\Termina\phantombot-engine\__main__.py`
- Test: `C:\Users\jorda\Termina\phantombot-engine\tests\test_agent_loop.py`

**Interfaces:**
- Consumes: `router.route_chat(messages, on_delta, mode="general", on_fallback=None, cloud_model=None, local_model=None, local_endpoint=None)` (Task 4).
- Produces: `agent_loop.AgentLoop(endpoint, model, tool_dispatch, on_event, mode="general")` — new `mode` constructor kwarg, default `"general"`, forwarded to `router.route_chat` on every call. `on_event` gains a new event kind, `"fallback"`, fired with the fallback reason string whenever the router falls back to local.

- [ ] **Step 1: Write the failing test**

Add to `C:\Users\jorda\Termina\phantombot-engine\tests\test_agent_loop.py` (append; keep the existing `patch("agent_loop.stream_chat", ...)`-based test as-is for now — it will be updated in Step 3 once the import changes):

```python
def test_agent_loop_calls_router_and_forwards_fallback_events():
    events = []

    def fake_route_chat(messages, on_delta, mode=None, on_fallback=None, **kwargs):
        if on_fallback:
            on_fallback("no cloud provider configured")
        text = "Done, no tools needed."
        on_delta(text)
        return text

    loop = agent_loop.AgentLoop(
        endpoint="http://fake",
        model="llama3.1:8b",
        tool_dispatch={},
        on_event=lambda kind, payload: events.append((kind, payload)),
        mode="general",
    )
    with patch("agent_loop.route_chat", side_effect=fake_route_chat):
        result = loop.run_turn([{"role": "system", "content": "sys"}], "hello")

    assert result[-1]["content"] == "Done, no tools needed."
    assert any(kind == "fallback" and payload == "no cloud provider configured" for kind, payload in events)
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd "C:/Users/jorda/Termina/phantombot-engine" && python -m pytest tests/test_agent_loop.py -v`
Expected: FAIL — `AttributeError: module 'agent_loop' has no attribute 'route_chat'` (and `AgentLoop.__init__` doesn't yet accept `mode`)

- [ ] **Step 3: Implement — swap the import and update `AgentLoop`**

In `C:\Users\jorda\Termina\phantombot-engine\agent_loop.py`, replace line 3 (`from ollama_client import stream_chat`) with:

```python
from router import route_chat
```

Replace the `AgentLoop.__init__` and `_call_model` methods (lines 50-64 in the original) with:

```python
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
```

(The rest of `agent_loop.py` — `extract_json_object`, `compact_messages`, `run_turn` — is unchanged.)

Now update the existing test at the top of `test_agent_loop.py` that patches `agent_loop.stream_chat` — it must patch `agent_loop.route_chat` instead, and the fake function's signature must accept the router's kwargs. Replace `test_run_turn_executes_tool_then_returns_final_answer`'s body:

```python
def test_run_turn_executes_tool_then_returns_final_answer():
    events = []

    def fake_route_chat(messages, on_delta, mode=None, on_fallback=None, **kwargs):
        # First call: model asks to list_dir. Second call: model gives final answer.
        if len(messages) == 2:  # system + user
            text = '{"tool": "list_dir", "path": "."}'
        else:
            text = "Done, I listed the directory."
        on_delta(text)
        return text

    def fake_list_dir(path="."):
        return {"ok": True, "path": path, "items": []}

    loop = agent_loop.AgentLoop(
        endpoint="http://fake",
        model="huihui-qwen3.6-35b-uncensored:q3",
        tool_dispatch={"list_dir": fake_list_dir},
        on_event=lambda kind, payload: events.append((kind, payload)),
    )
    with patch("agent_loop.route_chat", side_effect=fake_route_chat):
        messages = [{"role": "system", "content": "sys"}]
        result = loop.run_turn(messages, "list the current directory")

    assert result[-1]["role"] == "assistant"
    assert "Done" in result[-1]["content"]
    assert any(kind == "tool_call" for kind, _ in events)
    assert any(kind == "tool_result" for kind, _ in events)
    assert any(kind == "final" for kind, _ in events)
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd "C:/Users/jorda/Termina/phantombot-engine" && python -m pytest tests/test_agent_loop.py -v`
Expected: `6 passed` (the pre-existing 5 tests in this file plus the new one)

- [ ] **Step 5: Update `__main__.py` to expose mode selection**

Replace the `main()` function body in `C:\Users\jorda\Termina\phantombot-engine\__main__.py`:

```python
def main():
    endpoint = os.environ.get("PHANTOMBOT_OLLAMA_ENDPOINT", default_endpoint())
    mode = os.environ.get("PHANTOMBOT_MODE", "general")
    model = os.environ.get("PHANTOMBOT_MODEL", MODEL if mode == "unleashed" else os.environ.get("PHANTOMPT_MODEL", "llama3.1:8b"))
    dispatch = build_tool_dispatch()

    def agent_loop_factory(on_event):
        return AgentLoop(endpoint=endpoint, model=model, tool_dispatch=dispatch, on_event=on_event, mode=mode)

    server = PhantomBotServer(agent_loop_factory=agent_loop_factory, host="127.0.0.1", port=int(os.environ.get("PHANTOMBOT_WS_PORT", "8766")))
    print(f"PhantomBot engine ({mode} mode) listening on ws://127.0.0.1:{server.port} (token in {os.path.join(tools.OUTPUT_DIR, 'phantombot-ws-token.txt')})")
    asyncio.run(server.start())
```

- [ ] **Step 6: Run the full suite**

Run: `cd "C:/Users/jorda/Termina/phantombot-engine" && python -m pytest tests/ -v`
Expected: all tests pass, no failures, no errors.

- [ ] **Step 7: Commit**

```bash
git add phantombot-engine/agent_loop.py phantombot-engine/__main__.py phantombot-engine/tests/test_agent_loop.py
git commit -m "feat(phantombot-engine): wire AgentLoop through router.route_chat with general/unleashed mode selection"
```

---

### Task 6: Manual end-to-end verification

**Files:** none (verification only, no code changes).

- [ ] **Step 1: Install dependencies in a clean venv**

```bash
cd "C:/Users/jorda/Termina/phantombot-engine"
python -m venv .venv
".venv/Scripts/pip" install -r requirements.txt
```

- [ ] **Step 2: Run the full test suite one more time from the clean venv**

Run: `".venv/Scripts/python" -m pytest tests/ -v`
Expected: all tests pass.

- [ ] **Step 3: Start the engine in general mode with no cloud key configured, confirm it starts**

```bash
cd "C:/Users/jorda/Termina/phantombot-engine"
".venv/Scripts/python" -m phantombot-engine
```

(If this errors on the package-style invocation because the directory name has a hyphen, run `".venv/Scripts/python" __main__.py` directly from inside `phantombot-engine/` instead.)

Expected console output: `PhantomBot engine (general mode) listening on ws://127.0.0.1:8766 (token in ...)` — confirms the server starts without a cloud key present and without crashing on the local-fallback path setup.

- [ ] **Step 4: Confirm the token file was written**

Run: `cat ~/Phantombot-Unleashed/output/phantombot-ws-token.txt` (or the Windows equivalent path printed in Step 3's output)
Expected: a 64-character hex string.

- [ ] **Step 5: Stop the server (Ctrl+C), record the result**

Report back: did the server start cleanly, did the test suite pass in the clean venv, and was the token file written. If Ollama itself isn't installed/running on this machine, note that as a known limitation of this manual check (the *routing and wiring* is what Task 6 verifies — actually exercising a live local model response requires Ollama running with a model pulled, which is out of scope for this plan and is exactly the "first-run auto-pull" UX called out as future work in the spec's error-handling section).

This task has no commit — it's a verification checkpoint only.
