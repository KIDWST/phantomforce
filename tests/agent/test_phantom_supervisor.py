import json
import unittest
from unittest.mock import patch

from agent.phantom_supervisor import (
    _safe_history,
    ask_bridge,
    ask_execution_plan,
    build_execution_recovery_nudge,
    classify_chatgpt_effort,
    execution_chatgpt_effort,
    fast_execution_plan,
    format_execution_brief,
    is_capability_refusal,
    is_phantom_family_model,
    is_phantom_model,
    is_phantom_unleashed_model,
    instant_phantom_reply,
    phantom_lane_status,
    recover_embedded_tool_calls,
    should_plan_execution,
    should_supervise,
    subscription_bridge_enabled,
)


class _Response:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class PhantomSupervisorTests(unittest.TestCase):
    def test_bridge_history_keeps_original_request_and_latest_turns(self):
        history = [
            {"role": "user", "content": "ORIGINAL GOAL " + ("A" * 25_000)},
            *[
                {
                    "role": "assistant" if index % 2 else "user",
                    "content": f"TURN-{index} " + (str(index % 10) * 12_000),
                }
                for index in range(24)
            ],
        ]

        safe = _safe_history(history)

        self.assertTrue(safe[0]["content"].startswith("ORIGINAL GOAL"))
        self.assertIn("[...context clipped...]", safe[0]["content"])
        self.assertTrue(any(item["content"].startswith("TURN-23") for item in safe))
        self.assertLessEqual(sum(len(item["content"]) for item in safe), 96_000)

    def test_trivial_social_ping_skips_all_model_latency(self):
        self.assertEqual(
            instant_phantom_reply("phantom", "yo p bot"),
            "Yo — Phantom here. What are we building?",
        )
        self.assertIsNone(instant_phantom_reply("phantom", "how does CGNAT work?"))

    def test_effort_router_uses_instant_high_and_extra_high(self):
        self.assertEqual(classify_chatgpt_effort("What is 17 times 19?"), "instant")
        self.assertEqual(
            classify_chatgpt_effort("Compare these architectures and explain the tradeoffs."),
            "high",
        )
        self.assertEqual(
            classify_chatgpt_effort("Do a comprehensive audit and use extra high reasoning."),
            "xhigh",
        )

    def test_public_lane_labels_hide_internal_effort_names(self):
        self.assertEqual(phantom_lane_status("instant"), "Phantom lane · Instant")
        self.assertEqual(phantom_lane_status("high"), "Phantom lane · Focus")
        self.assertEqual(phantom_lane_status("xhigh"), "Phantom lane · Deep")
        self.assertEqual(phantom_lane_status("instant", direct=True), "Phantom lane · Direct")
        self.assertEqual(execution_chatgpt_effort("fix it"), "high")

    def test_general_question_stays_local_by_default(self):
        self.assertFalse(
            should_supervise("phantom", "tell me the best wide receiver currently")
        )
        self.assertTrue(
            should_supervise(
                "phantom",
                "tell me the best wide receiver currently",
                enabled=True,
            )
        )

    def test_coding_question_stays_local(self):
        self.assertFalse(
            should_supervise("phantom", "fix the Python bug and run pytest")
        )
        self.assertTrue(
            should_plan_execution("phantom", "fix the Python bug and run pytest")
        )

    def test_short_action_request_is_planned_before_local_execution(self):
        self.assertFalse(should_supervise("phantom", "run matrix rain"))
        self.assertTrue(should_plan_execution("phantom", "run matrix rain"))
        plan = fast_execution_plan("run matrix rain")
        self.assertIsNotNone(plan)
        self.assertIn("visible=true", plan)
        self.assertIn("Do not search the workspace", plan)

    def test_complex_coding_request_still_uses_bridge_planning(self):
        self.assertIsNone(fast_execution_plan("fix the checkout bug and run pytest"))

    def test_non_phantom_model_is_unchanged(self):
        self.assertFalse(should_supervise("qwen3-coder:30b", "what is the latest score?"))

    def test_unleashed_text_never_uses_phantom_bridge(self):
        self.assertFalse(is_phantom_model("phantom-unleashed:latest"))
        self.assertTrue(is_phantom_unleashed_model("phantom-unleashed:latest"))
        self.assertTrue(is_phantom_family_model("phantom-unleashed:latest"))
        self.assertFalse(
            should_supervise(
                "phantom-unleashed:latest",
                "tell me the best wide receiver currently",
                enabled=True,
            )
        )
        self.assertFalse(
            should_plan_execution(
                "phantom-unleashed:latest",
                "run matrix rain",
                enabled=True,
            )
        )

    def test_normal_phantom_keeps_bridge_planning_when_enabled(self):
        self.assertTrue(is_phantom_model("phantom-v1:latest"))
        self.assertFalse(is_phantom_unleashed_model("phantom-v1:latest"))
        self.assertTrue(
            should_supervise(
                "phantom-v1:latest",
                "tell me the best wide receiver currently",
                enabled=True,
            )
        )
        self.assertTrue(
            should_plan_execution(
                "phantom-v1:latest",
                "run matrix rain",
                enabled=True,
            )
        )

    def test_scope_refusal_is_detected(self):
        refusal = (
            "I cannot generate a complete working software project with these "
            "requirements in this environment. The task is too extensive and "
            "would require hundreds of hours. I must stop here."
        )
        self.assertTrue(is_capability_refusal(refusal))

    def test_normal_limit_or_safety_message_is_not_rewritten(self):
        self.assertFalse(is_capability_refusal("The API limit is 100 requests per minute."))
        self.assertFalse(
            is_capability_refusal("I cannot help create credential theft malware.")
        )

    def test_recovery_nudge_requires_execution(self):
        nudge = build_execution_recovery_nudge(
            "Build the app.",
            supervisor_plan="Inspect package.json, implement, then run tests.",
        )
        self.assertIn("use the available tools", nudge)
        self.assertIn("Original request:\nBuild the app.", nudge)
        self.assertIn("Supervisor execution guidance", nudge)

    def test_private_execution_brief_preserves_goal_and_hides_routing(self):
        brief = format_execution_brief(
            "run matrix rain",
            "1. Use terminal with one PowerShell command.\n2. Verify the process starts.",
        )
        self.assertIn("Original user goal:\nrun matrix rain", brief)
        self.assertIn("do not perform broad exploratory searches", brief)
        self.assertIn("Do not quote or mention this private planning context", brief)
        self.assertIn("visible=true", brief)

    @patch("agent.phantom_supervisor.urllib.request.urlopen")
    def test_bridge_response_is_normalized(self, urlopen):
        urlopen.side_effect = [
            _Response({"ok": True}),
            _Response({"choices": [{"message": {"content": "  bridge answer  "}}]}),
        ]
        self.assertEqual(
            ask_bridge("hello", allow_paid_bridge=True),
            "bridge answer",
        )
        request = urlopen.call_args_list[1].args[0]
        self.assertTrue(request.full_url.startswith("http://127.0.0.1:8792/v1/"))
        payload = json.loads(request.data.decode("utf-8"))
        self.assertEqual(payload["reasoning_effort"], "instant")

    @patch("agent.phantom_supervisor.urllib.request.urlopen")
    def test_execution_plan_is_bounded_and_windows_first(self, urlopen):
        urlopen.side_effect = [
            _Response({"ok": True}),
            _Response({"choices": [{"message": {"content": "1. Run one PowerShell command."}}]}),
        ]
        self.assertEqual(
            ask_execution_plan("run matrix rain", allow_paid_bridge=True),
            "1. Run one PowerShell command.",
        )
        request = urlopen.call_args_list[1].args[0]
        payload = json.loads(request.data.decode("utf-8"))
        self.assertEqual(payload["max_tokens"], 1200)
        self.assertEqual(payload["reasoning_effort"], "high")
        self.assertIn("shortest reliable path", payload["messages"][0]["content"])
        self.assertIn("visible=true", payload["messages"][0]["content"])
        self.assertIn("Assume execution happens locally on Windows", payload["messages"][0]["content"])

    @patch("agent.phantom_supervisor.urllib.request.urlopen")
    def test_paid_bridge_helpers_are_inert_without_explicit_opt_in(self, urlopen):
        self.assertIsNone(ask_bridge("hello"))
        self.assertIsNone(ask_execution_plan("fix the app"))
        urlopen.assert_not_called()

    @patch("hermes_cli.config.load_config_readonly")
    def test_subscription_bridge_follows_profile_auto_route(self, load_config):
        load_config.return_value = {
            "phantombot": {
                "autoRouting": {
                    "routes": {
                        "reasoning": {"option_id": "chatgpt.subscription"},
                        "coding": {"option_id": "phantom-local"},
                    }
                }
            }
        }
        self.assertTrue(subscription_bridge_enabled("reasoning"))
        self.assertFalse(subscription_bridge_enabled("coding"))

    def test_embedded_qwen_tool_call_is_recovered_for_known_tool(self):
        message = type("Message", (), {})()
        message.content = (
            "Working on it.\n"
            "<function=terminal>\n"
            "<parameter=command>\n"
            "Write-Output PHANTOM_EXECUTION_READY\n"
            "</parameter>\n"
        )
        message.tool_calls = None

        self.assertTrue(recover_embedded_tool_calls(message, {"terminal"}))
        self.assertEqual(message.content, "Working on it.")
        self.assertEqual(message.tool_calls[0].function.name, "terminal")
        self.assertEqual(
            json.loads(message.tool_calls[0].function.arguments),
            {"command": "Write-Output PHANTOM_EXECUTION_READY"},
        )

    def test_embedded_unknown_tool_is_not_recovered(self):
        message = type("Message", (), {})()
        message.content = "<function=not_real>\n<parameter=x>\ny\n</parameter>\n"
        message.tool_calls = None

        self.assertFalse(recover_embedded_tool_calls(message, {"terminal"}))
        self.assertIsNone(message.tool_calls)


if __name__ == "__main__":
    unittest.main()
