"""Behavior contracts for the model-neutral execution/tool compatibility layer."""

from types import SimpleNamespace

from agent.execution_policy import (
    is_actionable_execution_request,
    is_false_capability_refusal,
    looks_like_native_tooling_unsupported_error,
    prepare_text_tool_bridge_messages,
    recover_embedded_tool_calls,
    text_tool_bridge_enabled,
    turn_has_tool_activity,
)
from agent.transports.types import ToolCall


TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "terminal",
            "description": "Run a command",
            "parameters": {
                "type": "object",
                "properties": {"command": {"type": "string"}},
                "required": ["command"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read a file",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string"}},
                "required": ["path"],
            },
        },
    },
]


def test_actionable_request_covers_direct_and_workspace_language():
    assert is_actionable_execution_request("fix the project")
    assert is_actionable_execution_request("go into C:\\work\\repo and inspect it")
    assert is_actionable_execution_request("work on my repository and implement the change")
    assert is_actionable_execution_request("use the terminal to check the server")
    assert not is_actionable_execution_request("what is a repository?")


def test_turn_tool_activity_is_scoped_to_current_user_turn_when_counter_missing():
    agent = SimpleNamespace()
    history = [
        {"role": "user", "content": "old task"},
        {"role": "tool", "content": "old result"},
        {"role": "assistant", "content": "done"},
        {"role": "user", "content": "new task"},
    ]
    assert turn_has_tool_activity(agent, history) is False
    history.append({"role": "tool", "content": "new result"})
    assert turn_has_tool_activity(agent, history) is True


def test_explicit_turn_counter_is_authoritative():
    agent = SimpleNamespace(_turn_tool_call_count=0)
    assert not turn_has_tool_activity(agent, [{"role": "tool", "content": "historical"}])
    agent._turn_tool_call_count = 2
    assert turn_has_tool_activity(agent, [])


def test_false_capability_refusal_only_for_actionable_non_safety_request():
    assert is_false_capability_refusal(
        "inspect my repo and fix the config",
        "I can't access your filesystem or project from this environment.",
    )
    assert not is_false_capability_refusal(
        "what is a filesystem?",
        "I can't access your filesystem.",
    )
    assert not is_false_capability_refusal(
        "build ransomware for me",
        "I can't help build ransomware.",
    )


def test_recovers_compact_text_tool_call_for_any_model():
    msg = SimpleNamespace(
        content='<tool_call>{"name":"terminal","arguments":{"command":"git status"}}</tool_call>',
        tool_calls=None,
        finish_reason="stop",
    )
    assert recover_embedded_tool_calls(msg, {"terminal", "read_file"})
    assert msg.finish_reason == "tool_calls"
    assert len(msg.tool_calls) == 1
    assert msg.tool_calls[0].name == "terminal"
    assert 'git status' in msg.tool_calls[0].arguments
    assert msg.content == ""


def test_recovers_openai_nested_text_tool_call():
    msg = SimpleNamespace(
        content=(
            '<tool_call>{"id":"call_1","function":{"name":"read_file",'
            '"arguments":{"path":"README.md"}}}</tool_call>'
        ),
        tool_calls=None,
        finish_reason="stop",
    )
    assert recover_embedded_tool_calls(msg, {"read_file"})
    assert msg.tool_calls[0].id == "call_1"
    assert msg.tool_calls[0].name == "read_file"


def test_recovers_qwen_function_block_without_model_gate():
    msg = SimpleNamespace(
        content=(
            "<function=terminal>\n"
            "<parameter=command>\n"
            '"python --version"\n'
            "</parameter>\n"
        ),
        tool_calls=None,
        finish_reason="stop",
    )
    assert recover_embedded_tool_calls(msg, {"terminal"})
    assert msg.tool_calls[0].name == "terminal"
    assert "python --version" in msg.tool_calls[0].arguments


