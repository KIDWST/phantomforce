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
