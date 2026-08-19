from agent.codex_runtime import _is_terminal_codex_context_or_usage_error


def test_codex_context_overflow_and_compaction_exhaustion_are_terminal():
    assert _is_terminal_codex_context_or_usage_error(
        "Context length exceeded (9,514,560 tokens). Cannot compress further."
    )


def test_codex_hosted_429_usage_limit_is_terminal():
    assert _is_terminal_codex_context_or_usage_error(
        "HTTP 429: The usage limit has been reached"
    )


def test_unrelated_codex_error_is_not_terminal_context_or_usage():
    assert not _is_terminal_codex_context_or_usage_error(
        "codex app-server subprocess exited unexpectedly"
    )
