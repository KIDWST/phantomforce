from hermes_cli.engineering_benchmark import render_markdown, score_result


def test_engineering_benchmark_requires_evidence_for_pass():
    score = score_result({"benchmark_id": "FULL-001", "task_success": True, "tests_passed": True})
    assert score["passed"] is False
    assert score["score"] == 40


def test_engineering_benchmark_scores_a_verified_low_intervention_run():
    result = {
        "benchmark_id": "FULL-001",
        "task_success": True,
        "tests_passed": True,
        "runtime_verified": True,
        "root_cause_found": True,
        "no_regressions": True,
        "unrelated_changes_preserved": True,
        "no_false_claims": True,
        "minimal_intervention": True,
        "user_interventions": 0,
        "false_actions": 0,
        "evidence": ["tests: pass", "mobile screenshot: pass"],
    }
    score = score_result(result)
    assert score["passed"] is True
    assert score["score"] == 100
    report = render_markdown(score)
    assert "PASS — 100/100" in report
    assert "mobile screenshot: pass" in report
