import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import agent_loop  # noqa: E402


def test_extract_json_object_from_plain_json():
    assert agent_loop.extract_json_object('{"tool": "list_dir"}') == '{"tool": "list_dir"}'


def test_extract_json_object_from_fenced_block():
    text = '```json\n{"tool": "list_dir"}\n```'
    assert agent_loop.extract_json_object(text) == '{"tool": "list_dir"}'


def test_extract_json_object_returns_empty_for_prose():
    assert agent_loop.extract_json_object("Here is the answer: 42") == ""


def test_compact_messages_keeps_system_and_trims_middle():
    system = {"role": "system", "content": "sys"}
    big_messages = [system] + [{"role": "user", "content": "x" * 1000} for _ in range(200)]
    result = agent_loop.compact_messages(big_messages, max_chars=5000)
    total_chars = sum(len(m["content"]) for m in result)
    assert total_chars <= 5000 + 1000  # system + trimmed tail fits roughly under budget
    assert result[0] == system


def test_run_turn_executes_tool_then_returns_final_answer():
    events = []

    def fake_stream_chat(endpoint, model, messages, on_delta, **kwargs):
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
    with patch("agent_loop.stream_chat", side_effect=fake_stream_chat):
        messages = [{"role": "system", "content": "sys"}]
        result = loop.run_turn(messages, "list the current directory")

    assert result[-1]["role"] == "assistant"
    assert "Done" in result[-1]["content"]
    assert any(kind == "tool_call" for kind, _ in events)
    assert any(kind == "tool_result" for kind, _ in events)
    assert any(kind == "final" for kind, _ in events)
