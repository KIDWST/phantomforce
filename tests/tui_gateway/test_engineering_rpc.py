"""Behavior coverage for the engineering workbench RPC surface."""

from hermes_cli import engineering_os
from hermes_cli.engineering_os import EngineeringStore
from tui_gateway import server


def _request(method: str, **params):
    return server.handle_request({"id": method, "method": method, "params": params})


def test_engineering_run_list_and_detail_rpc(monkeypatch, tmp_path):
    store = EngineeringStore(tmp_path / "engineering.db")
    monkeypatch.setattr(engineering_os, "default_store", lambda: store)
    run = store.create_run(title="Repair app", goal="Make it pass", cwd=str(tmp_path), status="running")
    task = store.add_task(run["id"], "Inspect failure")
    store.add_task(run["id"], "Fix root cause", parent_id=task["id"])
    store.add_evidence(run["id"], kind="test", label="Unit tests", status="passed")

    listed = _request("engineering.runs")
    assert listed["result"]["runs"][0]["id"] == run["id"]

    detail = _request("engineering.run", run_id=run["id"])
    assert detail["result"]["run"]["title"] == "Repair app"
    assert len(detail["result"]["run"]["tasks"]) == 2
    assert detail["result"]["run"]["evidence"][0]["status"] == "passed"

    invalid = _request("engineering.run")
    assert invalid["error"]["code"] == -32602


def test_engineering_repository_and_memory_rpc(monkeypatch, tmp_path):
    store = EngineeringStore(tmp_path / "engineering.db")
    monkeypatch.setattr(engineering_os, "default_store", lambda: store)
    (tmp_path / "sample.py").write_text("def repair_widget():\n    return True\n", encoding="utf-8")

    indexed = _request("engineering.repo_index", cwd=str(tmp_path))
    assert indexed["result"]["index"]["file_count"] >= 1

    status = _request("engineering.repo_status", cwd=str(tmp_path))
    assert status["result"]["index"]["status"] == "ready"

    symbols = _request("engineering.repo_symbols", cwd=str(tmp_path), query="repair")
    assert symbols["result"]["matches"][0]["name"] == "repair_widget"

    memory = store.add_memory("project:test", kind="decision", content="Keep the provider split visible")
    assert memory["kind"] == "decision"
    memories = _request("engineering.memory", project_key="project:test", query="provider")
    assert memories["result"]["memories"][0]["content"] == "Keep the provider split visible"
