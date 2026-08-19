from tools.tool_bus import ToolResultBus


def test_tool_result_bus_publishes_one_typed_result(monkeypatch, tmp_path):
    recorded = {}

    class Store:
        def record_tool_result(self, **kwargs):
            recorded.update(kwargs)
            return "run-1"

    monkeypatch.setattr("hermes_cli.engineering_os.default_store", lambda: Store())
    bus = ToolResultBus()
    observed = []
    bus.subscribe(observed.append)

    result = bus.publish(
        tool_name="terminal",
        result='{"ok": true}',
        started_at=0.0,
        kwargs={"session_id": "session-1", "task_id": "task-1", "tool_call_id": "call-1"},
    )

    assert result.id == "call-1"
    assert result.status == "ok"
    assert result.run_id == "run-1"
    assert result.evidence == {"backend": "registry"}
    assert observed == [result]
    assert recorded["tool_name"] == "terminal"


def test_tool_result_bus_normalizes_structured_errors(monkeypatch):
    class Store:
        def record_tool_result(self, **kwargs):
            return None

    monkeypatch.setattr("hermes_cli.engineering_os.default_store", lambda: Store())
    bus = ToolResultBus()

    result = bus.publish(
        tool_name="repository_index",
        result='{"error": "index failed", "code": "index_error"}',
        started_at=0.0,
        kwargs={"tool_call_id": "call-error"},
    )

    assert result.status == "error"
    assert result.error_code == "index_error"