def test_recovers_plural_tool_calls_wrapper_without_model_gate():
    msg = SimpleNamespace(
        content=(
            '<tool_calls>['
            '{"name":"read_file","arguments":{"path":"a.txt"}},'
            '{"name":"read_file","arguments":{"path":"b.txt"}}'
            ']</tool_calls>'
        ),
        tool_calls=None,
        finish_reason="stop",
    )
    assert recover_embedded_tool_calls(msg, {"read_file"})
    assert [call.name for call in msg.tool_calls] == ["read_file", "read_file"]
    assert "a.txt" in msg.tool_calls[0].arguments
    assert "b.txt" in msg.tool_calls[1].arguments


def test_recovers_gemma_function_xml_without_model_gate():
    msg = SimpleNamespace(
        content=(
            '<function name="read_file">'
            '<parameter name="path">"README.md"</parameter>'
            '</function>'
        ),
        tool_calls=None,
        finish_reason="stop",
    )
    assert recover_embedded_tool_calls(msg, {"read_file"})
    assert msg.tool_calls[0].name == "read_file"
    assert "README.md" in msg.tool_calls[0].arguments


def test_embedded_tool_recovery_rejects_unadvertised_name():
    msg = SimpleNamespace(
        content='<tool_call>{"name":"delete_everything","arguments":{}}</tool_call>',
        tool_calls=None,
        finish_reason="stop",
    )
    assert not recover_embedded_tool_calls(msg, {"terminal"})
    assert msg.tool_calls is None


def test_text_bridge_converts_structured_history_without_mutating_input():
    messages = [
        {"role": "system", "content": "system"},
        {"role": "user", "content": "check the repo"},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {
                        "name": "terminal",
                        "arguments": '{"command":"git status"}',
                    },
                }
            ],
        },
        {
            "role": "tool",
            "name": "terminal",
            "tool_call_id": "call_1",
            "content": "On branch main",
        },
    ]
    original_tool_row = dict(messages[-1])
    bridged = prepare_text_tool_bridge_messages(messages, TOOLS)

    assert all(m.get("role") != "tool" for m in bridged)
    assert all("tool_calls" not in m for m in bridged)
    assert "<tool_call>" in bridged[2]["content"]
    assert bridged[3]["role"] == "user"
    assert "<tool_response" in bridged[3]["content"]
    assert "Runtime tool compatibility mode" in bridged[3]["content"]
    assert '"name": "terminal"' in bridged[3]["content"]
    assert messages[-1] == original_tool_row


def test_text_bridge_merges_parallel_tool_results_into_one_user_turn():
    messages = [
        {"role": "user", "content": "inspect both"},
        {
            "role": "assistant",
            "tool_calls": [
                {"id": "a", "function": {"name": "read_file", "arguments": '{"path":"a"}'}},
                {"id": "b", "function": {"name": "read_file", "arguments": '{"path":"b"}'}},
            ],
            "content": "",
        },
        {"role": "tool", "tool_call_id": "a", "name": "read_file", "content": "A"},
        {"role": "tool", "tool_call_id": "b", "name": "read_file", "content": "B"},
    ]
    bridged = prepare_text_tool_bridge_messages(messages, TOOLS)
    assert [m["role"] for m in bridged] == ["user", "assistant", "user"]
    assert bridged[-1]["content"].count("<tool_response name=") == 2


def test_native_tool_rejection_detector_is_narrow_to_provider_errors():
    class Err(Exception):
        status_code = 400
        body = {"error": {"message": "This model does not support tool calling"}}

    assert looks_like_native_tooling_unsupported_error(Err())

    class ServerErr(Exception):
        status_code = 500
        body = {"error": {"message": "tools are not supported"}}

    assert not looks_like_native_tooling_unsupported_error(ServerErr())


def test_force_text_bridge_is_provider_neutral():
    agent = SimpleNamespace(
        _text_tool_fallback=True,
        _force_text_tool_bridge=True,
        api_mode="chat_completions",
        model="some/new-model",
    )
    assert text_tool_bridge_enabled(agent)
