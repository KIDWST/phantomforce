import io
import json
import os
import sys
from unittest.mock import patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import ollama_client  # noqa: E402


def test_validate_unleashed_accepts_marked_model():
    ollama_client.validate_unleashed("huihui-qwen3.6-35b-uncensored:q3")  # must not raise


def test_validate_unleashed_rejects_unmarked_model():
    with pytest.raises(RuntimeError):
        ollama_client.validate_unleashed("gpt-4o")


class _FakeResponse:
    def __init__(self, lines):
        self._lines = lines

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def __iter__(self):
        return iter(self._lines)


def test_stream_chat_accumulates_deltas_and_calls_callback():
    sse_lines = [
        b'data: {"choices":[{"delta":{"content":"Hel"}}]}\n',
        b'data: {"choices":[{"delta":{"content":"lo"}}]}\n',
        b'data: [DONE]\n',
    ]
    deltas = []
    with patch("urllib.request.urlopen", return_value=_FakeResponse(sse_lines)):
        result = ollama_client.stream_chat(
            "http://127.0.0.1:11434/v1",
            "huihui-qwen3.6-35b-uncensored:q3",
            [{"role": "user", "content": "hi"}],
            on_delta=lambda d: deltas.append(d),
        )
    assert result == "Hello"
    assert deltas == ["Hel", "lo"]


def test_stream_chat_skips_non_dict_json_lines_without_crashing():
    sse_lines = [
        b'data: null\n',
        b'data: []\n',
        b'data: {"choices":[{"delta":{"content":"ok"}}]}\n',
        b'data: [DONE]\n',
    ]
    with patch("urllib.request.urlopen", return_value=_FakeResponse(sse_lines)):
        result = ollama_client.stream_chat(
            "http://127.0.0.1:11434/v1",
            "huihui-qwen3.6-35b-uncensored:q3",
            [{"role": "user", "content": "hi"}],
            on_delta=lambda d: None,
        )
    assert result == "ok"


def test_stream_chat_sends_num_ctx_option():
    captured = {}

    class _Req:
        def __init__(self, url, data=None, headers=None, method=None):
            captured["body"] = json.loads(data.decode())

    with patch("urllib.request.Request", side_effect=_Req), \
         patch("urllib.request.urlopen", return_value=_FakeResponse([b"data: [DONE]\n"])):
        ollama_client.stream_chat(
            "http://127.0.0.1:11434/v1",
            "huihui-qwen3.6-35b-uncensored:q3",
            [{"role": "user", "content": "hi"}],
            on_delta=lambda d: None,
            num_ctx=8192,
        )
    assert captured["body"]["options"]["num_ctx"] == 8192
