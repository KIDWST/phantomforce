import asyncio
import contextlib
import json
import os
import secrets
import sys

import websockets

_DEFAULT_OUTPUT = "~/Phantombot-Unleashed/output" if sys.platform.startswith("win") else "~/.redfin/output"
OUTPUT_DIR = os.path.abspath(os.path.expanduser(os.environ.get("PHANTOMBOT_OUTPUT_DIR", _DEFAULT_OUTPUT)))


def token_path():
    return os.path.join(OUTPUT_DIR, "phantombot-ws-token.txt")


def generate_token():
    return secrets.token_hex(32)


class StreamingBridge:
    """Bridges AgentLoop's synchronous on_event callbacks (fired from the
    executor thread running run_turn, since ollama_client.stream_chat uses
    blocking urllib) into this connection's asyncio event loop."""

    def __init__(self, loop, queue):
        self._loop = loop
        self._queue = queue

    def __call__(self, kind, payload):
        self._loop.call_soon_threadsafe(self._queue.put_nowait, (kind, payload))


class PhantomBotServer:
    def __init__(self, agent_loop_factory, host="127.0.0.1", port=8766):
        if host != "127.0.0.1" and host != "localhost":
            raise ValueError("PhantomBotServer only binds loopback addresses.")
        self.agent_loop_factory = agent_loop_factory
        self.host = host
        self.port = port
        self.token = generate_token()
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        with open(token_path(), "w", encoding="utf-8") as f:
            f.write(self.token)
        self._sessions = {}

    async def _run_turn_streaming(self, websocket, messages, prompt):
        queue = asyncio.Queue()
        loop = asyncio.get_running_loop()
        bridge = StreamingBridge(loop, queue)
        agent = self.agent_loop_factory(bridge)

        async def worker():
            try:
                result = await loop.run_in_executor(None, agent.run_turn, messages, prompt)
            except Exception as exc:
                # Both cloud and local exhausted (or some other run_turn
                # failure): surface it as a queue message instead of letting
                # it propagate out of worker() unseen, which would leave the
                # consumer loop below awaiting queue.get() forever and hang
                # the socket with no response.
                await queue.put(("__error__", str(exc)))
                return
            await queue.put(("__done__", result))

        task = asyncio.ensure_future(worker())
        final_messages = messages
        error_message = None
        while True:
            kind, payload = await queue.get()
            if kind == "__done__":
                final_messages = payload
                break
            if kind == "__error__":
                error_message = payload
                break
            if kind == "final":
                continue  # _handle_client sends the authoritative final message itself
            await websocket.send(json.dumps({"type": kind, "payload": payload}))
        await task
        return final_messages, error_message

    async def _handle_client(self, websocket):
        session_id = id(websocket)
        self._sessions[session_id] = [{"role": "system", "content": "You are PhantomBot, an elite local operator assistant with real hands on this machine."}]
        try:
            async for raw in websocket:
                data = json.loads(raw)
                if data.get("token") != self.token:
                    await websocket.send(json.dumps({"type": "error", "message": "Unauthorized: missing or invalid token."}))
                    continue
                prompt = str(data.get("prompt", "")).strip()
                if not prompt:
                    continue
                messages = self._sessions[session_id]
                updated, error_message = await self._run_turn_streaming(websocket, messages, prompt)
                if error_message is not None:
                    await websocket.send(json.dumps({"type": "error", "message": error_message}))
                    continue
                self._sessions[session_id] = updated
                final_text = updated[-1]["content"] if updated and updated[-1]["role"] == "assistant" else ""
                await websocket.send(json.dumps({"type": "final", "message": final_text}))
        finally:
            self._sessions.pop(session_id, None)

    @contextlib.asynccontextmanager
    async def _serve(self):
        async with websockets.serve(self._handle_client, self.host, self.port):
            yield

    async def start(self):
        async with self._serve():
            await asyncio.Future()  # run forever
