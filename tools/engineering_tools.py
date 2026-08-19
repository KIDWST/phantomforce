"""Agent-facing controls for durable engineering runs and repo intelligence."""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any, Optional

from hermes_cli.engineering_os import EngineeringStore, default_store
from tools.registry import registry


def _out(**payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, default=str)


def _cwd(args: dict[str, Any], task_id: Optional[str]) -> str:
    requested = str(args.get("cwd") or "").strip()
    if requested:
        return str(Path(requested).expanduser().resolve())
    try:
        from tools.terminal_tool import resolve_task_overrides

        resolved = str(resolve_task_overrides(task_id or "").get("cwd") or "").strip()
        if resolved:
            return str(Path(resolved).expanduser().resolve())
    except Exception:
        pass
    return os.getcwd()


def _latest_run(store: EngineeringStore, session_id: str, task_id: str) -> Optional[dict[str, Any]]:
    for run in store.list_runs(limit=100):
        if session_id and run.get("session_id") == session_id:
            return run
        if task_id and run.get("task_id") == task_id:
            return run
    return None


def engineering_run(args: dict[str, Any], **kw: Any) -> str:
    store = default_store()
    action = str(args.get("action") or "status")
    session_id = str(kw.get("session_id") or "")
    task_id = str(kw.get("task_id") or "")

    try:
        if action == "create":
            run = store.create_run(
                title=str(args.get("title") or "Engineering run"),
                goal=str(args.get("goal") or ""),
                cwd=_cwd(args, task_id),
                session_id=session_id,
                task_id=task_id,
                status="planning",
            )
            return _out(success=True, run=run)
        if action == "list":
            return _out(success=True, runs=store.list_runs(project_key=str(args.get("project_key") or "")))

        run_id = str(args.get("run_id") or "")
        run = store.get_run(run_id) if run_id else _latest_run(store, session_id, task_id)
        if run is None:
            return _out(success=False, error="run not found")
        run_id = str(run["id"])

        if action == "status":
            return _out(success=True, run=store.get_run(run_id))
        if action in {"add_task", "add_subtask"}:
            task = store.add_task(
                run_id,
                str(args.get("title") or "Task"),
                parent_id=str(args.get("parent_id") or "") or None,
                assigned_agent=str(args.get("assigned_agent") or ""),
                position=int(args.get("position") or 0),
            )
            return _out(success=True, task=task, run=store.get_run(run_id))
        if action == "update_task":
            task = store.update_task(
                str(args.get("task_record_id") or ""),
                status=str(args.get("status") or "running"),
                result=str(args.get("result") or ""),
            )
            return _out(success=True, task=task, run=store.get_run(run_id))
        if action == "update":
            updated = store.update_run(
                run_id,
                status=str(args.get("status") or run["status"]),
                summary=str(args.get("summary") or ""),
            )
            return _out(success=True, run=updated)
        return _out(success=False, error=f"unknown action: {action}")
    except (OSError, ValueError) as exc:
        return _out(success=False, error=str(exc))


def repository_index(args: dict[str, Any], **kw: Any) -> str:
    store = default_store()
    action = str(args.get("action") or "status")
    root = _cwd(args, str(kw.get("task_id") or ""))
    try:
        if action == "index":
            return _out(success=True, index=store.index_repository(root))
        if action == "status":
            return _out(success=True, index=store.repo_status(root))
        if action == "search_symbols":
            return _out(
                success=True,
                matches=store.search_symbols(root, str(args.get("query") or ""), int(args.get("limit") or 50)),
            )
        if action == "search_files":
            return _out(
                success=True,
                matches=store.search_files(root, str(args.get("query") or ""), int(args.get("limit") or 100)),
            )
        return _out(success=False, error=f"unknown action: {action}")
    except (OSError, ValueError) as exc:
        return _out(success=False, error=str(exc))


def project_discover(args: dict[str, Any], **kw: Any) -> str:
    """Expose the existing profile-local repo discovery cache to the agent."""
    try:
        from hermes_cli import projects_db

        with projects_db.connect_closing() as conn:
            repos = projects_db.list_discovered_repos(conn)
            projects = [project.to_dict() for project in projects_db.list_projects(conn)]
        return _out(success=True, projects=projects, repositories=repos)
    except Exception as exc:
        return _out(success=False, error=str(exc))


