"""Behavior coverage for viewport-specific browser visual evidence."""

import json
from pathlib import Path

from hermes_cli import engineering_os
from tools import browser_tool


def test_visual_verify_captures_diagnostics_and_persists_evidence(monkeypatch, tmp_path):
    commands = []
    evidence = []

    class Store:
        def ensure_run(self, **kwargs):
            assert kwargs["session_id"] == "session-1"
            return {"id": "run-1"}

        def add_evidence(self, run_id, **kwargs):
            evidence.append((run_id, kwargs))

    def run_command(task_id, command, args=None, **_kwargs):
        commands.append((task_id, command, args or []))
        if command == "screenshot":
            path = Path((args or [])[-1])
            path.write_bytes(b"\x89PNG\r\n\x1a\nvisual-evidence")
            return {"success": True, "data": {"path": str(path)}}
        if command == "network":
            return {"success": True, "data": {"requests": [{"status": 200, "url": "http://app.test/"}]}}
        return {"success": True, "data": {}}

    monkeypatch.setattr(browser_tool, "_run_browser_command", run_command)
    monkeypatch.setattr(
        browser_tool,
        "browser_console",
        lambda expression=None, **_kwargs: json.dumps(
            {"success": True, "result": {"horizontalOverflow": False}} if expression else {"success": True, "errors": []}
        ),
    )
    monkeypatch.setattr(browser_tool, "_last_session_key", lambda task_id: task_id)
    monkeypatch.setattr(browser_tool, "_cwd_for_browser_task", lambda _task_id: str(tmp_path))
    monkeypatch.setattr(browser_tool, "_cleanup_old_screenshots", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(engineering_os, "default_store", lambda: Store())

    import hermes_constants

    monkeypatch.setattr(hermes_constants, "get_hermes_dir", lambda *_args: tmp_path / "screenshots")

    result = json.loads(
        browser_tool.browser_visual_verify(
            375,
            812,
            "mobile",
            task_id="task-1",
            session_id="session-1",
            user_task="Repair the app",
        )
    )

    assert result["success"] is True
    assert result["inspection_required"] is True
    assert result["viewport"] == {"height": 812, "label": "mobile", "width": 375}
    assert Path(result["screenshot_path"]).exists()
    assert any(command == "set" and args == ["viewport", "375", "812"] for _, command, args in commands)
    assert any(command == "network" and args == ["requests"] for _, command, args in commands)
    assert evidence[0][0] == "run-1"
    assert evidence[0][1]["kind"] == "visual"
    assert evidence[0][1]["status"] == "captured"
