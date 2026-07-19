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
