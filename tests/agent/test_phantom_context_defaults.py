from agent.agent_init import _default_continuity_tail_user_messages


def test_phantom_routes_preserve_three_recent_user_intents_by_default():
    assert _default_continuity_tail_user_messages("phantom", "phantom") == 3
    assert _default_continuity_tail_user_messages("custom:phantom", "Dadgpt-default") == 3
    assert _default_continuity_tail_user_messages("kimi-k3-direct", "kimi-k3-hf:latest") == 3


def test_non_phantom_routes_keep_upstream_single_intent_default():
    assert _default_continuity_tail_user_messages("anthropic", "claude-sonnet-5") == 1
