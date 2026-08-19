"""Durable engineering runs, evidence, project memory, and repository index.

This module is the persistence spine for the desktop engineering workbench.
It deliberately stores metadata and evidence references, not raw credentials,
tool arguments, terminal transcripts, or arbitrary tool output.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import sqlite3
import subprocess
import time
from pathlib import Path
from typing import Any, Iterable, Optional

from hermes_constants import get_hermes_home


RUN_STATUSES = frozenset(
    {"planning", "running", "verifying", "succeeded", "failed", "cancelled"}
)
TASK_STATUSES = frozenset(
    {"pending", "running", "blocked", "succeeded", "failed", "cancelled"}
)
CHANGESET_STATUSES = frozenset({"open", "verified", "applied", "rolled_back", "failed"})

_SCHEMA = """
CREATE TABLE IF NOT EXISTS engineering_runs (
    id              TEXT PRIMARY KEY,
    session_id      TEXT,
    task_id         TEXT,
    project_id      TEXT,
    project_key     TEXT NOT NULL,
    cwd             TEXT NOT NULL,
    title           TEXT NOT NULL,
    goal            TEXT,
    status          TEXT NOT NULL,
    summary         TEXT,
    started_at      REAL NOT NULL,
    updated_at      REAL NOT NULL,
    completed_at    REAL
);
CREATE INDEX IF NOT EXISTS idx_engineering_runs_session
    ON engineering_runs(session_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_engineering_runs_project
    ON engineering_runs(project_key, updated_at DESC);

CREATE TABLE IF NOT EXISTS engineering_tasks (
    id              TEXT PRIMARY KEY,
    run_id          TEXT NOT NULL REFERENCES engineering_runs(id) ON DELETE CASCADE,
    parent_id       TEXT REFERENCES engineering_tasks(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    status          TEXT NOT NULL,
    assigned_agent  TEXT,
    result          TEXT,
    position        INTEGER NOT NULL DEFAULT 0,
    created_at      REAL NOT NULL,
    updated_at      REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_engineering_tasks_run
    ON engineering_tasks(run_id, position, created_at);

CREATE TABLE IF NOT EXISTS engineering_tool_results (
    id              TEXT PRIMARY KEY,
    run_id          TEXT REFERENCES engineering_runs(id) ON DELETE SET NULL,
    session_id      TEXT,
    task_id         TEXT,
    tool_name       TEXT NOT NULL,
    status          TEXT NOT NULL,
    duration_ms     INTEGER NOT NULL DEFAULT 0,
    result_size     INTEGER NOT NULL DEFAULT 0,
    error_code      TEXT,
    started_at      REAL NOT NULL,
    finished_at     REAL NOT NULL,
    evidence_json   TEXT
);
CREATE INDEX IF NOT EXISTS idx_engineering_tool_results_run
    ON engineering_tool_results(run_id, started_at);

CREATE TABLE IF NOT EXISTS engineering_changesets (
    id              TEXT PRIMARY KEY,
    run_id          TEXT REFERENCES engineering_runs(id) ON DELETE SET NULL,
    cwd             TEXT NOT NULL,
    checkpoint_hash TEXT,
    baseline_head   TEXT,
    status          TEXT NOT NULL,
    diff_stat       TEXT,
    files_json      TEXT,
    created_at      REAL NOT NULL,
    updated_at      REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_engineering_changesets_run
    ON engineering_changesets(run_id, created_at);

CREATE TABLE IF NOT EXISTS engineering_evidence (
    id              TEXT PRIMARY KEY,
    run_id          TEXT REFERENCES engineering_runs(id) ON DELETE CASCADE,
    task_id         TEXT,
    kind            TEXT NOT NULL,
    label           TEXT NOT NULL,
    status          TEXT NOT NULL,
    command         TEXT,
    path            TEXT,
    details_json    TEXT,
    created_at      REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_engineering_evidence_run
    ON engineering_evidence(run_id, created_at);

CREATE TABLE IF NOT EXISTS engineering_memory (
    id              TEXT PRIMARY KEY,
    project_key     TEXT NOT NULL,
    kind            TEXT NOT NULL,
    content         TEXT NOT NULL,
    source_run_id   TEXT,
    created_at      REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_engineering_memory_project
    ON engineering_memory(project_key, created_at DESC);

CREATE TABLE IF NOT EXISTS repo_indexes (
    repo_root       TEXT PRIMARY KEY,
    head            TEXT,
    status          TEXT NOT NULL,
    file_count      INTEGER NOT NULL DEFAULT 0,
    symbol_count    INTEGER NOT NULL DEFAULT 0,
    skipped_count   INTEGER NOT NULL DEFAULT 0,
    indexed_at      REAL NOT NULL,
    error           TEXT
);
CREATE TABLE IF NOT EXISTS repo_files (
    repo_root       TEXT NOT NULL REFERENCES repo_indexes(repo_root) ON DELETE CASCADE,
    path            TEXT NOT NULL,
    language        TEXT,
    size_bytes      INTEGER NOT NULL,
    mtime_ns        INTEGER NOT NULL,
    content_hash    TEXT,
    PRIMARY KEY (repo_root, path)
);
CREATE INDEX IF NOT EXISTS idx_repo_files_path ON repo_files(repo_root, path);
CREATE TABLE IF NOT EXISTS repo_symbols (
    repo_root       TEXT NOT NULL REFERENCES repo_indexes(repo_root) ON DELETE CASCADE,
    path            TEXT NOT NULL,
    name            TEXT NOT NULL,
    kind            TEXT NOT NULL,
    line            INTEGER NOT NULL,
    signature       TEXT,
    PRIMARY KEY (repo_root, path, name, kind, line)
);
CREATE INDEX IF NOT EXISTS idx_repo_symbols_name
    ON repo_symbols(repo_root, name);
"""

_LANGUAGES = {
    ".c": "c",
    ".cc": "cpp",
    ".cpp": "cpp",
    ".cs": "csharp",
    ".go": "go",
    ".h": "c",
    ".hpp": "cpp",
    ".java": "java",
    ".js": "javascript",
    ".jsx": "javascript",
    ".kt": "kotlin",
    ".md": "markdown",
    ".php": "php",
    ".py": "python",
    ".rb": "ruby",
    ".rs": "rust",
    ".swift": "swift",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".vue": "vue",
}

_SYMBOL_RULES: dict[str, tuple[tuple[str, re.Pattern[str]], ...]] = {
    "python": (
        ("class", re.compile(r"^\s*class\s+([A-Za-z_]\w*)")),
        ("function", re.compile(r"^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)")),
    ),
    "javascript": (
        ("class", re.compile(r"^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)")),
        ("function", re.compile(r"^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)")),
        ("binding", re.compile(r"^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=")),
    ),
    "typescript": (
        ("class", re.compile(r"^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)")),
        ("interface", re.compile(r"^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)")),
        ("type", re.compile(r"^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)")),
        ("function", re.compile(r"^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)")),
        ("binding", re.compile(r"^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]")),
    ),
    "go": (
        ("function", re.compile(r"^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)")),
        ("type", re.compile(r"^\s*type\s+([A-Za-z_]\w*)\s+")),
    ),
    "rust": (
        ("function", re.compile(r"^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)")),
        ("type", re.compile(r"^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)")),
    ),
}


def engineering_db_path() -> Path:
    return get_hermes_home() / "engineering.db"


def _identifier(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(8)}"


def _now() -> float:
    return time.time()


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _row(row: sqlite3.Row | None) -> Optional[dict[str, Any]]:
    return dict(row) if row is not None else None


def _normalize_root(path: str | Path) -> str:
    return str(Path(path).expanduser().resolve())


def _safe_text(value: Any, limit: int) -> str:
    return str(value or "").strip()[:limit]


class EngineeringStore:
    """Profile-local durable state for autonomous engineering work."""

    def __init__(self, db_path: Optional[Path] = None):
        self.db_path = Path(db_path) if db_path is not None else engineering_db_path()

    def connect(self) -> sqlite3.Connection:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(self.db_path), timeout=15)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript(_SCHEMA)
        return conn

    def _project_identity(self, cwd: str) -> tuple[Optional[str], str]:
        try:
            from hermes_cli import projects_db

            with projects_db.connect_closing() as conn:
                project = projects_db.project_for_path(conn, cwd)
            if project is not None:
                return project.id, project.id
        except Exception:
            pass
        return None, os.path.normcase(_normalize_root(cwd))

    def create_run(
        self,
        *,
        title: str,
        cwd: str,
        goal: str = "",
        session_id: str = "",
        task_id: str = "",
        status: str = "planning",
    ) -> dict[str, Any]:
        if status not in RUN_STATUSES:
            raise ValueError(f"invalid run status: {status}")
        root = _normalize_root(cwd)
        project_id, project_key = self._project_identity(root)
        run_id = _identifier("run")
        now = _now()
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO engineering_runs "
                "(id, session_id, task_id, project_id, project_key, cwd, title, goal, status, started_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    run_id,
                    _safe_text(session_id, 200) or None,
                    _safe_text(task_id, 200) or None,
                    project_id,
                    project_key,
                    root,
                    _safe_text(title, 240) or "Engineering run",
                    _safe_text(goal, 4000) or None,
                    status,
                    now,
                    now,
                ),
            )
            return dict(conn.execute("SELECT * FROM engineering_runs WHERE id = ?", (run_id,)).fetchone())

    def ensure_run(
        self,
        *,
        session_id: str = "",
        task_id: str = "",
        title: str = "",
        cwd: str,
    ) -> Optional[dict[str, Any]]:
        identity = _safe_text(session_id or task_id, 200)
        if not identity:
            return None
        column = "session_id" if session_id else "task_id"
        with self.connect() as conn:
            existing = conn.execute(
                f"SELECT * FROM engineering_runs WHERE {column} = ? "
                "AND status NOT IN ('succeeded','failed','cancelled') ORDER BY updated_at DESC LIMIT 1",
                (identity,),
            ).fetchone()
            if existing is not None:
                return dict(existing)
        return self.create_run(
            title=_safe_text(title, 240) or "Autonomous engineering work",
            cwd=cwd,
            goal=title,
            session_id=session_id,
            task_id=task_id,
            status="running",
        )

    def update_run(self, run_id: str, *, status: Optional[str] = None, summary: Optional[str] = None) -> dict[str, Any]:
        if status is not None and status not in RUN_STATUSES:
            raise ValueError(f"invalid run status: {status}")
        now = _now()
        with self.connect() as conn:
            current = conn.execute("SELECT * FROM engineering_runs WHERE id = ?", (run_id,)).fetchone()
            if current is None:
                raise ValueError("run not found")
            next_status = status or current["status"]
            completed = now if next_status in {"succeeded", "failed", "cancelled"} else None
            conn.execute(
                "UPDATE engineering_runs SET status = ?, summary = COALESCE(?, summary), "
                "updated_at = ?, completed_at = ? WHERE id = ?",
                (next_status, _safe_text(summary, 8000) or None, now, completed, run_id),
            )
            return dict(conn.execute("SELECT * FROM engineering_runs WHERE id = ?", (run_id,)).fetchone())

    def finalize_active_runs(
        self,
        *,
        session_id: str = "",
        task_id: str = "",
        status: str,
        summary: str = "",
    ) -> list[dict[str, Any]]:
        """Finish every active run associated with a completed agent turn.

        Tool calls can arrive before both turn identities are available, which
        can leave one run keyed by task and another keyed by session.  Closing
        every match prevents either durable record from remaining permanently
        ``running`` after the turn has ended.
        """
        if status not in {"succeeded", "failed", "cancelled"}:
            raise ValueError(f"invalid terminal run status: {status}")

        session_identity = _safe_text(session_id, 200)
        task_identity = _safe_text(task_id, 200)
        identity_clauses: list[str] = []
        identity_values: list[str] = []
        if session_identity:
            identity_clauses.append("session_id = ?")
            identity_values.append(session_identity)
        if task_identity:
            identity_clauses.append("task_id = ?")
            identity_values.append(task_identity)
        if not identity_clauses:
            return []

        now = _now()
        with self.connect() as conn:
            active_rows = conn.execute(
                "SELECT id FROM engineering_runs WHERE status NOT IN "
                "('succeeded','failed','cancelled') AND ("
                + " OR ".join(identity_clauses)
                + ") ORDER BY updated_at DESC",
                identity_values,
            ).fetchall()
            run_ids = [row["id"] for row in active_rows]
            if not run_ids:
                return []
            conn.executemany(
                "UPDATE engineering_runs SET status = ?, "
                "summary = COALESCE(?, summary), updated_at = ?, completed_at = ? "
                "WHERE id = ?",
                [
                    (
                        status,
                        _safe_text(summary, 8000) or None,
                        now,
                        now,
                        run_id,
                    )
                    for run_id in run_ids
                ],
            )
            placeholders = ",".join("?" for _ in run_ids)
            return [
                dict(row)
                for row in conn.execute(
                    f"SELECT * FROM engineering_runs WHERE id IN ({placeholders}) "
                    "ORDER BY updated_at DESC",
                    run_ids,
                ).fetchall()
            ]

    def add_task(
        self,
        run_id: str,
        title: str,
        *,
        parent_id: Optional[str] = None,
        assigned_agent: str = "",
        position: int = 0,
    ) -> dict[str, Any]:
        task_id = _identifier("task")
        now = _now()
        with self.connect() as conn:
            if conn.execute("SELECT 1 FROM engineering_runs WHERE id = ?", (run_id,)).fetchone() is None:
                raise ValueError("run not found")
            if parent_id and conn.execute(
                "SELECT 1 FROM engineering_tasks WHERE id = ? AND run_id = ?", (parent_id, run_id)
            ).fetchone() is None:
                raise ValueError("parent task not found in run")
            conn.execute(
                "INSERT INTO engineering_tasks "
                "(id, run_id, parent_id, title, status, assigned_agent, position, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)",
                (
                    task_id,
                    run_id,
                    parent_id,
                    _safe_text(title, 500) or "Task",
                    _safe_text(assigned_agent, 200) or None,
                    int(position),
                    now,
                    now,
                ),
            )
            conn.execute("UPDATE engineering_runs SET updated_at = ? WHERE id = ?", (now, run_id))
            return dict(conn.execute("SELECT * FROM engineering_tasks WHERE id = ?", (task_id,)).fetchone())

    def update_task(self, task_id: str, *, status: str, result: str = "") -> dict[str, Any]:
        if status not in TASK_STATUSES:
            raise ValueError(f"invalid task status: {status}")
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM engineering_tasks WHERE id = ?", (task_id,)).fetchone()
            if row is None:
                raise ValueError("task not found")
            now = _now()
            conn.execute(
                "UPDATE engineering_tasks SET status = ?, result = COALESCE(?, result), updated_at = ? WHERE id = ?",
                (status, _safe_text(result, 8000) or None, now, task_id),
            )
            conn.execute("UPDATE engineering_runs SET updated_at = ? WHERE id = ?", (now, row["run_id"]))
            return dict(conn.execute("SELECT * FROM engineering_tasks WHERE id = ?", (task_id,)).fetchone())

    def record_tool_result(
        self,
        *,
        result_id: str,
        tool_name: str,
        status: str,
        duration_ms: int,
        result_size: int,
        started_at: float,
        finished_at: float,
        session_id: str = "",
        task_id: str = "",
        user_task: str = "",
        cwd: str,
        error_code: str = "",
        evidence: Optional[dict[str, Any]] = None,
    ) -> Optional[str]:
        run = self.ensure_run(
            session_id=session_id,
            task_id=task_id,
            title=user_task,
            cwd=cwd,
        )
        run_id = run["id"] if run else None
        with self.connect() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO engineering_tool_results "
                "(id, run_id, session_id, task_id, tool_name, status, duration_ms, result_size, "
                " error_code, started_at, finished_at, evidence_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    _safe_text(result_id, 240),
                    run_id,
                    _safe_text(session_id, 200) or None,
                    _safe_text(task_id, 200) or None,
                    _safe_text(tool_name, 200),
                    _safe_text(status, 40) or "unknown",
                    max(0, int(duration_ms)),
                    max(0, int(result_size)),
                    _safe_text(error_code, 120) or None,
                    float(started_at),
                    float(finished_at),
                    _json(evidence or {}),
                ),
            )
            if run_id:
                conn.execute(
                    "UPDATE engineering_runs SET status = CASE WHEN status = 'planning' THEN 'running' ELSE status END, "
                    "updated_at = ? WHERE id = ?",
                    (finished_at, run_id),
                )
        return run_id

    def add_evidence(
        self,
        run_id: str,
        *,
        kind: str,
        label: str,
        status: str,
        task_id: str = "",
        command: str = "",
        path: str = "",
        details: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        evidence_id = _identifier("ev")
        now = _now()
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO engineering_evidence "
                "(id, run_id, task_id, kind, label, status, command, path, details_json, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    evidence_id,
                    run_id,
                    _safe_text(task_id, 200) or None,
                    _safe_text(kind, 80) or "observation",
                    _safe_text(label, 500) or "Evidence",
                    _safe_text(status, 40) or "unknown",
                    _safe_text(command, 2000) or None,
                    _safe_text(path, 2000) or None,
                    _json(details or {}),
                    now,
                ),
            )
            conn.execute("UPDATE engineering_runs SET updated_at = ? WHERE id = ?", (now, run_id))
            return dict(conn.execute("SELECT * FROM engineering_evidence WHERE id = ?", (evidence_id,)).fetchone())

    def create_changeset(
        self,
        *,
        cwd: str,
        run_id: Optional[str],
        checkpoint_hash: str = "",
        baseline_head: str = "",
    ) -> dict[str, Any]:
        change_id = _identifier("chg")
        now = _now()
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO engineering_changesets "
                "(id, run_id, cwd, checkpoint_hash, baseline_head, status, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, 'open', ?, ?)",
                (
                    change_id,
                    run_id,
                    _normalize_root(cwd),
                    _safe_text(checkpoint_hash, 64) or None,
                    _safe_text(baseline_head, 64) or None,
                    now,
                    now,
                ),
            )
            return dict(conn.execute("SELECT * FROM engineering_changesets WHERE id = ?", (change_id,)).fetchone())

    def update_changeset(
        self,
        change_id: str,
        *,
        status: Optional[str] = None,
        diff_stat: str = "",
        files: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        if status is not None and status not in CHANGESET_STATUSES:
            raise ValueError(f"invalid changeset status: {status}")
        with self.connect() as conn:
            current = conn.execute("SELECT * FROM engineering_changesets WHERE id = ?", (change_id,)).fetchone()
            if current is None:
                raise ValueError("changeset not found")
            conn.execute(
                "UPDATE engineering_changesets SET status = ?, diff_stat = COALESCE(?, diff_stat), "
                "files_json = COALESCE(?, files_json), updated_at = ? WHERE id = ?",
                (
                    status or current["status"],
                    _safe_text(diff_stat, 20_000) or None,
                    _json(files) if files is not None else None,
                    _now(),
                    change_id,
                ),
            )
            return dict(conn.execute("SELECT * FROM engineering_changesets WHERE id = ?", (change_id,)).fetchone())

    def add_memory(self, project_key: str, *, kind: str, content: str, source_run_id: str = "") -> dict[str, Any]:
        memory_id = _identifier("mem")
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO engineering_memory (id, project_key, kind, content, source_run_id, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (
                    memory_id,
                    _safe_text(project_key, 2000),
                    _safe_text(kind, 80) or "decision",
                    _safe_text(content, 8000),
                    _safe_text(source_run_id, 200) or None,
                    _now(),
                ),
            )
            return dict(conn.execute("SELECT * FROM engineering_memory WHERE id = ?", (memory_id,)).fetchone())

    def search_memory(self, project_key: str, query: str = "", limit: int = 50) -> list[dict[str, Any]]:
        with self.connect() as conn:
            if query.strip():
                rows = conn.execute(
                    "SELECT * FROM engineering_memory WHERE project_key = ? AND content LIKE ? "
                    "ORDER BY created_at DESC LIMIT ?",
                    (project_key, f"%{query.strip()}%", max(1, min(int(limit), 200))),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM engineering_memory WHERE project_key = ? ORDER BY created_at DESC LIMIT ?",
                    (project_key, max(1, min(int(limit), 200))),
                ).fetchall()
            return [dict(item) for item in rows]

    def list_runs(self, *, project_key: str = "", limit: int = 50) -> list[dict[str, Any]]:
        with self.connect() as conn:
            if project_key:
                rows = conn.execute(
                    "SELECT * FROM engineering_runs WHERE project_key = ? ORDER BY updated_at DESC LIMIT ?",
                    (project_key, max(1, min(int(limit), 200))),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM engineering_runs ORDER BY updated_at DESC LIMIT ?",
                    (max(1, min(int(limit), 200)),),
                ).fetchall()
            return [dict(item) for item in rows]

    def get_run(self, run_id: str) -> Optional[dict[str, Any]]:
        with self.connect() as conn:
            run = _row(conn.execute("SELECT * FROM engineering_runs WHERE id = ?", (run_id,)).fetchone())
            if run is None:
                return None
            run["tasks"] = [
                dict(item)
                for item in conn.execute(
                    "SELECT * FROM engineering_tasks WHERE run_id = ? ORDER BY position, created_at", (run_id,)
                ).fetchall()
            ]
            run["tool_results"] = [
                dict(item)
                for item in conn.execute(
                    "SELECT * FROM engineering_tool_results WHERE run_id = ? ORDER BY started_at", (run_id,)
                ).fetchall()
            ]
            run["changesets"] = [
                dict(item)
                for item in conn.execute(
                    "SELECT * FROM engineering_changesets WHERE run_id = ? ORDER BY created_at", (run_id,)
                ).fetchall()
            ]
            run["evidence"] = [
                dict(item)
                for item in conn.execute(
                    "SELECT * FROM engineering_evidence WHERE run_id = ? ORDER BY created_at", (run_id,)
                ).fetchall()
            ]
            return run

    @staticmethod
    def _git(root: str, args: list[str]) -> str:
        try:
            result = subprocess.run(
                ["git", "-C", root, *args],
                capture_output=True,
                check=False,
                text=True,
                timeout=30,
            )
        except (OSError, subprocess.SubprocessError):
            return ""
        return result.stdout.strip() if result.returncode == 0 else ""

    @staticmethod
    def _repo_paths(root: str) -> Iterable[str]:
        tracked = EngineeringStore._git(root, ["ls-files", "-co", "--exclude-standard", "-z"])
        if tracked:
            for item in tracked.split("\0"):
                if item:
                    yield item
            return

        excluded = {".git", ".hg", ".svn", ".venv", "dist", "build", "release", "node_modules", "vendor"}
        for current, dirs, files in os.walk(root):
            dirs[:] = [name for name in dirs if name not in excluded and not name.startswith(".cache")]
            for filename in files:
                yield os.path.relpath(os.path.join(current, filename), root)

    @staticmethod
    def _symbols(language: str, text: str) -> Iterable[tuple[str, str, int, str]]:
        rules = _SYMBOL_RULES.get(language, ())
        for line_no, line in enumerate(text.splitlines(), 1):
            for kind, pattern in rules:
                match = pattern.match(line)
                if match:
                    yield match.group(1), kind, line_no, line.strip()[:500]
                    break

    def index_repository(
        self,
        repo_root: str,
        *,
        max_files: int = 50_000,
        max_file_bytes: int = 2_000_000,
    ) -> dict[str, Any]:
        root = _normalize_root(repo_root)
        if not Path(root).is_dir():
            raise ValueError("repository root is not a directory")
        now = _now()
        head = self._git(root, ["rev-parse", "HEAD"])
        files: list[tuple[Any, ...]] = []
        symbols: list[tuple[Any, ...]] = []
        skipped = 0
        for relative in self._repo_paths(root):
            if len(files) >= max(1, int(max_files)):
                skipped += 1
                continue
            path = Path(root) / relative
            extension = path.suffix.lower()
            language = _LANGUAGES.get(extension)
            try:
                stat = path.stat()
            except OSError:
                skipped += 1
                continue
            if not path.is_file() or stat.st_size > max_file_bytes:
                skipped += 1
                continue
            digest = ""
            text = ""
            if language:
                try:
                    raw = path.read_bytes()
                    if b"\x00" in raw[:8192]:
                        skipped += 1
                        continue
                    digest = hashlib.sha256(raw).hexdigest()
                    text = raw.decode("utf-8", errors="replace")
                except OSError:
                    skipped += 1
                    continue
            normalized_relative = relative.replace("\\", "/")
            files.append((root, normalized_relative, language, stat.st_size, stat.st_mtime_ns, digest or None))
            if language and text:
                symbols.extend(
                    (root, normalized_relative, name, kind, line, signature)
                    for name, kind, line, signature in self._symbols(language, text)
                )

        with self.connect() as conn:
            conn.execute("DELETE FROM repo_symbols WHERE repo_root = ?", (root,))
            conn.execute("DELETE FROM repo_files WHERE repo_root = ?", (root,))
            conn.execute(
                "INSERT INTO repo_indexes (repo_root, head, status, file_count, symbol_count, skipped_count, indexed_at, error) "
                "VALUES (?, ?, 'ready', ?, ?, ?, ?, NULL) "
                "ON CONFLICT(repo_root) DO UPDATE SET head=excluded.head, status='ready', "
                "file_count=excluded.file_count, symbol_count=excluded.symbol_count, "
                "skipped_count=excluded.skipped_count, indexed_at=excluded.indexed_at, error=NULL",
                (root, head or None, len(files), len(symbols), skipped, now),
            )
            conn.executemany(
                "INSERT INTO repo_files (repo_root, path, language, size_bytes, mtime_ns, content_hash) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                files,
            )
            conn.executemany(
                "INSERT INTO repo_symbols (repo_root, path, name, kind, line, signature) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                symbols,
            )
            return dict(conn.execute("SELECT * FROM repo_indexes WHERE repo_root = ?", (root,)).fetchone())

    def repo_status(self, repo_root: str) -> Optional[dict[str, Any]]:
        root = _normalize_root(repo_root)
        with self.connect() as conn:
            return _row(conn.execute("SELECT * FROM repo_indexes WHERE repo_root = ?", (root,)).fetchone())

    def search_symbols(self, repo_root: str, query: str, limit: int = 50) -> list[dict[str, Any]]:
        root = _normalize_root(repo_root)
        pattern = f"%{query.strip()}%"
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT path, name, kind, line, signature FROM repo_symbols "
                "WHERE repo_root = ? AND (name LIKE ? OR signature LIKE ?) "
                "ORDER BY CASE WHEN lower(name) = lower(?) THEN 0 WHEN lower(name) LIKE lower(?) THEN 1 ELSE 2 END, "
                "path, line LIMIT ?",
                (root, pattern, pattern, query.strip(), f"{query.strip()}%", max(1, min(int(limit), 500))),
            ).fetchall()
            return [dict(item) for item in rows]

    def search_files(self, repo_root: str, query: str, limit: int = 100) -> list[dict[str, Any]]:
        root = _normalize_root(repo_root)
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT path, language, size_bytes, mtime_ns, content_hash FROM repo_files "
                "WHERE repo_root = ? AND path LIKE ? ORDER BY path LIMIT ?",
                (root, f"%{query.strip()}%", max(1, min(int(limit), 500))),
            ).fetchall()
            return [dict(item) for item in rows]


def default_store() -> EngineeringStore:
    return EngineeringStore()