def _git_head(cwd: str) -> str:
    try:
        result = subprocess.run(
            ["git", "-C", cwd, "rev-parse", "HEAD"],
            capture_output=True,
            check=False,
            text=True,
            timeout=15,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    return result.stdout.strip() if result.returncode == 0 else ""


def engineering_changeset(args: dict[str, Any], **kw: Any) -> str:
    from tools.checkpoint_manager import CheckpointManager

    store = default_store()
    action = str(args.get("action") or "list")
    cwd = _cwd(args, str(kw.get("task_id") or ""))
    run_id = str(args.get("run_id") or "") or None
    manager = CheckpointManager(enabled=True)
    try:
        if action == "create":
            manager.new_turn()
            manager.ensure_checkpoint(cwd, str(args.get("reason") or "engineering changeset baseline"))
            checkpoints = manager.list_checkpoints(cwd)
            checkpoint_hash = str(checkpoints[0].get("hash") or "") if checkpoints else ""
            change = store.create_changeset(
                cwd=cwd,
                run_id=run_id,
                checkpoint_hash=checkpoint_hash,
                baseline_head=_git_head(cwd),
            )
            return _out(success=bool(checkpoint_hash), changeset=change, checkpoint=checkpoints[0] if checkpoints else None)

        change_id = str(args.get("changeset_id") or "")
        run = store.get_run(run_id) if run_id else _latest_run(
            store, str(kw.get("session_id") or ""), str(kw.get("task_id") or "")
        )
        changes = list((run or {}).get("changesets") or [])
        change = next((item for item in changes if item.get("id") == change_id), None)
        if action == "list":
            return _out(success=True, changesets=changes)
        if change is None:
            return _out(success=False, error="changeset not found")
        checkpoint_hash = str(change.get("checkpoint_hash") or "")
        change_cwd = str(change.get("cwd") or cwd)
        if action == "diff":
            result = manager.diff(change_cwd, checkpoint_hash)
            if result.get("success"):
                store.update_changeset(change_id, diff_stat=str(result.get("stat") or ""))
            return _out(changeset=store.get_run(str(change.get("run_id") or "")), **result)
        if action == "complete":
            updated = store.update_changeset(
                change_id,
                status=str(args.get("status") or "applied"),
                diff_stat=str(args.get("diff_stat") or ""),
                files=[str(item) for item in (args.get("files") or [])],
            )
            return _out(success=True, changeset=updated)
        if action == "rollback":
            if args.get("confirm") is not True:
                return _out(success=False, error="rollback requires confirm=true")
            result = manager.restore(change_cwd, checkpoint_hash, str(args.get("file") or "") or None)
            if result.get("success"):
                store.update_changeset(change_id, status="rolled_back")
            return _out(changeset_id=change_id, **result)
        return _out(success=False, error=f"unknown action: {action}")
    except (OSError, ValueError) as exc:
        return _out(success=False, error=str(exc))


def engineering_evidence(args: dict[str, Any], **kw: Any) -> str:
    store = default_store()
    action = str(args.get("action") or "status")
    run_id = str(args.get("run_id") or "")
    try:
        if not run_id:
            latest = _latest_run(store, str(kw.get("session_id") or ""), str(kw.get("task_id") or ""))
            run_id = str((latest or {}).get("id") or "")
        if not run_id:
            return _out(success=False, error="run not found")
        if action == "status":
            return _out(success=True, run=store.get_run(run_id))
        if action == "add":
            evidence = store.add_evidence(
                run_id,
                kind=str(args.get("kind") or "observation"),
                label=str(args.get("label") or "Evidence"),
                status=str(args.get("status") or "unknown"),
                task_id=str(args.get("task_record_id") or ""),
                command=str(args.get("command") or ""),
                path=str(args.get("path") or ""),
                details=args.get("details") if isinstance(args.get("details"), dict) else {},
            )
            return _out(success=True, evidence=evidence)
        if action == "capture_verification":
            from agent.verification_evidence import verification_status

            cwd = _cwd(args, str(kw.get("task_id") or ""))
            verification = verification_status(
                session_id=str(kw.get("session_id") or ""),
                cwd=cwd,
            )
            evidence = store.add_evidence(
                run_id,
                kind="verification",
                label=str(args.get("label") or "Verification status"),
                status=str(verification.get("status") or "unknown"),
                details=verification,
            )
            return _out(success=True, verification=verification, evidence=evidence)
        return _out(success=False, error=f"unknown action: {action}")
    except (OSError, ValueError) as exc:
        return _out(success=False, error=str(exc))


def engineering_memory(args: dict[str, Any], **kw: Any) -> str:
    store = default_store()
    action = str(args.get("action") or "search")
    project_key = str(args.get("project_key") or "").strip()
    run_id = str(args.get("run_id") or "")
    if not project_key and run_id:
        project_key = str((store.get_run(run_id) or {}).get("project_key") or "")
    if not project_key:
        project_key = os.path.normcase(_cwd(args, str(kw.get("task_id") or "")))
    try:
        if action == "add":
            memory = store.add_memory(
                project_key,
                kind=str(args.get("kind") or "decision"),
                content=str(args.get("content") or ""),
                source_run_id=run_id,
            )
            return _out(success=True, memory=memory)
        if action == "search":
            return _out(
                success=True,
                memories=store.search_memory(project_key, str(args.get("query") or ""), int(args.get("limit") or 50)),
            )
        return _out(success=False, error=f"unknown action: {action}")
    except (OSError, ValueError) as exc:
        return _out(success=False, error=str(exc))


_RUN_SCHEMA = {
    "name": "engineering_run",
    "description": "Create, plan, inspect, and finish a durable engineering Run with nested tasks.",
    "parameters": {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["create", "list", "status", "add_task", "add_subtask", "update_task", "update"]},
            "run_id": {"type": "string"},
            "task_record_id": {"type": "string"},
            "parent_id": {"type": "string"},
            "title": {"type": "string"},
            "goal": {"type": "string"},
            "status": {"type": "string"},
            "summary": {"type": "string"},
            "result": {"type": "string"},
            "assigned_agent": {"type": "string"},
            "cwd": {"type": "string"},
            "project_key": {"type": "string"},
            "position": {"type": "integer"},
        },
        "required": ["action"],
    },
}

