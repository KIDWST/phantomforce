"""Model-neutral no-action continuation policy behavior contracts."""

from types import SimpleNamespace
from typing import Union

from agent.agent_runtime_helpers import (
    intent_ack_continuation_enabled,
    intent_ack_continuation_mode,
    looks_like_codex_intermediate_ack,
)


def _agent(
    mode: Union[str, bool, list] = "auto",
    api_mode="chat_completions",
    model="anthropic/claude-sonnet-4",
):
    return SimpleNamespace(
        _intent_ack_continuation=mode,
        api_mode=api_mode,
        model=model,
        _strip_think_blocks=lambda c: c,
    )


REPRO_USER = (
    "check the current status of the server, grab the latest error logs, "
    "and let me know if there's anything critical"
)
REPRO_ACK = "I will start by running a health check command on the server to see its current status."
CODE_USER = "review the codebase in /app"
CODE_ACK = "Let me inspect the repository files first."


# ── mode resolution ────────────────────────────────────────────────────────




def test_true_is_all_api_modes():
    for api_mode in ("chat_completions", "anthropic_messages", "codex_responses"):
        assert intent_ack_continuation_mode(_agent(True, api_mode)) == "all"
    for value in ("true", "always", "yes", "on", "ON"):
        assert intent_ack_continuation_mode(_agent(value)) == "all"








def test_missing_attr_defaults_to_auto():
    bare = SimpleNamespace(api_mode="chat_completions", model="x", _strip_think_blocks=lambda c: c)
    assert intent_ack_continuation_mode(bare) == "all"


def test_enabled_is_mode_not_off():
    assert intent_ack_continuation_enabled(_agent("auto")) is True
    assert intent_ack_continuation_enabled(_agent(True)) is True
    assert intent_ack_continuation_enabled(_agent(False)) is False


# ── detector: workspace requirement ─────────────────────────────────────────




def test_multipart_user_message_does_not_crash_on_workspace_path():
    agent = _agent("codex_only", "codex_responses")
    multipart = [
        {"type": "text", "text": CODE_USER},
        {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}},
    ]
    assert looks_like_codex_intermediate_ack(
        agent, multipart, CODE_ACK, [{"role": "user", "content": multipart}], require_workspace=True
    )


def test_auto_catches_non_workspace_execution_ack():
    agent = _agent("auto")
    assert looks_like_codex_intermediate_ack(
        agent,
        REPRO_USER,
        REPRO_ACK,
        [{"role": "user", "content": REPRO_USER}],
        require_workspace=False,
    )


def test_historical_tool_activity_does_not_disable_a_new_turn():
    agent = _agent("auto")
    messages = [
        {"role": "user", "content": "check the old server"},
        {"role": "assistant", "content": None, "tool_calls": [{"id": "old"}]},
        {"role": "tool", "tool_call_id": "old", "content": "ok"},
        {"role": "assistant", "content": "Done."},
        {"role": "user", "content": REPRO_USER},
    ]
    assert looks_like_codex_intermediate_ack(
        agent, REPRO_USER, REPRO_ACK, messages, require_workspace=False
    )


def test_promise_after_a_tool_round_is_still_incomplete():
    agent = _agent("auto")
    agent._turn_tool_call_count = 1
    messages = [
        {"role": "user", "content": "fix the project"},
        {"role": "tool", "content": "found config"},
    ]
    ack = "I found the config. I'll edit the broken setting now."
    assert looks_like_codex_intermediate_ack(
        agent, "fix the project", ack, messages, require_workspace=False
    )








