from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import Mock, patch

from agent.ollama_runtime import (
    build_ollama_request_options,
    choose_ollama_num_ctx,
    choose_ollama_request_num_ctx,
    configure_agent_ollama_runtime,
    ensure_ollama_available,
    ensure_explicit_phantom_runtime,
    is_local_ollama_endpoint,
)


def test_huihui_large_model_is_capped_from_huge_detected_context():
    assert choose_ollama_num_ctx("huihui-qwen3.6-35b-uncensored:q3", 65536) == 32768


def test_phantom_coding_model_uses_full_local_context():
    assert choose_ollama_num_ctx("phantom", 262144) == 262144


def test_phantom_unleashed_keeps_the_long_context_profile():
    assert choose_ollama_num_ctx("phantom-unleashed", 262144) == 262144


def test_short_phantom_request_uses_fast_tool_window():
    assert (
        choose_ollama_request_num_ctx(
            "phantom",
            262144,
            [{"role": "user", "content": "run matrix rain"}],
            tool_count=12,
        )
        == 65536
    )


def test_long_phantom_request_expands_context_window():
    long_message = "x" * 420_000
    assert (
        choose_ollama_request_num_ctx(
            "phantom",
            262144,
            [{"role": "user", "content": long_message}],
            tool_count=20,
        )
        == 131072
    )


def test_explicit_ollama_num_ctx_override_wins():
    assert (
        choose_ollama_num_ctx(
            "huihui-qwen3.6-35b-uncensored:q3",
            65536,
            explicit_ctx="16384",
        )
        == 16384
    )


def test_request_options_do_not_use_all_cpu_threads():
    options = build_ollama_request_options(
        "huihui-qwen3.6-35b-uncensored:q3",
        cpu_count=32,
    )
    assert options == {"num_thread": 4, "num_batch": 64}


def test_local_aliases_are_ollama_endpoints():
    assert is_local_ollama_endpoint("http://127.0.0.1:11434/v1", "custom:local-ollama")
    assert is_local_ollama_endpoint("http://127.0.0.1:11434/v1", "ollama-launch")


@patch("agent.ollama_runtime.ensure_ollama_available")
@patch("agent.ollama_runtime._probe_ollama", return_value=False)
def test_agent_initialization_only_configures_local_runtime(_probe, ensure):
    agent = SimpleNamespace(
        base_url="http://127.0.0.1:11434/v1",
        provider="phantom",
        model="phantom",
        api_key="",
    )
    status = configure_agent_ollama_runtime(agent, model_cfg={"ollama_num_ctx": 65536})
    ensure.assert_not_called()
    assert status["status"] == "on_demand"
    assert agent._ollama_num_ctx == 65536
    assert agent._ollama_keep_alive == "15m"


@patch("agent.ollama_runtime.ensure_ollama_available")
def test_only_explicit_phantom_request_can_start_runtime(ensure):
    cloud = SimpleNamespace(provider="openrouter", model="openai/gpt-5", base_url="https://openrouter.ai/api/v1")
    assert ensure_explicit_phantom_runtime(cloud)["status"] == "not_explicit_phantom"
    ensure.assert_not_called()

    phantom = SimpleNamespace(provider="phantom", model="phantom", base_url="http://127.0.0.1:11434/v1")
    ensure.return_value = {"ok": True, "status": "started"}
    assert ensure_explicit_phantom_runtime(phantom)["status"] == "started"
    ensure.assert_called_once()


@patch("agent.ollama_runtime._probe_ollama", return_value=True)
def test_ensure_ollama_available_does_not_start_when_running(_probe):
    assert ensure_ollama_available("http://127.0.0.1:11434/v1", provider="ollama") == {
        "ok": True,
        "status": "already_running",
    }


@patch("agent.ollama_runtime.time.sleep")
@patch("agent.ollama_runtime.threading.Thread")
@patch("agent.ollama_runtime._record_owned_listener_pids")
@patch("agent.ollama_runtime._record_owned_ollama_pid")
@patch("agent.ollama_runtime.subprocess.Popen")
@patch("agent.ollama_runtime.find_ollama_executable", return_value=r"C:\Ollama\ollama.exe")
@patch("agent.ollama_runtime._probe_ollama", side_effect=[False, False, True])
def test_ensure_ollama_available_starts_hidden_runtime(
    _probe,
    _find,
    popen,
    _record_pid,
    _record_listener,
    thread,
    _sleep,
):
    popen.return_value = Mock()
    status = ensure_ollama_available("http://127.0.0.1:11434/v1", provider="ollama")
    assert status == {"ok": True, "status": "started"}
    args, kwargs = popen.call_args
    assert args[0] == [r"C:\Ollama\ollama.exe", "serve"]
    assert kwargs["stdout"] is not None
    assert kwargs["stderr"] is not None
    assert kwargs["env"]["OLLAMA_NUM_PARALLEL"] == "1"
    assert kwargs["env"]["OLLAMA_MAX_LOADED_MODELS"] == "1"
    assert kwargs["env"]["OLLAMA_MAX_QUEUE"] == "1"
    assert kwargs["env"]["OLLAMA_KEEP_ALIVE"] == "15m"
    thread.assert_called_once()


@patch("agent.ollama_runtime.subprocess.Popen")
@patch("agent.ollama_runtime._probe_ollama", side_effect=[False, True])
def test_waiting_worker_reprobes_after_machine_start_lock(_probe, popen):
    status = ensure_ollama_available("http://127.0.0.1:11434/v1", provider="ollama")
    assert status == {"ok": True, "status": "already_running"}
    popen.assert_not_called()

@patch("agent.ollama_runtime.ensure_ollama_available")
def test_explicit_phantom_unleashed_request_can_start_runtime(ensure):
    unleashed = SimpleNamespace(
        provider="phantom",
        model="phantom-unleashed",
        base_url="http://127.0.0.1:11434/v1",
    )
    ensure.return_value = {"ok": True, "status": "started"}

    assert ensure_explicit_phantom_runtime(unleashed)["status"] == "started"
    ensure.assert_called_once()

@patch("agent.ollama_runtime.ensure_ollama_available")
def test_custom_local_phantom_unleashed_request_can_start_runtime(ensure):
    unleashed = SimpleNamespace(
        provider="custom",
        model="phantom-unleashed",
        base_url="http://127.0.0.1:11434/v1",
    )
    ensure.return_value = {"ok": True, "status": "started"}

    assert ensure_explicit_phantom_runtime(unleashed)["status"] == "started"
    ensure.assert_called_once_with(
        "http://127.0.0.1:11434/v1",
        provider="custom",
        log=None,
    )


@patch("agent.ollama_runtime.ensure_ollama_available")
def test_custom_remote_phantom_unleashed_request_cannot_start_runtime(ensure):
    remote = SimpleNamespace(
        provider="custom",
        model="phantom-unleashed",
        base_url="https://models.example.test/v1",
    )

    assert ensure_explicit_phantom_runtime(remote)["status"] == "not_explicit_phantom"
    ensure.assert_not_called()
