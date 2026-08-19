from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any


class MCPError(RuntimeError):
    pass


class UnrealMCPClient:
    """Minimal Streamable HTTP MCP client for Unreal Engine 5.8's local MCP server."""

    def __init__(self, url: str = "http://127.0.0.1:8000/mcp", timeout: float = 20.0):
        self.url = url
        self.timeout = timeout
        self.session_id: str | None = None
        self.protocol_version = "2025-06-18"
        self._next_id = 1
        self._initialized = False

    @staticmethod
    def _decode_body(raw: bytes, content_type: str) -> Any:
        text = raw.decode("utf-8", errors="replace").strip()
        if not text:
            return None
        if "text/event-stream" in content_type or text.startswith("event:") or "\ndata:" in text:
            payloads = []
            for line in text.splitlines():
                if line.startswith("data:"):
                    part = line[5:].strip()
                    if part and part != "[DONE]":
                        try:
                            payloads.append(json.loads(part))
                        except json.JSONDecodeError:
                            pass
            if payloads:
                return payloads[-1]
        try:
            return json.loads(text)
        except json.JSONDecodeError as exc:
            raise MCPError(f"Unreal MCP returned non-JSON data: {text[:600]}") from exc

    def _post(self, method: str, params: dict[str, Any] | None = None, notification: bool = False) -> Any:
        payload: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
        if not notification:
            payload["id"] = self._next_id
            self._next_id += 1
        if params is not None:
            payload["params"] = params

        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "Origin": "http://127.0.0.1",
            "Mcp-Method": method,
        }
        name = (params or {}).get("name")
        if name:
            headers["Mcp-Name"] = str(name)
        if self.session_id:
            headers["Mcp-Session-Id"] = self.session_id
            headers["MCP-Protocol-Version"] = self.protocol_version

        req = urllib.request.Request(
            self.url,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                sid = resp.headers.get("Mcp-Session-Id") or resp.headers.get("MCP-Session-Id")
                if sid:
                    self.session_id = sid
                body = self._decode_body(resp.read(), resp.headers.get("Content-Type", ""))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:1000]
            raise MCPError(f"Unreal MCP HTTP {exc.code}: {detail}") from exc
        except Exception as exc:
            raise MCPError(f"Cannot reach Unreal MCP at {self.url}: {exc}") from exc

        if isinstance(body, dict) and "error" in body:
            raise MCPError(json.dumps(body["error"], ensure_ascii=False))
        if notification:
            return body
        if not isinstance(body, dict):
            raise MCPError(f"Unexpected Unreal MCP response: {body!r}")
        return body.get("result")

    def initialize(self) -> dict[str, Any]:
        if self._initialized:
            return {"ok": True, "protocolVersion": self.protocol_version, "session": self.session_id}
        result = self._post(
            "initialize",
            {
                "protocolVersion": self.protocol_version,
                "capabilities": {},
                "clientInfo": {"name": "phantomplay-ai", "title": "PhantomPlay AI", "version": "18.0"},
            },
        )
        if isinstance(result, dict) and result.get("protocolVersion"):
            self.protocol_version = str(result["protocolVersion"])
        self._post("notifications/initialized", notification=True)
        self._initialized = True
        return result or {"ok": True}

    def ping(self) -> dict[str, Any]:
        self.initialize()
        try:
            self._post("ping", {})
        except MCPError:
            # Some servers omit ping; a tools/list is enough to prove the session is live.
            self._post("tools/list", {})
        return {"ok": True, "url": self.url, "session": self.session_id, "protocol": self.protocol_version}

    def list_tools(self) -> dict[str, Any]:
        self.initialize()
        result = self._post("tools/list", {})
        return result if isinstance(result, dict) else {"result": result}

    def call_tool(self, name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
        self.initialize()
        result = self._post("tools/call", {"name": name, "arguments": arguments or {}})
        return result if isinstance(result, dict) else {"result": result}
