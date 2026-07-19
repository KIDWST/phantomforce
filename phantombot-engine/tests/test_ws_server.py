import asyncio
import json
import os
import sys

import pytest
import websockets

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import ws_server  # noqa: E402


def test_generate_token_is_nonempty_and_unique():
    a = ws_server.generate_token()
    b = ws_server.generate_token()
    assert len(a) >= 32
    assert a != b


@pytest.mark.asyncio
async def test_server_rejects_missing_token(tmp_path, monkeypatch):
    monkeypatch.setattr(ws_server, "OUTPUT_DIR", str(tmp_path))

    class FakeLoop:
        def run_turn(self, messages, prompt):
            return messages + [{"role": "assistant", "content": "ok"}]

    server = ws_server.PhantomBotServer(lambda on_event: FakeLoop(), host="127.0.0.1", port=8799)
    async with server._serve():
        async with websockets.connect("ws://127.0.0.1:8799") as ws:
            await ws.send(json.dumps({"prompt": "hi"}))  # no token
            reply = json.loads(await ws.recv())
            assert reply["type"] == "error"
            assert "unauthorized" in reply["message"].lower()


@pytest.mark.asyncio
async def test_server_accepts_valid_token_and_streams_final(tmp_path, monkeypatch):
    monkeypatch.setattr(ws_server, "OUTPUT_DIR", str(tmp_path))

    class FakeLoop:
        def run_turn(self, messages, prompt):
            return messages + [{"role": "assistant", "content": "hello back"}]

    server = ws_server.PhantomBotServer(lambda on_event: FakeLoop(), host="127.0.0.1", port=8798)
    async with server._serve():
        async with websockets.connect("ws://127.0.0.1:8798") as ws:
            await ws.send(json.dumps({"token": server.token, "prompt": "hi"}))
            reply = json.loads(await ws.recv())
            assert reply["type"] == "final"
            assert reply["message"] == "hello back"


@pytest.mark.asyncio
async def test_server_streams_events_before_final(tmp_path, monkeypatch):
    monkeypatch.setattr(ws_server, "OUTPUT_DIR", str(tmp_path))

    class FakeLoop:
        def __init__(self, on_event):
            self._on_event = on_event

        def run_turn(self, messages, prompt):
            self._on_event("delta", "Hel")
            self._on_event("delta", "lo")
            return messages + [{"role": "assistant", "content": "Hello"}]

    server = ws_server.PhantomBotServer(lambda on_event: FakeLoop(on_event), host="127.0.0.1", port=8797)
    async with server._serve():
        async with websockets.connect("ws://127.0.0.1:8797") as ws:
            await ws.send(json.dumps({"token": server.token, "prompt": "hi"}))
            first = json.loads(await ws.recv())
            second = json.loads(await ws.recv())
            final = json.loads(await ws.recv())
            assert first == {"type": "delta", "payload": "Hel"}
            assert second == {"type": "delta", "payload": "lo"}
            assert final["type"] == "final"
            assert final["message"] == "Hello"


@pytest.mark.asyncio
async def test_server_does_not_double_send_final(tmp_path, monkeypatch):
    monkeypatch.setattr(ws_server, "OUTPUT_DIR", str(tmp_path))

    class FakeLoop:
        def __init__(self, on_event):
            self._on_event = on_event

        def run_turn(self, messages, prompt):
            self._on_event("delta", "Hi")
            self._on_event("final", "Hi")  # AgentLoop always does this as its last event
            return messages + [{"role": "assistant", "content": "Hi"}]

    server = ws_server.PhantomBotServer(lambda on_event: FakeLoop(on_event), host="127.0.0.1", port=8796)
    async with server._serve():
        async with websockets.connect("ws://127.0.0.1:8796") as ws:
            await ws.send(json.dumps({"token": server.token, "prompt": "hi"}))
            received = []
            for _ in range(2):
                received.append(json.loads(await ws.recv()))
            assert received[0] == {"type": "delta", "payload": "Hi"}
            assert received[1] == {"type": "final", "message": "Hi"}
            # confirm no THIRD message arrives (i.e. the internal "final" event was not also forwarded)
            with pytest.raises(asyncio.TimeoutError):
                await asyncio.wait_for(ws.recv(), timeout=0.3)
