"""Behavioral coverage for Phantom's bounded schema-guided tool repair."""

from unittest.mock import MagicMock, patch

from run_agent import AIAgent
from tests.run_agent.test_run_agent import _mock_response, _mock_tool_call


TOOL_DEFS = [
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "search",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    }
]


def _agent(model: str = "phantom:latest") -> AIAgent:
    is_phantom = model.startswith("phantom")
    with (
        patch("run_agent.get_tool_definitions", return_value=TOOL_DEFS),
        patch("run_agent.check_toolset_requirements", return_value={}),
        patch("run_agent.OpenAI"),
    ):
        agent = AIAgent(
            api_key="test-key-1234567890",
            base_url=(
                "http://127.0.0.1:11434/v1"
                if is_phantom
                else "https://openrouter.ai/api/v1"
            ),
            model=model,
            provider="phantom" if is_phantom else "openrouter",
            quiet_mode=True,
            skip_context_files=True,
            skip_memory=True,
        )
    agent.client = MagicMock()
    agent.api_mode = "chat_completions"
    agent.tool_delay = 0
    agent.compression_enabled = False
    agent.save_trajectories = False
    agent._cached_system_prompt = "You are helpful."
    return agent


def _run(agent: AIAgent, responses):
    remaining = iter(responses)
    api_calls = []

    def _next_response(api_kwargs):
        api_calls.append(dict(api_kwargs))
        return next(remaining)

    dispatch = MagicMock(return_value="search result")
    with (
        patch.object(agent, "_interruptible_api_call", side_effect=_next_response),
        patch("agent.phantom_supervisor.instant_phantom_reply", return_value=None),
        patch("agent.phantom_supervisor.should_supervise", return_value=False),
        patch("agent.phantom_supervisor.should_plan_execution", return_value=False),
        patch("run_agent.handle_function_call", side_effect=dispatch),
        patch.object(agent, "_invoke_tool", side_effect=dispatch),
        patch.object(agent, "_persist_session"),
        patch.object(agent, "_save_trajectory"),
        patch.object(agent, "_cleanup_task_resources"),
    ):
        result = agent.run_conversation("search now")
    return result, dispatch, api_calls


def test_valid_arguments_execute_without_repair():
    agent = _agent()
    result, dispatch, api_calls = _run(
        agent,
        [
            _mock_response(
                content="",
                finish_reason="tool_calls",
                tool_calls=[_mock_tool_call(arguments='{"query":"ok"}', call_id="c1")],
            ),
            _mock_response(content="done"),
        ],
    )

    assert result["final_response"] == "done"
    dispatch.assert_called_once()
    assert all(
        "tool_choice" not in call
        for call in api_calls
    )


def test_phantom_schema_invalid_call_gets_one_forced_same_tool_repair():
    agent = _agent()
    result, dispatch, calls = _run(
        agent,
        [
            _mock_response(
                content="",
                finish_reason="tool_calls",
                tool_calls=[_mock_tool_call(arguments="{}", call_id="bad")],
            ),
            _mock_response(
                content="",
                finish_reason="tool_calls",
                tool_calls=[_mock_tool_call(arguments='{"query":"fixed"}', call_id="fixed")],
            ),
            _mock_response(content="done"),
        ],
    )

    assert result["final_response"] == "done"
    dispatch.assert_called_once()
    assert calls[1]["tool_choice"] == {
        "type": "function",
        "function": {"name": "web_search"},
    }
    assert sum("tool_choice" in call for call in calls) == 1
    tool_errors = [
        message["content"]
        for message in result["messages"]
        if message.get("role") == "tool" and message.get("tool_call_id") == "bad"
    ]
    assert tool_errors and '"required": ["query"]' in tool_errors[0]


def test_phantom_malformed_json_is_repaired_once_and_never_dispatched():
    agent = _agent()
    result, dispatch, calls = _run(
        agent,
        [
            _mock_response(
                content="",
                finish_reason="tool_calls",
                tool_calls=[_mock_tool_call(arguments='{"query":', call_id="bad-json")],
            ),
            _mock_response(content="done"),
        ],
    )

    assert result["final_response"] == "done"
    dispatch.assert_not_called()
    assert sum("tool_choice" in call for call in calls) == 1


def test_failed_phantom_repair_does_not_force_a_second_repair():
    agent = _agent()
    result, dispatch, calls = _run(
        agent,
        [
            _mock_response(
                content="",
                finish_reason="tool_calls",
                tool_calls=[_mock_tool_call(arguments="{}", call_id="bad-1")],
            ),
            _mock_response(
                content="",
                finish_reason="tool_calls",
                tool_calls=[_mock_tool_call(arguments="{}", call_id="bad-2")],
            ),
            _mock_response(content="done"),
        ],
    )

    assert result["final_response"] == "done"
    dispatch.assert_not_called()
    assert sum("tool_choice" in call for call in calls) == 1


def test_reliable_model_self_corrects_without_forced_tool_choice():
    agent = _agent("openai/gpt-5.5")
    result, dispatch, calls = _run(
        agent,
        [
            _mock_response(
                content="",
                finish_reason="tool_calls",
                tool_calls=[_mock_tool_call(arguments="{}", call_id="bad")],
            ),
            _mock_response(
                content="",
                finish_reason="tool_calls",
                tool_calls=[_mock_tool_call(arguments='{"query":"fixed"}', call_id="fixed")],
            ),
            _mock_response(content="done"),
        ],
    )

    assert result["final_response"] == "done"
    dispatch.assert_called_once()
    assert all(
        "tool_choice" not in call
        for call in calls
    )