registry.register(name="engineering_run", toolset="project", schema=_RUN_SCHEMA, handler=engineering_run, emoji="🧭")
registry.register(
    name="project_discover",
    toolset="project",
    schema={
        "name": "project_discover",
        "description": "List durable Projects and repositories found by the desktop discovery scan.",
        "parameters": {"type": "object", "properties": {}},
    },
    handler=project_discover,
    emoji="🗂️",
)
registry.register(
    name="repository_index",
    toolset="project",
    schema={
        "name": "repository_index",
        "description": "Build or query the durable file/symbol index for a repository.",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["index", "status", "search_symbols", "search_files"]},
                "cwd": {"type": "string"},
                "query": {"type": "string"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 500},
            },
            "required": ["action"],
        },
    },
    handler=repository_index,
    emoji="🔎",
    max_result_size_chars=120_000,
)
registry.register(
    name="engineering_changeset",
    toolset="project",
    schema={
        "name": "engineering_changeset",
        "description": "Create a checkpointed ChangeSet, inspect its diff, mark it complete, or explicitly roll it back.",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["create", "list", "diff", "complete", "rollback"]},
                "run_id": {"type": "string"},
                "changeset_id": {"type": "string"},
                "cwd": {"type": "string"},
                "reason": {"type": "string"},
                "status": {"type": "string"},
                "diff_stat": {"type": "string"},
                "files": {"type": "array", "items": {"type": "string"}},
                "file": {"type": "string"},
                "confirm": {"type": "boolean"},
            },
            "required": ["action"],
        },
    },
    handler=engineering_changeset,
    emoji="🧰",
    max_result_size_chars=160_000,
)
registry.register(
    name="engineering_evidence",
    toolset="project",
    schema={
        "name": "engineering_evidence",
        "description": "Attach verification, screenshot, test, build, or recovery evidence to an engineering Run.",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["status", "add", "capture_verification"]},
                "run_id": {"type": "string"},
                "task_record_id": {"type": "string"},
                "kind": {"type": "string"},
                "label": {"type": "string"},
                "status": {"type": "string"},
                "command": {"type": "string"},
                "path": {"type": "string"},
                "cwd": {"type": "string"},
                "details": {"type": "object"},
            },
            "required": ["action"],
        },
    },
    handler=engineering_evidence,
    emoji="✅",
)
registry.register(
    name="engineering_memory",
    toolset="project",
    schema={
        "name": "engineering_memory",
        "description": "Store or retrieve sanitized project decisions, constraints, conventions, and lessons.",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["add", "search"]},
                "project_key": {"type": "string"},
                "run_id": {"type": "string"},
                "cwd": {"type": "string"},
                "kind": {"type": "string"},
                "content": {"type": "string"},
                "query": {"type": "string"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 200},
            },
            "required": ["action"],
        },
    },
    handler=engineering_memory,
    emoji="🧠",
)
