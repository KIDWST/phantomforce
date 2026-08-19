from __future__ import annotations

import argparse
import fnmatch
import html
import json
import os
import re
import shlex
import shutil
import socket
import subprocess
import sys
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import uuid
import webbrowser
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from mcp_client import MCPError, UnrealMCPClient
from secret_store import load_secret, save_secret

APP_VERSION = "18.0"
DEFAULT_PROVIDER = "openrouter"
PROVIDER_DEFAULTS = {
    "openrouter": "openrouter/auto",
    "openai": "gpt-5",
    "anthropic": "claude-sonnet-4-5",
    "local": "",
}
PROVIDER_ENDPOINTS = {
    "openrouter": "https://openrouter.ai/api/v1",
    "openai": "https://api.openai.com/v1",
    "anthropic": "https://api.anthropic.com/v1",
    "local": "http://127.0.0.1:11434/v1",
}
PROVIDER_ENV_KEYS = {
    "openrouter": "OPENROUTER_API_KEY",
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "local": "LOCAL_AI_API_KEY",
}
DEFAULT_PORT = 8765
MCP_URL = "http://127.0.0.1:8000/mcp"

TEXT_EXTENSIONS = {
    ".h", ".hpp", ".cpp", ".c", ".cs", ".py", ".ps1", ".bat", ".cmd", ".ini", ".json",
    ".md", ".txt", ".uproject", ".uplugin", ".xml", ".toml", ".yaml", ".yml", ".js", ".ts",
    ".tsx", ".jsx", ".html", ".css", ".usf", ".ush", ".target.cs", ".build.cs",
}
EXCLUDED_DIRS = {"Binaries", "Intermediate", "DerivedDataCache", "Saved", ".git", ".vs", "node_modules", "__pycache__"}
MAX_READ_BYTES = 1_500_000
MAX_WRITE_BYTES = 2_000_000

PORTFOLIO = [
    ("PhantomStrike", "phantom-strike"),
    ("Phantom Ages", "phantom-ages"),
    ("Phantom Legends", "phantom-legends"),
    ("CubeTown", "cubetown"),
]


def json_text(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2, default=str)


def is_text_path(path: Path) -> bool:
    name = path.name.lower()
    if name.endswith(".target.cs") or name.endswith(".build.cs"):
        return True
    return path.suffix.lower() in TEXT_EXTENSIONS


class ProjectSandbox:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.session_id = time.strftime("%Y-%m-%d_%H%M%S") + "_" + uuid.uuid4().hex[:8]
        self.backup_root = self.root / "Saved" / "PhantomAI" / "backups" / self.session_id
        self._backed_up: set[str] = set()
        self._created: set[str] = set()
        self.lock = threading.RLock()

    def resolve(self, rel: str) -> Path:
        rel = rel.replace("\\", "/").lstrip("/")
        candidate = (self.root / rel).resolve()
        try:
            candidate.relative_to(self.root)
        except ValueError:
            raise ValueError("Path escapes the PhantomPlay project root")
        return candidate

    def relative(self, path: Path) -> str:
        return str(path.resolve().relative_to(self.root)).replace("\\", "/")

    def backup(self, path: Path) -> None:
        rel = self.relative(path)
        if rel in self._backed_up or rel in self._created:
            return
        if path.exists():
            dest = self.backup_root / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, dest)
            self._backed_up.add(rel)
        else:
            self._created.add(rel)

    def rollback(self) -> dict[str, Any]:
        restored, removed = [], []
        with self.lock:
            for rel in sorted(self._created):
                p = self.resolve(rel)
                if p.exists() and p.is_file():
                    p.unlink()
                    removed.append(rel)
            for rel in sorted(self._backed_up):
                src = self.backup_root / rel
                dest = self.resolve(rel)
                if src.exists():
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(src, dest)
                    restored.append(rel)
        return {"restored": restored, "removed": removed, "backup": str(self.backup_root)}


