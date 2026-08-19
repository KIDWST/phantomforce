"""Typed, observable result bus shared by every registered tool backend."""

from __future__ import annotations

import json
import os
import threading
import time
import uuid
from collections import deque
from dataclasses import asdict, dataclass, field
from typing import Any, Callable, Optional


@dataclass(frozen=True)
class ToolResult:
    id: str
    tool_name: str
    status: str
    started_at: float
    finished_at: float
    duration_ms: int
    result_size: int
    session_id: str = ""
    task_id: str = ""
    run_id: Optional[str] = None
    error_code: Optional[str] = None
    evidence: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _result_status(result: Any, raised: Optional[BaseException]) -> tuple[str, Optional[str]]:
    if raised is not None:
        return "error", type(raised).__name__
    try:
        parsed = json.loads(result) if isinstance(result, str) else result
    except Exception:
        parsed = result
    if isinstance(parsed, dict) and parsed.get("error"):
        return "error", _safe_code(parsed.get("code") or parsed.get("error_type") or "tool_error")
    if isinstance(parsed, dict) and parsed.get("status") in {"cancelled", "blocked"}:
        return str(parsed["status"]), _safe_code(parsed.get("error_type") or parsed["status"])
    return "ok", None


def _safe_code(value: Any) -> str:
    return str(value or "unknown")[:120]


def _result_size(result: Any) -> int:
    if isinstance(result, str):
        return len(result)
    try:
        return len(json.dumps(result, ensure_ascii=False, default=str))
    except Exception:
        return len(str(result))


def _cwd_for(task_id: str) -> str:
    try:
        from tools.terminal_tool import resolve_task_overrides

        cwd = str(resolve_task_overrides(task_id).get("cwd") or "").strip()
        if cwd:
            return cwd
    except Exception:
        pass
    try:
        return os.getcwd()
    except OSError:
        return str(os.path.expanduser("~"))


class ToolResultBus:
    def __init__(self, max_recent: int = 500):
        self._recent: deque[ToolResult] = deque(maxlen=max_recent)
        self._observers: list[Callable[[ToolResult], None]] = []
        self._lock = threading.RLock()

    def subscribe(self, observer: Callable[[ToolResult], None]) -> Callable[[], None]:
        with self._lock:
            self._observers.append(observer)

        def unsubscribe() -> None:
            with self._lock:
                if observer in self._observers:
                    self._observers.remove(observer)

        return unsubscribe

    def recent(self, limit: int = 100) -> list[dict[str, Any]]:
        with self._lock:
            return [item.to_dict() for item in list(self._recent)[-max(1, int(limit)):]]

    def publish(
        self,
        *,
        tool_name: str,
        result: Any,
        started_at: float,
        kwargs: dict[str, Any],
        raised: Optional[BaseException] = None,
    ) -> ToolResult:
        finished_at = time.time()
        status, error_code = _result_status(result, raised)
        result_id = str(kwargs.get("tool_call_id") or f"tool_{uuid.uuid4().hex}")
        session_id = str(kwargs.get("session_id") or "")
        task_id = str(kwargs.get("task_id") or "")
        duration_ms = max(0, int((time.monotonic() - started_at) * 1000))
        run_id = None
        try:
            from hermes_cli.engineering_os import default_store

            run_id = default_store().record_tool_result(
                result_id=result_id,
                tool_name=tool_name,
                status=status,
                duration_ms=duration_ms,
                result_size=_result_size(result),
                started_at=finished_at - duration_ms / 1000,
                finished_at=finished_at,
                session_id=session_id,
                task_id=task_id,
                user_task=str(kwargs.get("user_task") or ""),
                cwd=_cwd_for(task_id),
                error_code=error_code or "",
                evidence={"backend": "registry"},
            )
        except Exception:
            run_id = None

        typed = ToolResult(
            id=result_id,
            tool_name=tool_name,
            status=status,
            started_at=finished_at - duration_ms / 1000,
            finished_at=finished_at,
            duration_ms=duration_ms,
            result_size=_result_size(result),
            session_id=session_id,
            task_id=task_id,
            run_id=run_id,
            error_code=error_code,
            evidence={"backend": "registry"},
        )
        with self._lock:
            self._recent.append(typed)
            observers = list(self._observers)
        for observer in observers:
            try:
                observer(typed)
            except Exception:
                pass
        return typed


tool_result_bus = ToolResultBus()
