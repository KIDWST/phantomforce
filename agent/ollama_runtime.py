"""Local Ollama runtime launch and resource guards.

PhantomBot can talk to Ollama through OpenAI-compatible local endpoints.  This
module keeps that path practical on a workstation by starting Ollama when the
selected provider is local-Ollama-like and by capping request options for large
models that would otherwise load with expensive defaults.
"""

from __future__ import annotations

import atexit
import contextlib
import json
import logging
import os
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

DEFAULT_GENERAL_CTX = 4096
DEFAULT_LARGE_CTX = 32768
DEFAULT_CODING_CTX = 262144
MAX_OLLAMA_CONTEXT = 262144
MAX_PHANTOM_CONTEXT = 262144
DEFAULT_NUM_BATCH = 512  # Higher batch = better throughput on CPU-bounded models
MAX_OLLAMA_THREADS = 24  # Physical CPU threads on this machine (32 available, 24 leaves headroom)
OLLAMA_KEEP_ALIVE = "-1"  # Keep model loaded indefinitely
OLLAMA_START_TIMEOUT_SECONDS = 30.0
OLLAMA_UNUSED_START_GRACE_SECONDS = 45.0
OLLAMA_IDLE_SHUTDOWN_SECONDS = 3.0
OLLAMA_START_LOCK_TIMEOUT_SECONDS = 35.0

_OWNED_OLLAMA_LOCK = threading.Lock()
_OWNED_OLLAMA_PROCESS = None
_OWNED_OLLAMA_PIDS: dict[int, float | None] = {}

_LOCAL_OLLAMA_PROVIDERS = {
    "ollama",
    "ollama-launch",
    "local-ollama",
    "custom:local-ollama",
    "phantom",
    "custom:phantom",
    "qwen3-coder-local",
}


def normalize_ollama_base_url(base_url: str | None) -> str:
    value = str(base_url or "").strip().rstrip("/")
    if value.endswith("/v1"):
        value = value[:-3].rstrip("/")
    return value or "http://127.0.0.1:11434"


def is_local_ollama_endpoint(base_url: str | None, provider: str | None = None) -> bool:
    provider_value = str(provider or "").strip().lower()
    if provider_value in _LOCAL_OLLAMA_PROVIDERS:
        return True
    parsed = urllib.parse.urlsplit(normalize_ollama_base_url(base_url))
    host = (parsed.hostname or "").lower()
    return host in {"127.0.0.1", "localhost", "::1"} and parsed.port == 11434


def _ollama_host_from_base_url(base_url: str | None) -> str:
    parsed = urllib.parse.urlsplit(normalize_ollama_base_url(base_url))
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or 11434
    if host == "localhost":
        host = "127.0.0.1"
    return f"{host}:{port}"


def _probe_ollama(base_url: str | None, *, timeout: float = 1.0) -> bool:
    url = normalize_ollama_base_url(base_url) + "/api/tags"
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return 200 <= int(getattr(response, "status", 200)) < 500
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return False


def _ollama_has_loaded_models(base_url: str | None) -> bool | None:
    url = normalize_ollama_base_url(base_url) + "/api/ps"
    try:
        with urllib.request.urlopen(url, timeout=1.0) as response:
            payload = json.load(response)
        return bool(payload.get("models")) if isinstance(payload, dict) else False
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError):
        return None