class ProviderClient:
    def __init__(self, app: "PhantomPlayAI"):
        self.app = app

    def key(self, provider: str) -> str:
        env_name = PROVIDER_ENV_KEYS.get(provider, "")
        return (os.getenv(env_name, "") if env_name else "") or load_secret(self.app.key_files[provider])

    def endpoint(self, provider: str) -> str:
        custom = str(self.app.settings.get("endpoint", "")).strip() if provider == "local" else ""
        return (custom or PROVIDER_ENDPOINTS[provider]).rstrip("/")

    def _json_request(self, url: str, body: dict[str, Any] | None, headers: dict[str, str], label: str) -> dict[str, Any]:
        request_headers = {"Content-Type": "application/json", **headers}
        req = urllib.request.Request(
            url,
            data=json.dumps(body).encode("utf-8") if body is not None else None,
            headers=request_headers,
            method="POST" if body is not None else "GET",
        )
        try:
            with urllib.request.urlopen(req, timeout=180 if body is not None else 30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"{label} HTTP {exc.code}: {detail[:2000]}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"{label} is unavailable at {url}: {exc.reason}") from exc

    def _auth_headers(self, provider: str) -> dict[str, str]:
        key = self.key(provider)
        if provider != "local" and not key:
            raise RuntimeError(f"{provider.title()} is not connected. Choose it once, paste its API key, and click Connect engine.")
        if provider == "anthropic":
            return {"x-api-key": key, "anthropic-version": "2023-06-01"}
        headers = {"Authorization": f"Bearer {key}"} if key else {}
        if provider == "openrouter":
            headers.update({"HTTP-Referer": "http://127.0.0.1:8765", "X-OpenRouter-Title": "PhantomPlay AI"})
        return headers

    def request(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]], model: str, provider: str) -> dict[str, Any]:
        provider = provider if provider in PROVIDER_ENDPOINTS else DEFAULT_PROVIDER
        model = model or PROVIDER_DEFAULTS[provider]
        if not model:
            available = self.models(provider)
            if not available:
                raise RuntimeError("No local AI model is available. Start Ollama or another OpenAI-compatible local server, then connect again.")
            model = str(available[0]["id"])
        if provider == "anthropic":
            return self._anthropic_request(messages, tools, model)
        body = {
            "model": model,
            "messages": messages,
            "tools": tools,
            "tool_choice": "auto",
            "temperature": 0.2,
        }
        if provider != "local":
            body["parallel_tool_calls"] = False
        return self._json_request(
            self.endpoint(provider) + "/chat/completions", body, self._auth_headers(provider), provider.title()
        )

    def _anthropic_request(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]], model: str) -> dict[str, Any]:
        system = "\n\n".join(str(m.get("content", "")) for m in messages if m.get("role") == "system")
        converted: list[dict[str, Any]] = []
        pending_results: list[dict[str, Any]] = []
        for message in messages:
            role = message.get("role")
            if role == "system":
                continue
            if role == "tool":
                pending_results.append({
                    "type": "tool_result", "tool_use_id": message.get("tool_call_id", ""), "content": str(message.get("content", ""))
                })
                continue
            if pending_results:
                converted.append({"role": "user", "content": pending_results})
                pending_results = []
            if role == "assistant" and message.get("tool_calls"):
                content: list[dict[str, Any]] = []
                if message.get("content"):
                    content.append({"type": "text", "text": str(message["content"])})
                for call in message["tool_calls"]:
                    fn = call.get("function") or {}
                    raw = fn.get("arguments") or "{}"
                    try:
                        args = json.loads(raw) if isinstance(raw, str) else raw
                    except json.JSONDecodeError:
                        args = {}
                    content.append({"type": "tool_use", "id": call.get("id", ""), "name": fn.get("name", ""), "input": args})
                converted.append({"role": "assistant", "content": content})
            else:
                converted.append({"role": "assistant" if role == "assistant" else "user", "content": str(message.get("content", ""))})
        if pending_results:
            converted.append({"role": "user", "content": pending_results})
        anthropic_tools = []
        for tool in tools:
            fn = tool.get("function") or {}
            anthropic_tools.append({"name": fn.get("name", ""), "description": fn.get("description", ""), "input_schema": fn.get("parameters") or {"type": "object", "properties": {}}})
        raw = self._json_request(
            self.endpoint("anthropic") + "/messages",
            {"model": model, "system": system, "messages": converted, "tools": anthropic_tools, "max_tokens": 8192, "temperature": 0.2},
            self._auth_headers("anthropic"),
            "Anthropic",
        )
        text_parts, tool_calls = [], []
        for block in raw.get("content") or []:
            if block.get("type") == "text":
                text_parts.append(str(block.get("text", "")))
            elif block.get("type") == "tool_use":
                tool_calls.append({
                    "id": block.get("id", ""), "type": "function",
                    "function": {"name": block.get("name", ""), "arguments": json.dumps(block.get("input") or {})},
                })
        message: dict[str, Any] = {"role": "assistant", "content": "\n".join(text_parts)}
        if tool_calls:
            message["tool_calls"] = tool_calls
        return {"model": raw.get("model", model), "choices": [{"message": message}], "provider_response_id": raw.get("id")}

    def models(self, provider: str) -> list[dict[str, Any]]:
        provider = provider if provider in PROVIDER_ENDPOINTS else DEFAULT_PROVIDER
        url = self.endpoint(provider) + "/models"
        if provider == "openrouter":
            url += "?supported_parameters=tools&sort=pricing-low-to-high"
        try:
            data = self._json_request(url, None, self._auth_headers(provider), provider.title()).get("data", [])
        except Exception:
            return []
        rows = []
        for m in data[:250]:
            rows.append({
                "id": m.get("id"),
                "name": m.get("display_name") or m.get("name") or m.get("id"),
                "context_length": m.get("context_length"),
                "pricing": m.get("pricing") or {},
            })
        return rows


