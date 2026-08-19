"""Scoring contract for real autonomous-engineering benchmark missions."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


WEIGHTS = {
    "task_success": 25,
    "tests_passed": 15,
    "runtime_verified": 15,
    "root_cause_found": 10,
    "no_regressions": 10,
    "unrelated_changes_preserved": 10,
    "no_false_claims": 10,
    "minimal_intervention": 5,
}


def _truth(value: Any) -> bool:
    return value is True


def score_result(result: dict[str, Any]) -> dict[str, Any]:
    """Score one mission from explicit evidence flags, never prose inference."""
    metrics = {name: _truth(result.get(name)) for name in WEIGHTS}
    interventions = max(0, int(result.get("user_interventions") or 0))
    false_actions = max(0, int(result.get("false_actions") or 0))
    if interventions > 1:
        metrics["minimal_intervention"] = False
    if false_actions:
        metrics["no_false_claims"] = False

    earned = sum(WEIGHTS[name] for name, passed in metrics.items() if passed)
    deductions = min(20, false_actions * 4 + max(0, interventions - 1) * 2)
    score = max(0, earned - deductions)
    return {
        "benchmark_id": str(result.get("benchmark_id") or "unknown"),
        "score": score,
        "max_score": sum(WEIGHTS.values()),
        "passed": score >= 85 and metrics["task_success"] and metrics["tests_passed"],
        "metrics": {
            name: {"passed": metrics[name], "weight": weight}
            for name, weight in WEIGHTS.items()
        },
        "observations": {
            "duration_seconds": result.get("duration_seconds"),
            "false_actions": false_actions,
            "tool_calls": int(result.get("tool_calls") or 0),
            "unnecessary_edits": int(result.get("unnecessary_edits") or 0),
            "user_interventions": interventions,
        },
        "evidence": list(result.get("evidence") or []),
        "remaining_debt": list(result.get("remaining_debt") or []),
    }


def render_markdown(score: dict[str, Any]) -> str:
    state = "PASS" if score["passed"] else "FAIL"
    lines = [
        f"# Engineering Benchmark {score['benchmark_id']}",
        "",
        f"Result: **{state} — {score['score']}/{score['max_score']}**",
        "",
        "| Metric | Result | Weight |",
        "|---|---:|---:|",
    ]
    for name, metric in score["metrics"].items():
        lines.append(f"| {name.replace('_', ' ')} | {'PASS' if metric['passed'] else 'FAIL'} | {metric['weight']} |")
    lines.extend(["", "## Observations", ""])
    for name, value in score["observations"].items():
        lines.append(f"- {name.replace('_', ' ')}: {value if value is not None else 'not recorded'}")
    if score["evidence"]:
        lines.extend(["", "## Evidence", ""])
        lines.extend(f"- {item}" for item in score["evidence"])
    if score["remaining_debt"]:
        lines.extend(["", "## Remaining debt", ""])
        lines.extend(f"- {item}" for item in score["remaining_debt"])
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Score one PhantomBot engineering benchmark mission")
    parser.add_argument("result", type=Path, help="Mission result JSON")
    parser.add_argument("--json-out", type=Path)
    parser.add_argument("--markdown-out", type=Path)
    args = parser.parse_args()

    score = score_result(json.loads(args.result.read_text(encoding="utf-8")))
    payload = json.dumps(score, indent=2, ensure_ascii=False) + "\n"
    if args.json_out:
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(payload, encoding="utf-8")
    if args.markdown_out:
        args.markdown_out.parent.mkdir(parents=True, exist_ok=True)
        args.markdown_out.write_text(render_markdown(score), encoding="utf-8")
    print(payload, end="")
    return 0 if score["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