@contextlib.contextmanager
def _cross_process_start_lock(timeout: float = OLLAMA_START_LOCK_TIMEOUT_SECONDS):
    """Serialize Ollama cold starts across gateway/worker processes.

    The in-process lock below cannot protect separate Hermes workers.  A small
    OS file lock makes every contender re-probe after the first process has
    finished starting the listener, preventing duplicate ``ollama serve``
    hosts during a slow Windows cold start.
    """
    lock_dir = Path(tempfile.gettempdir()) / "phantombot-ollama"
    handle = None
    acquired = False
    try:
        lock_dir.mkdir(parents=True, exist_ok=True)
        handle = open(lock_dir / "ollama-start.lock", "a+b")
        handle.seek(0, os.SEEK_END)
        if handle.tell() == 0:
            handle.write(b"\0")
            handle.flush()
        deadline = time.monotonic() + max(0.1, timeout)
        if os.name == "nt":
            import msvcrt

            while time.monotonic() < deadline:
                handle.seek(0)
                try:
                    msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                    acquired = True
                    break
                except OSError:
                    time.sleep(0.1)
        else:
            import fcntl

            while time.monotonic() < deadline:
                try:
                    fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                    acquired = True
                    break
                except OSError:
                    time.sleep(0.1)
    except OSError:
        acquired = False
    try:
        yield acquired
    finally:
        if handle is not None:
            if acquired:
                try:
                    handle.seek(0)
                    if os.name == "nt":
                        import msvcrt

                        msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                    else:
                        import fcntl

                        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
                except OSError:
                    pass
            handle.close()


def _validated_ollama_pid(pid: int, expected_created: float | None = None) -> bool:
    """Return whether ``pid`` is still the exact Ollama process we recorded."""
    try:
        import psutil

        process = psutil.Process(int(pid))
        name = str(process.name() or "").strip().lower()
        executable = str(process.exe() or "").strip().lower()
        if name not in {"ollama", "ollama.exe"} and not executable.endswith("\\ollama.exe"):
            return False
        if expected_created is not None and abs(process.create_time() - expected_created) > 0.1:
            return False
        return process.is_running()
    except Exception:
        return False


def _record_owned_ollama_pid(pid: int | None) -> None:
    if not isinstance(pid, int) or pid <= 0:
        return
    created = None
    try:
        import psutil

        process = psutil.Process(pid)
        if not _validated_ollama_pid(pid):
            return
        created = process.create_time()
    except Exception:
        return
    with _OWNED_OLLAMA_LOCK:
        _OWNED_OLLAMA_PIDS[pid] = created


def _record_owned_listener_pids(base_url: str | None) -> None:
    """Record only validated Ollama processes listening on this local port."""
    try:
        import psutil

        parsed = urllib.parse.urlsplit(normalize_ollama_base_url(base_url))
        port = parsed.port or 11434
        for connection in psutil.net_connections(kind="tcp"):
            local = getattr(connection, "laddr", None)
            if (
                getattr(connection, "status", "") == psutil.CONN_LISTEN
                and local
                and getattr(local, "port", None) == port
                and connection.pid
            ):
                _record_owned_ollama_pid(int(connection.pid))
    except Exception:
        return


def _owned_ollama_is_alive(process: Any) -> bool:
    try:
        if process is not None and process.poll() is None:
            return True
    except Exception:
        pass
    with _OWNED_OLLAMA_LOCK:
        records = dict(_OWNED_OLLAMA_PIDS)
    return any(_validated_ollama_pid(pid, created) for pid, created in records.items())


def _stop_owned_ollama(expected_pid: int | None = None) -> None:
    """Stop only the Ollama process tree started by this module."""
    global _OWNED_OLLAMA_PROCESS, _OWNED_OLLAMA_PIDS
    with _OWNED_OLLAMA_LOCK:
        process = _OWNED_OLLAMA_PROCESS
        records = dict(_OWNED_OLLAMA_PIDS)
        process_pid = getattr(process, "pid", None)
        if expected_pid is not None and expected_pid != process_pid and expected_pid not in records:
            return
        _OWNED_OLLAMA_PROCESS = None
        _OWNED_OLLAMA_PIDS = {}

    pids = set(records)
    process_is_live = False
    try:
        process_is_live = process is not None and process.poll() is None
    except Exception:
        pass
    if isinstance(process_pid, int) and process_pid > 0 and (
        process_pid in records or process_is_live
    ):
        pids.add(process_pid)
    if os.name == "nt":
        for pid in sorted(pids, reverse=True):
            created = records.get(pid)
            if pid != process_pid and not _validated_ollama_pid(pid, created):
                continue
            if pid == process_pid and created is not None and not _validated_ollama_pid(pid, created):
                continue
            try:
                subprocess.run(
                    ["taskkill.exe", "/PID", str(pid), "/T", "/F"],
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=5,
                    check=False,
                )
            except (OSError, subprocess.SubprocessError):
                pass
        return

    try:
        if process is not None and process.poll() is None:
            process.terminate()
            process.wait(timeout=5)
    except (OSError, subprocess.SubprocessError):
        pass
    for pid, created in records.items():
        if pid == process_pid or not _validated_ollama_pid(pid, created):
            continue
        try:
            import psutil

            psutil.Process(pid).terminate()
        except Exception:
            pass


