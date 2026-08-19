from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from run_agent import AIAgent


def _response(text: str):
    message = SimpleNamespace(
        content=text,
        tool_calls=None,
        reasoning=None,
        reasoning_content=None,
    )
    return SimpleNamespace(
        choices=[SimpleNamespace(message=message, finish_reason="stop")],
        model="phantom",
        usage=None,
    )


def test_unsupported_ollama_thinking_retries_without_reasoning_controls():
    with (
        patch("run_agent.get_tool_definitions", return_value=[]),
        patch("run_agent.check_toolset_requirements", return_value={}),
        patch("run_agent.OpenAI"),
    ):
        agent = AIAgent(
            model="placeholder",
            api_key="test-key",
            base_url="https://openrouter.ai/api/v1",
            provider="openrouter",
            quiet_mode=True,
            skip_context_files=True,
            skip_memory=True,
        )

    agent.provider = "custom"
    agent.model = "phantom"
    agent.base_url = "http://127.0.0.1:11434/v1"
    agent._base_url_lower = agent.base_url.lower()
    agent._ollama_num_ctx = 4096
    agent._ollama_options = {"num_thread": 2}
    agent._ollama_keep_alive = 0
    agent.reasoning_config = {"enabled": True, "effort": "medium"}
    agent.client = MagicMock()
    agent._cached_system_prompt = "You are helpful."
    agent._use_prompt_caching = False
    agent.compression_enabled = False
    agent.save_trajectories = False
    agent.tool_delay = 0

    error = Exception('Error code: 400 - "phantom" does not support thinking')
    error.status_code = 400
    requests = []

    def create(**kwargs):
        requests.append(kwargs)
        if len(requests) == 1:
            raise error
        return _response("Recovered")

    agent.client.chat.completions.create.side_effect = create

    with (
        patch.object(agent, "_ollama_supports_thinking_cached", return_value=True),
        patch.object(agent, "_persist_session"),
        patch.object(agent, "_save_trajectory"),
        patch.object(agent, "_cleanup_task_resources"),
    ):
        result = agent.run_conversation("Explain how to validate this recovery path.")

    assert result["completed"] is True
    assert result["final_response"] == "Recovered"
    assert len(requests) == 2
    assert requests[0]["reasoning_effort"] == "medium"
    assert "reasoning_effort" not in requests[1]
    assert "think" not in requests[1].get("extra_body", {})
