from pathlib import Path

from hermes_cli.engineering_os import EngineeringStore


def test_run_task_evidence_memory_and_tool_result_round_trip(tmp_path: Path):
    store = EngineeringStore(tmp_path / "engineering.db")
    project = tmp_path / "project"
    project.mkdir()

    run = store.create_run(title="Repair the demo", goal="Fix and verify", cwd=str(project), session_id="session-1")
    task = store.add_task(run["id"], "Find the defect", assigned_agent="primary")
    subtask = store.add_task(run["id"], "Reproduce it", parent_id=task["id"])
    store.update_task(task["id"], status="running")
    store.update_task(subtask["id"], status="succeeded", result="Reproduced")

    run_id = store.record_tool_result(
        result_id="call-1",
        tool_name="terminal",
        status="ok",
        duration_ms=120,
        result_size=42,
        started_at=10.0,
        finished_at=10.12,
        session_id="session-1",
        user_task="Repair the demo",
        cwd=str(project),
        evidence={"backend": "test"},
    )
    evidence = store.add_evidence(
        run["id"], kind="test", label="Unit tests", status="passed", command="tests"
    )
    memory = store.add_memory(
        run["project_key"], kind="decision", content="Preserve explicit user choices", source_run_id=run["id"]
    )
    store.update_run(run["id"], status="succeeded", summary="Fixed and verified")

    hydrated = store.get_run(run["id"])

    assert run_id == run["id"]
    assert hydrated is not None
    assert hydrated["status"] == "succeeded"
    assert [item["title"] for item in hydrated["tasks"]] == ["Find the defect", "Reproduce it"]
    assert hydrated["tool_results"][0]["tool_name"] == "terminal"
    assert hydrated["evidence"][0]["id"] == evidence["id"]
    assert store.search_memory(run["project_key"], "explicit")[0]["id"] == memory["id"]


def test_repository_index_supports_file_and_symbol_search(tmp_path: Path):
    store = EngineeringStore(tmp_path / "engineering.db")
    repo = tmp_path / "repo"
    (repo / "src").mkdir(parents=True)
    (repo / "src" / "service.py").write_text(
        "class PhantomService:\n    def repair_provider(self):\n        return True\n",
        encoding="utf-8",
    )
    (repo / "src" / "panel.tsx").write_text(
        "export interface RunPanelProps {}\nexport function RunPanel() { return null }\n",
        encoding="utf-8",
    )
    (repo / "node_modules").mkdir()
    (repo / "node_modules" / "noise.ts").write_text("export const Noise = true\n", encoding="utf-8")

    result = store.index_repository(str(repo))

    assert result["status"] == "ready"
    assert result["file_count"] == 2
    assert result["symbol_count"] >= 4
    assert store.search_symbols(str(repo), "repair_provider")[0]["path"] == "src/service.py"
    assert store.search_symbols(str(repo), "RunPanel")[0]["kind"] == "function"
    assert store.search_files(str(repo), "panel")[0]["path"] == "src/panel.tsx"


def test_custom_explicit_run_statuses_are_validated(tmp_path: Path):
    store = EngineeringStore(tmp_path / "engineering.db")
    project = tmp_path / "project"
    project.mkdir()
    run = store.create_run(title="Demo", cwd=str(project))

    try:
        store.update_run(run["id"], status="pretending")
    except ValueError as exc:
        assert "invalid run status" in str(exc)
    else:
        raise AssertionError("invalid status should be rejected")


def test_finalize_active_runs_closes_session_and_task_keyed_records(tmp_path: Path):
    store = EngineeringStore(tmp_path / "engineering.db")
    project = tmp_path / "project"
    project.mkdir()
    session_run = store.create_run(
        title="Session record",
        cwd=str(project),
        session_id="session-1",
        task_id="task-1",
        status="running",
    )
    task_run = store.create_run(
        title="Early task record",
        cwd=str(project),
        task_id="task-1",
        status="verifying",
    )
    unrelated_run = store.create_run(
        title="Other work",
        cwd=str(project),
        session_id="session-2",
        status="running",
    )

    finalized = store.finalize_active_runs(
        session_id="session-1",
        task_id="task-1",
        status="succeeded",
        summary="Fixed and independently verified",
    )

    assert {run["id"] for run in finalized} == {session_run["id"], task_run["id"]}
    assert all(run["status"] == "succeeded" for run in finalized)
    assert all(run["completed_at"] is not None for run in finalized)
    assert all(run["summary"] == "Fixed and independently verified" for run in finalized)
    assert store.get_run(unrelated_run["id"])["status"] == "running"


def test_finalize_active_runs_requires_terminal_status(tmp_path: Path):
    store = EngineeringStore(tmp_path / "engineering.db")

    try:
        store.finalize_active_runs(session_id="session-1", status="running")
    except ValueError as exc:
        assert "terminal run status" in str(exc)
    else:
        raise AssertionError("non-terminal status should be rejected")