atexit.register(_stop_owned_ollama)


def _monitor_owned_ollama(process: Any, base_url: str | None) -> None:
    """Release an owned host after its explicitly requested model unloads."""
    started = time.monotonic()
    saw_loaded_model = False
    idle_since = None
    while _owned_ollama_is_alive(process):
        now = time.monotonic()
        loaded = _ollama_has_loaded_models(base_url)
        if loaded is True:
            saw_loaded_model = True
            idle_since = None
        elif loaded is False and saw_loaded_model:
            idle_since = idle_since or now
            if now - idle_since >= OLLAMA_IDLE_SHUTDOWN_SECONDS:
                _stop_owned_ollama(process.pid)
                return
        elif not saw_loaded_model and now - started >= OLLAMA_UNUSED_START_GRACE_SECONDS:
            _stop_owned_ollama(process.pid)
            return
        time.sleep(1.0)


def find_ollama_executable() -> str | None:
    found = shutil.which("ollama")
    if found:
        return found
    candidates = [
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Ollama" / "ollama.exe",
        Path(os.environ.get("ProgramFiles", "")) / "Ollama" / "ollama.exe",
        Path(os.environ.get("ProgramFiles(x86)", "")) / "Ollama" / "ollama.exe",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    return None


def ensure_ollama_available(
    base_url: str | None,
    *,
    provider: str | None = None,
    log: logging.Logger | None = None,
) -> dict[str, Any]:
    """Start local Ollama if needed and return a small status dictionary."""
    log = log or logger
    if not is_local_ollama_endpoint(base_url, provider):
        return {"ok": False, "status": "not_ollama_endpoint"}
    if _probe_ollama(base_url):
        return {"ok": True, "status": "already_running"}

    with _cross_process_start_lock() as lock_acquired:
        if not lock_acquired:
            if _probe_ollama(base_url):
                return {"ok": True, "status": "already_running"}
            return {"ok": False, "status": "start_lock_timeout"}

        # Another worker may have completed its cold start while this process
        # waited for the machine-wide lock.
        if _probe_ollama(base_url):
            return {"ok": True, "status": "already_running"}

        executable = find_ollama_executable()
        if not executable:
            return {"ok": False, "status": "missing_ollama_executable"}

        env = os.environ.copy()
        env["OLLAMA_HOST"] = _ollama_host_from_base_url(base_url)
        env["OLLAMA_NUM_PARALLEL"] = "1"
        env["OLLAMA_MAX_LOADED_MODELS"] = "1"
        env["OLLAMA_MAX_QUEUE"] = "1"
        env["OLLAMA_FLASH_ATTENTION"] = "1"
        env["OLLAMA_KV_CACHE_TYPE"] = "q8_0"
        env["OLLAMA_KEEP_ALIVE"] = OLLAMA_KEEP_ALIVE

        creationflags = 0
        if os.name == "nt":
            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        try:
            global _OWNED_OLLAMA_PROCESS
            with _OWNED_OLLAMA_LOCK:
                process = _OWNED_OLLAMA_PROCESS
                if process is None or process.poll() is not None:
                    process = subprocess.Popen(
                        [executable, "serve"],
                        stdin=subprocess.DEVNULL,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                        env=env,
                        creationflags=creationflags,
                    )
                    _OWNED_OLLAMA_PROCESS = process
            _record_owned_ollama_pid(getattr(process, "pid", None))
        except OSError as exc:
            log.warning("Could not start Ollama automatically: %s", exc)
            return {"ok": False, "status": "start_failed", "error": str(exc)}

        deadline = time.monotonic() + OLLAMA_START_TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            if _probe_ollama(base_url):
                _record_owned_ollama_pid(getattr(process, "pid", None))
                _record_owned_listener_pids(base_url)
                threading.Thread(
                    target=_monitor_owned_ollama,
                    args=(process, base_url),
                    name="phantombot-ollama-idle-monitor",
                    daemon=True,
                ).start()
                return {"ok": True, "status": "started"}
            time.sleep(0.25)
        _record_owned_listener_pids(base_url)
        _stop_owned_ollama(getattr(process, "pid", None))
        return {"ok": False, "status": "start_timeout"}


def ensure_explicit_phantom_runtime(agent: Any, *, log: logging.Logger | None = None) -> dict[str, Any]:
    """Start Ollama only at send time for an explicitly selected Phantom model."""
    provider = str(getattr(agent, "provider", "") or "").strip().lower()
    model = _model_lower(getattr(agent, "model", ""))
    base_url = getattr(agent, "base_url", None)
    provider_is_phantom = provider in {"phantom", "custom:phantom"} or (
        provider == "custom" and is_local_ollama_endpoint(base_url, provider)
    )
    if not provider_is_phantom or not (
        model == "phantom"
        or model.startswith("phantom:")
        or model.startswith("phantom-unleashed")
        or model.startswith("phantom-v1")
    ):
        return {"ok": False, "status": "not_explicit_phantom"}
    return ensure_ollama_available(
        base_url,
        provider=provider,
        log=log,
    )


def _model_lower(model: str | None) -> str:
    return str(model or "").strip().lower()


def is_large_local_model(model: str | None) -> bool:
    value = _model_lower(model)
    return any(
        marker in value
        for marker in (
            "30b",
            "32b",
            "34b",
            "35b",
            "70b",
            "72b",
            "huihui",
            "unleashed",
            "uncensored",
        )
    )


def is_long_context_coding_model(model: str | None) -> bool:
    value = _model_lower(model)
    return value == "phantom" or any(
        marker in value
        for marker in (
            "phantom:",
            "phantom-v1",
            "phantom 1.0",
            "phantom-unleashed",
            "phantombot-unleashed",
        )
    )


def choose_ollama_num_ctx(
    model: str | None,
    detected_ctx: int | None = None,
    *,
    explicit_ctx: int | str | None = None,
    config_context_length: int | None = None,
) -> int | None:
    """Pick a practical Ollama context for this machine.

    Explicit ``model.ollama_num_ctx`` still wins within a model-safe ceiling.
    Explicit ``model.ollama_num_ctx`` still wins within a local model-safe
    ceiling. Local models can expose their full long-context window while
    thread/batch limits keep the workstation responsive.
    """
    model_cap = MAX_PHANTOM_CONTEXT if is_long_context_coding_model(model) else MAX_OLLAMA_CONTEXT
    if explicit_ctx is not None:
        try:
            return min(model_cap, max(1024, int(explicit_ctx)))
        except (TypeError, ValueError):
            return None

    if config_context_length:
        cap = min(model_cap, int(config_context_length))
    elif is_long_context_coding_model(model):
        cap = DEFAULT_CODING_CTX
    elif is_large_local_model(model):
        cap = DEFAULT_LARGE_CTX
    else:
        cap = DEFAULT_GENERAL_CTX

    if detected_ctx and detected_ctx > 0:
        return min(int(detected_ctx), cap)
    return cap


def _message_text_size(value: Any) -> int:
    if value is None:
        return 0
    if isinstance(value, str):
        return len(value)
    if isinstance(value, dict):
        return sum(_message_text_size(item) for item in value.values())
    if isinstance(value, (list, tuple)):
        return sum(_message_text_size(item) for item in value)
    return len(str(value))


def choose_ollama_request_num_ctx(
    model: str | None,
    max_ctx: int | None,
    messages: list[Any] | None,
    *,
    tool_count: int = 0,
    tools: list[Any] | None = None,
) -> int | None:
    """Use the smallest stable Ollama window that can hold this request.

    The configured/model context remains the ceiling shown to PhantomBot.  The
    per-request option stays lower for short turns so Ollama does not allocate a
    full 256K cache just to answer a one-line prompt.
    """
    if not isinstance(max_ctx, int) or max_ctx <= 0:
        return None

    ceiling = min(MAX_OLLAMA_CONTEXT, max(1024, max_ctx))
    message_tokens = (_message_text_size(messages or []) + 3) // 4
    if tools:
        tool_tokens = (_message_text_size(tools) + 3) // 4
    else:
        # Callers that only know the tool count still get a conservative
        # estimate without forcing every short Phantom turn into a 65K cache.
        tool_tokens = max(0, tool_count) * 256
    estimated_tokens = message_tokens + tool_tokens
    reserve = max(4096, min(16384, estimated_tokens // 4))
    needed = max(8192, estimated_tokens + reserve)
    for tier in (8192, 16384, 32768, 65536, 131072, 262144):
        if tier >= needed:
            return min(ceiling, tier)
    return ceiling


def build_ollama_request_options(model: str | None, *, cpu_count: int | None = None) -> dict[str, int]:
    cpus = cpu_count if cpu_count and cpu_count > 0 else (os.cpu_count() or 8)
    threads = min(max(cpus // 4, 2), MAX_OLLAMA_THREADS)
    return {"num_thread": threads, "num_batch": DEFAULT_NUM_BATCH}


def configure_agent_ollama_runtime(
    agent: Any,
    *,
    model_cfg: dict[str, Any] | None = None,
    config_context_length: int | None = None,
    log: logging.Logger | None = None,
) -> dict[str, Any]:
    """Ensure Ollama is ready and attach resource-aware options to ``agent``."""
    log = log or logger
    agent._ollama_num_ctx = None
    agent._ollama_options = None
    agent._ollama_keep_alive = None

    base_url = getattr(agent, "base_url", None)
    provider = getattr(agent, "provider", None)
    if not is_local_ollama_endpoint(base_url, provider):
        return {"ok": False, "status": "not_ollama_endpoint"}

    # Initialization and model-menu changes must remain probe/configuration
    # only. The exact outbound Phantom request calls ensure_explicit_phantom_runtime.
    availability = {"ok": True, "status": "on_demand"}
    agent._ollama_keep_alive = OLLAMA_KEEP_ALIVE
    explicit_ctx = (model_cfg or {}).get("ollama_num_ctx") if isinstance(model_cfg, dict) else None
    detected_ctx = None
    if explicit_ctx is None and _probe_ollama(base_url):
        try:
            from agent.model_metadata import query_ollama_num_ctx

            api_key = getattr(agent, "api_key", "")
            key_for_ollama = api_key if isinstance(api_key, str) else ""
            detected_ctx = query_ollama_num_ctx(
                getattr(agent, "model", ""),
                base_url,
                api_key=key_for_ollama or "",
            )
        except Exception as exc:
            log.debug("Ollama num_ctx detection failed: %s", exc)

    chosen_ctx = choose_ollama_num_ctx(
        getattr(agent, "model", ""),
        detected_ctx,
        explicit_ctx=explicit_ctx,
        config_context_length=config_context_length,
    )
    if chosen_ctx:
        agent._ollama_num_ctx = chosen_ctx
    agent._ollama_options = build_ollama_request_options(getattr(agent, "model", ""))
    return {
        "ok": bool(availability.get("ok")),
        "status": availability.get("status"),
        "detected_ctx": detected_ctx,
        "num_ctx": agent._ollama_num_ctx,
        "options": dict(agent._ollama_options or {}),
    }
