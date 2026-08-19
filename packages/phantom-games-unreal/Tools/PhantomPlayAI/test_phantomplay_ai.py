from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from phantomplay_ai import PhantomPlayAI


MESSAGES = [
    {"role": "system", "content": "Build the real project."},
    {"role": "user", "content": "Inspect the arena."},
]
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "project_search",
            "description": "Search project files.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    }
]


class PhantomPlayAIProviderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.app = PhantomPlayAI(Path(self.temp.name))
        self.app.providers.key = lambda _provider: "test-key"

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_openai_compatible_provider_keeps_tools_and_model(self) -> None:
        captured = {}

        def fake_request(url, body, headers, label):
            captured.update(url=url, body=body, headers=headers, label=label)
            return {"model": body["model"], "choices": [{"message": {"role": "assistant", "content": "Ready"}}]}

        self.app.providers._json_request = fake_request
        response = self.app.providers.request(MESSAGES, TOOLS, "gpt-5", "openai")

        self.assertEqual(captured["url"], "https://api.openai.com/v1/chat/completions")
        self.assertEqual(captured["body"]["tools"], TOOLS)
        self.assertEqual(captured["body"]["tool_choice"], "auto")
        self.assertEqual(captured["headers"]["Authorization"], "Bearer test-key")
        self.assertEqual(response["choices"][0]["message"]["content"], "Ready")

    def test_anthropic_adapter_round_trips_tool_calls(self) -> None:
        captured = {}

        def fake_request(url, body, headers, label):
            captured.update(url=url, body=body, headers=headers, label=label)
            return {
                "id": "msg_test",
                "model": "claude-sonnet-4-5",
                "content": [
                    {"type": "text", "text": "I will inspect it."},
                    {"type": "tool_use", "id": "tool_1", "name": "project_search", "input": {"query": "Arena"}},
                ],
            }

        self.app.providers._json_request = fake_request
        response = self.app.providers.request(MESSAGES, TOOLS, "claude-sonnet-4-5", "anthropic")

        self.assertEqual(captured["url"], "https://api.anthropic.com/v1/messages")
        self.assertEqual(captured["headers"]["x-api-key"], "test-key")
        self.assertEqual(captured["body"]["tools"][0]["input_schema"], TOOLS[0]["function"]["parameters"])
        message = response["choices"][0]["message"]
        self.assertEqual(message["content"], "I will inspect it.")
        self.assertEqual(message["tool_calls"][0]["function"]["name"], "project_search")
        self.assertEqual(json.loads(message["tool_calls"][0]["function"]["arguments"]), {"query": "Arena"})

    def test_public_settings_never_expose_provider_key(self) -> None:
        self.app.settings.update({"provider": "openrouter", "model": "openrouter/auto"})
        public = self.app.public_settings()

        self.assertTrue(public["key_set"])
        self.assertNotIn("api_key", public)
        self.assertNotIn("test-key", json.dumps(public))

    def test_local_provider_is_restricted_to_this_computer(self) -> None:
        with self.assertRaisesRegex(ValueError, "localhost"):
            self.app.save_settings(provider="local", endpoint="https://remote.example/v1")


if __name__ == "__main__":
    unittest.main(verbosity=2)