class PhantomPlayAI:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.saved = self.root / "Saved" / "PhantomAI"
        self.saved.mkdir(parents=True, exist_ok=True)
        self.settings_file = self.saved / "settings.json"
        self.key_files = {provider: self.saved / f"{provider}.key.dpapi" for provider in PROVIDER_ENDPOINTS}
        self.sandbox = ProjectSandbox(self.root)
        self.providers = ProviderClient(self)
        self.history: list[dict[str, Any]] = []
        self.chat_lock = threading.Lock()
        self.settings = self.load_settings()

    def load_settings(self) -> dict[str, Any]:
        data = {"provider": DEFAULT_PROVIDER, "model": PROVIDER_DEFAULTS[DEFAULT_PROVIDER], "endpoint": PROVIDER_ENDPOINTS["local"]}
        if self.settings_file.exists():
            try:
                data.update(json.loads(self.settings_file.read_text(encoding="utf-8")))
            except Exception:
                pass
        return data

    def save_settings(self, provider: str | None = None, model: str | None = None, endpoint: str | None = None, api_key: str | None = None) -> dict[str, Any]:
        provider = provider if provider in PROVIDER_ENDPOINTS else str(self.settings.get("provider", DEFAULT_PROVIDER))
        previous_provider = str(self.settings.get("provider", DEFAULT_PROVIDER))
        self.settings["provider"] = provider
        if model is not None:
            self.settings["model"] = model.strip()
        elif previous_provider != provider:
            self.settings["model"] = PROVIDER_DEFAULTS[provider]
        if endpoint is not None and provider == "local":
            value = endpoint.strip().rstrip("/")
            if value and not value.startswith(("http://127.0.0.1", "http://localhost")):
                raise ValueError("Local AI must use a localhost endpoint.")
            self.settings["endpoint"] = value or PROVIDER_ENDPOINTS["local"]
        self.settings_file.write_text(json_text(self.settings), encoding="utf-8")
        if api_key is not None and api_key.strip():
            save_secret(self.key_files[provider], api_key.strip())
        return self.public_settings()

    def public_settings(self) -> dict[str, Any]:
        provider = str(self.settings.get("provider", DEFAULT_PROVIDER))
        if provider not in PROVIDER_ENDPOINTS:
            provider = DEFAULT_PROVIDER
        return {
            "provider": provider,
            "model": self.settings.get("model", PROVIDER_DEFAULTS[provider]),
            "endpoint": self.settings.get("endpoint", PROVIDER_ENDPOINTS["local"]),
            "key_set": bool(self.providers.key(provider)),
            "requires_key": provider != "local",
        }

    def system_prompt(self, mode: str = "builder") -> str:
        readme = self._small_read("README.md", 12000)
        agents = self._small_read("AGENTS.md", 8000)
        return f"""You are PhantomPlay AI V18, the built-in lead Unreal Engine developer for this repository.
You are running locally from the actual project root: {self.root}

ACTIVE PORTFOLIO — all four games matter every development cycle:
- PhantomStrike (`phantom-strike`) — first-person shooter.
- Phantom Ages (`phantom-ages`) — fixed orthographic age-evolution lane battler.
- Phantom Legends (`phantom-legends`) — fantasy RTS / persistent settlement builder.
- CubeTown (`cubetown`) — voxel action-adventure / creative builder.

Operating contract:
1. INSPECT before editing. Search for existing implementations, callers, configs, maps and tools first.
2. Preserve game identities. One passing title cannot mask another failure.
3. Prefer the smallest strong change. Do not duplicate systems that already exist.
4. Use project file tools for C++/config/scripts and Unreal MCP for live editor/world/asset operations.
5. When Unreal MCP is connected, call `unreal_mcp_tools` first to discover the exact current schemas, then use `unreal_mcp_call`.
6. Build/test/validate after meaningful changes when a safe existing command or validation script is available.
7. Never claim compile, launch, gameplay, packaging or visual verification unless a tool actually ran it successfully.
8. Do not replace persistent maps/assets blindly. Use the editor and inspect references.
9. Keep production quality, performance, loading, controller, save, networking and shipping implications in mind.
10. Infer whether the user is asking a question or requesting implementation. Questions get direct answers; requested changes are implemented through the available tools without asking the user to switch modes.
11. Every write is automatically session-backed-up. Avoid destructive shell actions entirely.
12. If asked to improve PhantomPlay broadly, advance all four titles and shared infrastructure rather than tunnel-visioning one game.

PROJECT README:
{readme}

PROJECT AGENTS RULES:
{agents}
"""

    def _small_read(self, rel: str, limit: int) -> str:
        try:
            p = self.sandbox.resolve(rel)
            if p.exists():
                return p.read_text(encoding="utf-8", errors="replace")[:limit]
        except Exception:
            pass
        return "(not available)"

    def tool_defs(self, mode: str) -> list[dict[str, Any]]:
        tools = [
            self._tool("project_snapshot", "Inspect the actual PhantomPlay project state, four targets, git status, maps and key production files.", {}),
            self._tool("list_files", "List project files using a glob pattern. Generated/cache directories are excluded.", {
                "pattern": {"type": "string", "description": "Glob such as Source/**/*.cpp or Tools/*.py"},
                "limit": {"type": "integer", "description": "Maximum results, default 100"},
            }, ["pattern"]),
            self._tool("read_file", "Read a text source/config/doc file from the project with line numbers.", {
                "path": {"type": "string"}, "start_line": {"type": "integer"}, "max_lines": {"type": "integer"},
            }, ["path"]),
            self._tool("search_text", "Search text files in the project for an exact or regex pattern.", {
                "query": {"type": "string"}, "glob": {"type": "string", "description": "Optional glob like Source/**/*"},
                "regex": {"type": "boolean"}, "limit": {"type": "integer"},
            }, ["query"]),
            self._tool("git_diff", "Show git status/diff for the project without changing anything.", {
                "path": {"type": "string", "description": "Optional relative path"},
            }),
            self._tool("run_project_command", "Run an existing safe project build/validation script or npm build/test command. Inline destructive shell commands are blocked.", {
                "command": {"type": "string", "description": "Examples: py -3 Tools/ValidateProductionWorlds.py ; powershell -File Build-Flagships.ps1 ; npm run build"},
                "timeout": {"type": "integer", "description": "Seconds, maximum 1800"},
            }, ["command"]),
            self._tool("unreal_status", "Check whether the UE5.8 Unreal MCP server is live on localhost.", {}),
            self._tool("unreal_mcp_tools", "List the exact tool schemas currently exposed by Unreal MCP. Use this before calling Unreal tools.", {}),
            self._tool("unreal_mcp_call", "Call one exact Unreal MCP tool using the schema discovered from unreal_mcp_tools.", {
                "name": {"type": "string"}, "arguments": {"type": "object", "additionalProperties": True},
            }, ["name", "arguments"]),
            self._tool("launch_unreal_editor", "Launch this PhantomPlay project in UE5.8 with Unreal MCP enabled on localhost:8000.", {}),
        ]
        if mode == "builder":
            tools.extend([
                self._tool("replace_text", "Safely replace exact text in a project text file. The original is backed up for this AI session.", {
                    "path": {"type": "string"}, "old": {"type": "string"}, "new": {"type": "string"}, "count": {"type": "integer"},
                }, ["path", "old", "new"]),
                self._tool("write_file", "Create or fully rewrite a project text file. The previous version is backed up for this AI session.", {
                    "path": {"type": "string"}, "content": {"type": "string"},
                }, ["path", "content"]),
            ])
        return tools

    @staticmethod
    def _tool(name: str, description: str, properties: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
        return {"type": "function", "function": {"name": name, "description": description, "parameters": {
            "type": "object", "properties": properties, "required": required or [], "additionalProperties": False,
        }}}

    def execute_tool(self, name: str, args: dict[str, Any], mode: str) -> str:
        try:
            fn = getattr(self, f"tool_{name}", None)
            if not fn:
                return json_text({"ok": False, "error": f"Unknown tool: {name}"})
            if name in {"replace_text", "write_file"} and mode != "builder":
                return json_text({"ok": False, "error": "Read-only mode blocks writes."})
            return json_text(fn(**args))
        except Exception as exc:
            return json_text({"ok": False, "error": str(exc), "type": type(exc).__name__})

    def _iter_project_files(self):
        for p in self.root.rglob("*"):
            if not p.is_file():
                continue
            try:
                parts = p.relative_to(self.root).parts
            except Exception:
                continue
            if any(part in EXCLUDED_DIRS for part in parts):
                continue
            yield p

    def tool_project_snapshot(self) -> dict[str, Any]:
        targets = sorted(self.sandbox.relative(p) for p in self.root.glob("Source/*.Target.cs"))
        maps = sorted(self.sandbox.relative(p) for p in (self.root / "Content" / "Phantom" / "Worlds").glob("*.umap")) if (self.root / "Content" / "Phantom" / "Worlds").exists() else []
        status = self._git(["status", "--short"], 20)
        return {
            "ok": True, "project": str(self.root), "portfolio": PORTFOLIO, "targets": targets, "worlds": maps,
            "git_status": status, "mcp": self.tool_unreal_status(),
            "production_docs": sorted(self.sandbox.relative(p) for p in (self.root / "Docs" / "Production").glob("*.md"))[:80] if (self.root / "Docs" / "Production").exists() else [],
        }

    def tool_list_files(self, pattern: str, limit: int = 100) -> dict[str, Any]:
        limit = max(1, min(int(limit or 100), 500))
        pattern = pattern.replace("\\", "/")
        rows = []
        for p in self._iter_project_files():
            rel = self.sandbox.relative(p)
            if fnmatch.fnmatch(rel, pattern) or fnmatch.fnmatch(p.name, pattern):
                rows.append({"path": rel, "size": p.stat().st_size})
                if len(rows) >= limit:
                    break
        return {"ok": True, "files": rows, "truncated": len(rows) >= limit}

    def tool_read_file(self, path: str, start_line: int = 1, max_lines: int = 250) -> dict[str, Any]:
        p = self.sandbox.resolve(path)
        if not p.exists() or not p.is_file():
            raise FileNotFoundError(path)
        if not is_text_path(p):
            raise ValueError("read_file is for text/source/config files; use Unreal MCP for .uasset/.umap inspection")
        if p.stat().st_size > MAX_READ_BYTES:
            raise ValueError(f"File is too large for direct text read ({p.stat().st_size} bytes)")
        lines = p.read_text(encoding="utf-8", errors="replace").splitlines()
        start = max(1, int(start_line or 1))
        count = max(1, min(int(max_lines or 250), 800))
        chunk = lines[start - 1:start - 1 + count]
        numbered = "\n".join(f"{i}: {line}" for i, line in enumerate(chunk, start))
        return {"ok": True, "path": self.sandbox.relative(p), "start": start, "total_lines": len(lines), "content": numbered}

    def tool_search_text(self, query: str, glob: str = "*", regex: bool = False, limit: int = 120) -> dict[str, Any]:
        limit = max(1, min(int(limit or 120), 500))
        matcher = re.compile(query, re.IGNORECASE) if regex else None
        rows = []
        for p in self._iter_project_files():
            rel = self.sandbox.relative(p)
            if glob and glob != "*" and not (fnmatch.fnmatch(rel, glob) or fnmatch.fnmatch(p.name, glob)):
                continue
            if not is_text_path(p) or p.stat().st_size > MAX_READ_BYTES:
                continue
            try:
                for idx, line in enumerate(p.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
                    hit = bool(matcher.search(line)) if matcher else query.lower() in line.lower()
                    if hit:
                        rows.append({"path": rel, "line": idx, "text": line.strip()[:600]})
                        if len(rows) >= limit:
                            return {"ok": True, "matches": rows, "truncated": True}
            except Exception:
                continue
        return {"ok": True, "matches": rows, "truncated": False}

    def tool_replace_text(self, path: str, old: str, new: str, count: int = 1) -> dict[str, Any]:
        p = self.sandbox.resolve(path)
        if not p.exists() or not p.is_file() or not is_text_path(p):
            raise ValueError("replace_text requires an existing text project file")
        data = p.read_text(encoding="utf-8", errors="strict")
        occurrences = data.count(old)
        if occurrences == 0:
            raise ValueError("Exact old text was not found. Re-read the file before editing.")
        count = int(count or 1)
        if count < 0:
            count = occurrences
        self.sandbox.backup(p)
        updated = data.replace(old, new, count)
        if len(updated.encode("utf-8")) > MAX_WRITE_BYTES:
            raise ValueError("Result exceeds safe write size")
        p.write_text(updated, encoding="utf-8", newline="")
        return {"ok": True, "path": self.sandbox.relative(p), "replaced": min(occurrences, count), "backup": str(self.sandbox.backup_root)}

    def tool_write_file(self, path: str, content: str) -> dict[str, Any]:
        p = self.sandbox.resolve(path)
        if not is_text_path(p):
            raise ValueError("write_file only permits source/config/text extensions; use Unreal MCP for assets/maps")
        encoded = content.encode("utf-8")
        if len(encoded) > MAX_WRITE_BYTES:
            raise ValueError("Content exceeds safe write size")
        self.sandbox.backup(p)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(encoded)
        return {"ok": True, "path": self.sandbox.relative(p), "bytes": len(encoded), "backup": str(self.sandbox.backup_root)}

    def _git(self, args: list[str], timeout: int = 60) -> str:
        try:
            cp = subprocess.run(["git", "-C", str(self.root), *args], capture_output=True, text=True, timeout=timeout, errors="replace")
            return (cp.stdout + cp.stderr)[-30000:]
        except Exception as exc:
            return f"git unavailable: {exc}"

    def tool_git_diff(self, path: str = "") -> dict[str, Any]:
        status = self._git(["status", "--short"])
        args = ["diff", "--"]
        if path:
            args.append(path)
        diff = self._git(args)
        return {"ok": True, "status": status, "diff": diff[-40000:]}

    def tool_run_project_command(self, command: str, timeout: int = 900) -> dict[str, Any]:
        timeout = max(1, min(int(timeout or 900), 1800))
        if any(ch in command for ch in ["\n", "\r", "&&", "||", ";", "|", ">", "<"]):
            raise ValueError("Only one direct command is allowed; shell chaining/redirection is blocked")
        try:
            parts = shlex.split(command, posix=False)
        except ValueError as exc:
            raise ValueError(f"Cannot parse command: {exc}")
        if not parts:
            raise ValueError("Empty command")
        parts = [p.strip('"') for p in parts]
        exe = Path(parts[0]).name.lower()
        blocked = re.compile(r"(?i)\b(remove-item|del|erase|rmdir|rd|format|diskpart|shutdown|reg\s+delete|reset\s+--hard|clean\s+-f|curl|wget|invoke-webrequest)\b")
        if blocked.search(command):
            raise ValueError("Destructive/download command is blocked by PhantomPlay AI safety")

        cmd: list[str]
        if exe in {"py", "py.exe", "python", "python.exe"}:
            if len(parts) < 2:
                raise ValueError("Python command must name an existing project script")
            script_index = 2 if len(parts) > 2 and parts[1] == "-3" else 1
            script = self.sandbox.resolve(parts[script_index])
            if not script.exists() or script.suffix.lower() != ".py":
                raise ValueError("Python may only run an existing .py script inside the project")
            cmd = parts[:script_index] + [str(script)] + parts[script_index + 1:]
        elif exe in {"powershell", "powershell.exe", "pwsh", "pwsh.exe"}:
            lowers = [p.lower() for p in parts]
            if "-file" not in lowers:
                raise ValueError("PowerShell is limited to -File with an existing project .ps1 script")
            idx = lowers.index("-file") + 1
            if idx >= len(parts):
                raise ValueError("-File path is missing")
            script = self.sandbox.resolve(parts[idx])
            if not script.exists() or script.suffix.lower() != ".ps1":
                raise ValueError("PowerShell may only run an existing .ps1 inside the project")
            cmd = parts[:]
            cmd[idx] = str(script)
        elif exe in {"npm", "npm.cmd", "npm.exe"}:
            if len(parts) < 3 or parts[1].lower() != "run":
                raise ValueError("npm is limited to existing npm run scripts")
            cmd = parts
        elif exe in {"git", "git.exe"}:
            if len(parts) < 2 or parts[1].lower() not in {"status", "diff", "log", "show", "rev-parse"}:
                raise ValueError("Git writes are blocked; only status/diff/log/show/rev-parse are permitted")
            cmd = ["git", "-C", str(self.root), *parts[1:]]
        else:
            raise ValueError("Allowed commands: project Python scripts, project PowerShell -File scripts, npm run scripts, read-only git")

        started = time.time()
        cp = subprocess.run(cmd, cwd=self.root, capture_output=True, text=True, timeout=timeout, errors="replace")
        output = (cp.stdout or "") + (cp.stderr or "")
        return {"ok": cp.returncode == 0, "exit_code": cp.returncode, "seconds": round(time.time() - started, 2), "output": output[-50000:]}

    def _mcp(self) -> UnrealMCPClient:
        return UnrealMCPClient(MCP_URL, timeout=30)

    def tool_unreal_status(self) -> dict[str, Any]:
        try:
            return self._mcp().ping()
        except Exception as exc:
            return {"ok": False, "url": MCP_URL, "error": str(exc)}

    def tool_unreal_mcp_tools(self) -> dict[str, Any]:
        return {"ok": True, **self._mcp().list_tools()}

    def tool_unreal_mcp_call(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        return {"ok": True, "tool": name, "result": self._mcp().call_tool(name, arguments)}

    @staticmethod
    def discover_unreal_editor() -> Path | None:
        env = os.getenv("UNREAL_ENGINE_ROOT")
        candidates = []
        if env:
            candidates.append(Path(env))
        candidates += [
            Path(r"C:\Program Files\Epic Games\UE_5.8"),
            Path(r"C:\Epic Games\UE_5.8"),
            Path(r"D:\Epic Games\UE_5.8"),
            Path(r"E:\Epic Games\UE_5.8"),
            Path(r"H:\UE_5.8"),
        ]
        if os.name == "nt":
            manifest = Path(os.getenv("PROGRAMDATA", r"C:\ProgramData")) / "Epic" / "UnrealEngineLauncher" / "LauncherInstalled.dat"
            if manifest.exists():
                try:
                    data = json.loads(manifest.read_text(encoding="utf-8-sig"))
                    for item in data.get("InstallationList", []):
                        app = str(item.get("AppName", ""))
                        if "5.8" in app or str(item.get("AppVersion", "")).startswith("5.8"):
                            candidates.insert(0, Path(item.get("InstallLocation", "")))
                except Exception:
                    pass
        for root in candidates:
            exe = root / "Engine" / "Binaries" / "Win64" / "UnrealEditor.exe"
            if exe.exists():
                return exe
        return None

    def tool_launch_unreal_editor(self) -> dict[str, Any]:
        status = self.tool_unreal_status()
        if status.get("ok"):
            return {"ok": True, "already_running": True, "mcp": status}
        exe = self.discover_unreal_editor()
        if not exe:
            return {"ok": False, "error": "UE5.8 UnrealEditor.exe was not found. Set UNREAL_ENGINE_ROOT to the UE 5.8 install root."}
        uproject = self.root / "PhantomGames.uproject"
        proc = subprocess.Popen([
            str(exe), str(uproject), "-ModelContextProtocolStartServer", "-ModelContextProtocolPort=8000"
        ], cwd=self.root)
        return {"ok": True, "pid": proc.pid, "editor": str(exe), "note": "Unreal is launching; MCP becomes available after editor startup."}

    def chat(self, user_text: str, model: str, provider: str) -> dict[str, Any]:
        with self.chat_lock:
            provider = provider if provider in PROVIDER_ENDPOINTS else str(self.settings.get("provider", DEFAULT_PROVIDER))
            model = model or str(self.settings.get("model", PROVIDER_DEFAULTS[provider]))
            mode = "builder"
            messages: list[dict[str, Any]] = [{"role": "system", "content": self.system_prompt(mode)}]
            messages.extend(self.history[-24:])
            messages.append({"role": "user", "content": user_text})
            tools = self.tool_defs(mode)
            trace: list[dict[str, Any]] = []
            final = ""
            used_model = model

            for step in range(20):
                response = self.providers.request(messages, tools, model, provider)
                if response.get("model"):
                    used_model = response["model"]
                choices = response.get("choices") or []
                if not choices:
                    raise RuntimeError(f"Model returned no choices: {json_text(response)[:1800]}")
                msg = choices[0].get("message") or {}
                assistant_msg: dict[str, Any] = {"role": "assistant", "content": msg.get("content") or ""}
                if msg.get("tool_calls"):
                    assistant_msg["tool_calls"] = msg["tool_calls"]
                messages.append(assistant_msg)
                calls = msg.get("tool_calls") or []
                if not calls:
                    final = msg.get("content") or "Done."
                    break
                for call in calls:
                    fn = (call.get("function") or {}).get("name", "")
                    raw_args = (call.get("function") or {}).get("arguments") or "{}"
                    try:
                        args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
                    except json.JSONDecodeError:
                        args = {}
                    result = self.execute_tool(fn, args or {}, mode)
                    trace.append({"tool": fn, "args": args, "result": result[:4000]})
                    messages.append({"role": "tool", "tool_call_id": call.get("id", ""), "content": result})
            else:
                final = "Stopped after 20 tool/model turns to prevent an accidental infinite loop. Review the tool trace and continue if needed."

            self.history.append({"role": "user", "content": user_text})
            self.history.append({"role": "assistant", "content": final})
            self.history = self.history[-40:]
            return {"ok": True, "answer": final, "model": used_model, "provider": provider, "trace": trace}

    def status(self) -> dict[str, Any]:
        return {
            "ok": True, "version": APP_VERSION, "project": str(self.root), "settings": self.public_settings(),
            "unreal": self.tool_unreal_status(), "session_backup": str(self.sandbox.backup_root),
        }


HTML = r'''<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PhantomPlay AI</title>
<style>
:root{--bg:#090b0d;--panel:#11161a;--panel2:#171e23;--line:#263038;--text:#f1f5f7;--muted:#8fa0aa;--green:#66ff9a;--cyan:#54d9ff;--red:#ff6d7a;--yellow:#ffd166}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 20% 0,#13221b 0,#090b0d 35%);color:var(--text);font-family:Inter,Segoe UI,Arial,sans-serif;height:100vh;display:flex;flex-direction:column}
header{padding:14px 20px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:14px;background:#0b0f12e8;backdrop-filter:blur(10px)}
.logo{font-weight:900;letter-spacing:.08em}.logo span{color:var(--green)}.pill{padding:5px 9px;border:1px solid var(--line);border-radius:999px;color:var(--muted);font-size:12px}.spacer{flex:1}
button,select,input,textarea{font:inherit}button{background:var(--panel2);border:1px solid var(--line);color:var(--text);padding:9px 12px;border-radius:9px;cursor:pointer}button:hover{border-color:#4b606e}button.primary{background:#143a22;border-color:#2b7545;color:#dffff0}.danger{color:#ffc1c6!important}
main{display:grid;grid-template-columns:330px 1fr;flex:1;min-height:0}.side{border-right:1px solid var(--line);padding:16px;overflow:auto;background:#0d1114}.side h3{font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:var(--muted);margin:18px 0 8px}.field{display:flex;flex-direction:column;gap:6px;margin-bottom:10px}.field label{font-size:12px;color:var(--muted)}input,select{width:100%;background:#080b0d;border:1px solid var(--line);color:var(--text);padding:9px;border-radius:8px}.status{font-size:12px;line-height:1.6;color:var(--muted)}.good{color:var(--green)}.bad{color:var(--red)}
.chat{display:flex;flex-direction:column;min-width:0;min-height:0}.messages{flex:1;overflow:auto;padding:24px max(24px,7vw)}.msg{max-width:1050px;margin:0 auto 18px;border:1px solid var(--line);background:var(--panel);padding:15px 17px;border-radius:12px;white-space:pre-wrap;line-height:1.5}.msg.user{border-color:#315845;background:#0e1a14}.who{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}.msg.user .who{color:var(--green)}.msg.ai .who{color:var(--cyan)}
.composer{border-top:1px solid var(--line);padding:14px max(20px,7vw);background:#0b0f12}.row{max-width:1050px;margin:auto;display:flex;gap:10px}textarea{flex:1;resize:none;min-height:64px;max-height:180px;background:#080b0d;border:1px solid var(--line);color:var(--text);padding:12px;border-radius:10px}.quick{max-width:1050px;margin:0 auto 10px;display:flex;gap:8px;flex-wrap:wrap}.quick button{font-size:12px;padding:7px 10px}.trace{max-width:1050px;margin:-10px auto 18px;color:var(--muted);font-size:12px}
@media(max-width:900px){main{grid-template-columns:1fr}.side{display:none}}
</style></head>
<body><header><div class="logo">PHANTOM<span>PLAY AI</span></div><div class="pill">V18 • ONE INTELLIGENT WORKSPACE</div><div class="spacer"></div><div id="mcpPill" class="pill">UNREAL: CHECKING</div></header>
<main><aside class="side"><h3>AI engine</h3><div class="field"><label>Who powers PhantomPlay AI</label><select id="provider" onchange="providerChanged()"><option value="local">Local AI</option><option value="openai">OpenAI / Codex</option><option value="anthropic">Anthropic Claude</option><option value="openrouter">OpenRouter</option></select></div><div class="field"><label>Model</label><input id="model" list="models" placeholder="Choose any available model"><datalist id="models"></datalist></div><div class="field" id="endpointField"><label>Local server</label><input id="endpoint" value="http://127.0.0.1:11434/v1"></div><div class="field" id="keyField"><label id="keyLabel">API key — encrypted on this PC</label><input id="key" type="password" placeholder="Paste once to connect"></div><button class="primary" onclick="saveSettings()">Connect engine</button>
<h3>Unreal Engine</h3><button onclick="launchUnreal()">Launch / Connect UE5.8 + MCP</button><div id="status" class="status" style="margin-top:10px"></div>
<h3>Session safety</h3><button class="danger" onclick="rollback()">Rollback AI file edits this session</button><div class="status" style="margin-top:8px">Source writes are backed up under <code>Saved/PhantomAI/backups</code>. Binary assets/maps should be edited through Unreal MCP.</div>
<h3>What this is</h3><div class="status">One project-local coding + Unreal agent. Ask a question or request a build in the same conversation—there are no answer/build/research modes to manage. The selected AI engine can read the real repository, edit source, run validation, and drive UE5.8 through local MCP tools.</div></aside>
<section class="chat"><div id="messages" class="messages"><div class="msg ai"><div class="who">PhantomPlay AI</div>I’m attached to the real PhantomPlay repo. Tell me what you want built, fixed, audited, or improved. I can work on PhantomStrike, Phantom Ages, Phantom Legends, CubeTown, and shared Unreal infrastructure.</div></div>
<div class="composer"><div class="quick"><button onclick="quick('Inspect the actual project and tell me the highest-value next improvement across all four games. Do not edit yet.')">Audit all 4</button><button onclick="quick('Implement one high-value gameplay or reliability improvement in each of the four games. Inspect first, preserve architecture, validate everything you can, and summarize exact files changed.')">Improve all 4</button><button onclick="quick('Connect to Unreal MCP, inspect the currently open world and selected actors, and tell me what you can improve in the live editor.')">Inspect Unreal</button><button onclick="quick('Run the safest available static validation for the current project and fix any source-level regressions you can prove.')">Validate + fix</button></div><div class="row"><textarea id="prompt" placeholder="Example: Make PhantomStrike movement and gun feel closer to classic fast FPS pacing, then validate the source changes."></textarea><button class="primary" id="send" onclick="send()">Send</button></div></div></section></main>
<script>
const $=id=>document.getElementById(id);function esc(s){return String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}
async function api(path,body){let r=await fetch(path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});let j=await r.json();if(!r.ok||j.ok===false&&j.error)throw new Error(j.error||('HTTP '+r.status));return j}
function add(who,text,cls='ai'){let d=document.createElement('div');d.className='msg '+cls;d.innerHTML='<div class="who">'+esc(who)+'</div>'+esc(text);$('messages').appendChild(d);$('messages').scrollTop=$('messages').scrollHeight;return d}
const modelDefaults={local:'',openai:'gpt-5',anthropic:'claude-sonnet-4-5',openrouter:'openrouter/auto'};
function updateProviderFields(){let p=$('provider').value;$('endpointField').style.display=p==='local'?'flex':'none';$('keyField').style.display=p==='local'?'none':'flex';$('keyLabel').textContent=({openai:'OpenAI API key — encrypted on this PC',anthropic:'Anthropic API key — encrypted on this PC',openrouter:'OpenRouter API key — encrypted on this PC'})[p]||'API key'}
async function providerChanged(){updateProviderFields();$('model').value=modelDefaults[$('provider').value]||'';await models()}
async function refresh(){try{let s=await api('/api/status');$('provider').value=s.settings.provider||'openrouter';$('model').value=s.settings.model||modelDefaults[$('provider').value]||'';$('endpoint').value=s.settings.endpoint||'http://127.0.0.1:11434/v1';updateProviderFields();let u=s.unreal||{},ready=!s.settings.requires_key||s.settings.key_set;$('mcpPill').textContent=u.ok?'UNREAL MCP: CONNECTED':'UNREAL MCP: OFFLINE';$('mcpPill').className='pill '+(u.ok?'good':'bad');$('status').innerHTML='<span class="'+(ready?'good':'bad')+'">AI engine: '+(ready?'connected':'connect once')+'</span><br><span class="'+(u.ok?'good':'bad')+'">'+(u.ok?'Unreal connected at '+esc(u.url):'Unreal offline — launch with the button above')+'</span><br>Project: '+esc(s.project)}catch(e){$('status').textContent=e.message}}
async function models(){try{let p=$('provider').value,m=await api('/api/models?provider='+encodeURIComponent(p));$('models').innerHTML=m.models.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join('');if(!$('model').value&&m.models.length)$('model').value=m.models[0].id}catch(e){$('models').innerHTML=''}}
async function saveSettings(){try{let body={provider:$('provider').value,model:$('model').value,endpoint:$('endpoint').value};if($('key').value)body.api_key=$('key').value;await api('/api/settings',body);$('key').value='';await refresh();await models();add('System','AI engine connected. Questions and implementation now share one conversation.')}catch(e){add('Error',e.message)}}
async function launchUnreal(){try{let r=await api('/api/launch-unreal',{});add('System',r.already_running?'Unreal MCP is already connected.':'Unreal Editor is launching with MCP enabled. Give the editor time to load, then the status will turn green.');setTimeout(refresh,5000)}catch(e){add('Error',e.message)}}
async function rollback(){if(!confirm('Restore every source/config file PhantomPlay AI changed in THIS session?'))return;try{let r=await api('/api/rollback',{});add('System','Rollback complete. Restored '+r.restored.length+' files; removed '+r.removed.length+' newly-created files.')}catch(e){add('Error',e.message)}}
function quick(t){$('prompt').value=t;$('prompt').focus()}
async function send(){let text=$('prompt').value.trim();if(!text)return;$('prompt').value='';add('You',text,'user');let wait=add('PhantomPlay AI','Working on the actual project…');$('send').disabled=true;try{let r=await api('/api/chat',{message:text,model:$('model').value,provider:$('provider').value});wait.innerHTML='<div class="who">PhantomPlay AI • '+esc(r.provider)+' / '+esc(r.model)+'</div>'+esc(r.answer);if(r.trace&&r.trace.length){let t=document.createElement('div');t.className='trace';t.textContent='Tools used: '+r.trace.map(x=>x.tool).join(' → ');$('messages').appendChild(t)}$('messages').scrollTop=$('messages').scrollHeight}catch(e){wait.innerHTML='<div class="who">Error</div>'+esc(e.message)}finally{$('send').disabled=false;refresh()}}
$('prompt').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}});refresh().then(models);setInterval(refresh,15000);
</script></body></html>'''


class Handler(BaseHTTPRequestHandler):
    app: PhantomPlayAI = None  # type: ignore

    def log_message(self, fmt: str, *args: Any) -> None:
        print("[PhantomPlayAI]", fmt % args)

    def _send(self, status: int, data: Any, content_type: str = "application/json; charset=utf-8"):
        raw = data.encode("utf-8") if isinstance(data, str) else json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def _json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0") or "0")
        return json.loads(self.rfile.read(length).decode("utf-8")) if length else {}

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        try:
            if path == "/":
                self._send(200, HTML, "text/html; charset=utf-8")
            elif path == "/api/status":
                self._send(200, self.app.status())
            elif path == "/api/models":
                query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                provider = str((query.get("provider") or [self.app.public_settings()["provider"]])[0])
                self._send(200, {"ok": True, "models": self.app.providers.models(provider)})
            else:
                self._send(404, {"ok": False, "error": "Not found"})
        except Exception as exc:
            self._send(500, {"ok": False, "error": str(exc)})

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        try:
            body = self._json()
            if path == "/api/settings":
                result = self.app.save_settings(body.get("provider"), body.get("model"), body.get("endpoint"), body.get("api_key"))
                self._send(200, {"ok": True, **result})
            elif path == "/api/chat":
                msg = str(body.get("message", "")).strip()
                if not msg:
                    raise ValueError("Message is empty")
                self._send(200, self.app.chat(msg, str(body.get("model", "")), str(body.get("provider", ""))))
            elif path == "/api/launch-unreal":
                self._send(200, self.app.tool_launch_unreal_editor())
            elif path == "/api/rollback":
                self._send(200, {"ok": True, **self.app.sandbox.rollback()})
            else:
                self._send(404, {"ok": False, "error": "Not found"})
        except Exception as exc:
            traceback.print_exc()
            self._send(500, {"ok": False, "error": str(exc)})


def self_test(app: PhantomPlayAI) -> int:
    checks = {
        "project_exists": app.root.exists(),
        "uproject": (app.root / "PhantomGames.uproject").exists(),
        "four_targets": all((app.root / "Source" / f"{target}.Target.cs").exists() for target in ["PhantomStrike", "PhantomAges", "PhantomLegends", "Cubetown"]),
        "sandbox_blocks_escape": False,
    }
    try:
        app.sandbox.resolve("../../outside.txt")
    except ValueError:
        checks["sandbox_blocks_escape"] = True
    print(json_text({"version": APP_VERSION, "checks": checks, "project": str(app.root), "settings": app.public_settings()}))
    return 0 if all(checks.values()) else 2


def main() -> int:
    parser = argparse.ArgumentParser(description="PhantomPlay built-in AI development agent")
    parser.add_argument("--project", default=str(Path(__file__).resolve().parents[2]))
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--launch-unreal", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    root = Path(args.project).resolve()
    app = PhantomPlayAI(root)
    if args.self_test:
        return self_test(app)
    if args.launch_unreal and not app.tool_unreal_status().get("ok"):
        result = app.tool_launch_unreal_editor()
        print("Unreal:", json_text(result))

    Handler.app = app
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    url = f"http://127.0.0.1:{args.port}/"
    print(f"PhantomPlay AI V{APP_VERSION}")
    print(f"Project: {root}")
    print(f"UI: {url}")
    print("The web UI binds to localhost only.")
    if not args.no_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
