"""Active/pending model state and zero-probe diagnostics contracts."""

import threading
import time
from types import SimpleNamespace
from unittest.mock import patch

from tui_gateway import server


def _session(*, running: bool = False):
    agent = SimpleNamespace(
        model="phantom:latest",
        provider="phantom",
        max_iterations=300,
        _turn_tool_call_count=7,
        _ollama_thinking_cache={"phantom:latest": False},
        context_compressor=SimpleNamespace(last_prompt_tokens=12_345),
        reasoning_config={},
        service_tier=None,
        session_id="session-key",
    )
    return {
        "agent": agent,
        "session_key": "session-key",
        "running": running,
        "history": [],
        "history_lock": threading.RLock(),
    }


def test_session_info_exposes_active_and_pending_without_changing_legacy_fields():
    session = _session()
    session["pending_model_switch"] = {
        "model": "gpt-5.5",
        "provider": "openai-codex",
    }
    with (
        patch.object(server, "_load_cfg", return_value={}),
        patch.object(server, "_display_session_cwd", return_value=""),
        patch.object(server, "_git_branch_for_cwd", return_value=""),
        patch.object(server, "_project_info_for_cwd", return_value=None),
        patch.object(server, "_session_usage_snapshot", return_value={}),
        patch.object(server, "_response_profile_name", return_value="default"),
        patch.object(server, "_current_profile_name", return_value="default"),
    ):
        info = server._session_info(session["agent"], session)

    assert info["model"] == info["active_model"] == "phantom:latest"
    assert info["provider"] == info["active_provider"] == "phantom"
    assert info["pending_model"] == "gpt-5.5"
    assert info["pending_provider"] == "openai-codex"


def test_busy_config_set_queues_and_emits_authoritative_state(monkeypatch):
    session = _session(running=True)
    monkeypatch.setitem(server._sessions, "sid-contract", session)
    emitted = []
    monkeypatch.setattr(
        server,
        "_emit",
        lambda event, sid, payload=None: emitted.append((event, sid, payload)),
    )
    monkeypatch.setattr(
        server,
        "_session_info",
        lambda agent, sess=None: {
            "active_model": agent.model,
            "active_provider": agent.provider,
            "pending_model": sess["pending_model_switch"]["model"],
            "pending_provider": sess["pending_model_switch"]["provider"],
        },
    )

    response = server.handle_request(
        {
            "id": "queue-1",
            "method": "config.set",
            "params": {
                "session_id": "sid-contract",
                "key": "model",
                "value": "gpt-5.5 --provider openai-codex",
            },
        }
    )

    assert response["result"]["pending"] is True
    assert session["agent"].model == "phantom:latest"
    assert session["pending_model_switch"]["model"] == "gpt-5.5"
    assert emitted == [
        (
            "session.info",
            "sid-contract",
            {
                "active_model": "phantom:latest",
                "active_provider": "phantom",
                "pending_model": "gpt-5.5",
                "pending_provider": "openai-codex",
            },
        )
    ]


def test_pending_switch_clears_only_after_apply():
    session = _session()
    session["pending_model_switch"] = {
        "raw_input": "gpt-5.5 --provider openai-codex",
        "model": "gpt-5.5",
        "provider": "openai-codex",
        "confirm_expensive_model": True,
    }

    def apply(_sid, sess, _raw, **kwargs):
        assert sess["pending_model_switch"]["model"] == "gpt-5.5"
        assert kwargs["emit_session_info"] is False
        sess["agent"].model = "gpt-5.5"
        sess["agent"].provider = "openai-codex"
        return {"value": "gpt-5.5", "confirm_required": False}

    with patch.object(server, "_apply_model_switch", side_effect=apply):
        assert server._apply_pending_model_switch("sid", session) is True

    assert "pending_model_switch" not in session
    assert session["agent"].model == "gpt-5.5"


def test_diagnostics_snapshot_is_fast_structured_and_probe_free():
    session = _session()
    session["pending_model_switch"] = {
        "model": "gpt-5.5",
        "provider": "openai-codex",
    }
    cfg = {
        "agent": {"max_turns": 300},
        "context_limits": {
            "target_input_tokens": 40_000,
            "hard_input_tokens": 110_000,
        },
    }
    with (
        patch.object(server, "_load_cfg", return_value=cfg),
        patch.object(server, "_session_usage_snapshot", return_value={"context_used": 23_456}),
        patch(
            "agent.models_dev.get_models_dev_refresh_state",
            return_value={"cache_present": True, "refresh_in_progress": False},
        ),
        patch(
            "hermes_cli.codex_models.get_codex_refresh_state",
            return_value={"cache_present": True, "refresh_in_progress": False},
        ),
    ):
        started = time.perf_counter()
        snapshot = server._diagnostics_snapshot(session)
        elapsed_ms = (time.perf_counter() - started) * 1000

    assert elapsed_ms < 100
    assert snapshot["active_model"] == "phantom:latest"
    assert snapshot["pending_model"] == "gpt-5.5"
    assert snapshot["turn_tool_call_count"] == 7
    assert snapshot["max_turns"] == 300
    assert snapshot["context"] == {
        "target": 40_000,
        "hard": 110_000,
        "estimated": 23_456,
    }
    assert snapshot["ollama"]["thinking_cache_entries"] == 1
    assert snapshot["ollama"]["current_route_cached"] is True
    assert snapshot["ollama"]["thinking_supported"] is False
    assert snapshot["models_dev"]["cache_present"] is True
    assert snapshot["codex"]["cache_present"] is True
