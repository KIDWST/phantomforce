from types import SimpleNamespace

from agent.chat_completion_helpers import (
    reasoning_is_suppressed_for_current_route,
    suppress_reasoning_for_current_route,
)


def _agent(model: str = "phantom") -> SimpleNamespace:
    return SimpleNamespace(
        provider="custom",
        base_url="http://127.0.0.1:11434/v1",
        model=model,
        _ollama_thinking_cache={
            (model, "http://127.0.0.1:11434/v1"): (True, 1.0),
        },
    )


def test_suppression_is_scoped_to_exact_provider_endpoint_and_model():
    agent = _agent()
    suppress_reasoning_for_current_route(agent)

    assert reasoning_is_suppressed_for_current_route(agent) is True

    agent.model = "deepseek-r1"
    assert reasoning_is_suppressed_for_current_route(agent) is False

    agent.model = "phantom"
    agent.base_url = "http://127.0.0.1:22434/v1"
    assert reasoning_is_suppressed_for_current_route(agent) is False


def test_suppression_replaces_stale_positive_ollama_capability():
    agent = _agent()
    suppress_reasoning_for_current_route(agent)

    supported, _timestamp = agent._ollama_thinking_cache[
        ("phantom", "http://127.0.0.1:11434/v1")
    ]
    assert supported is False
