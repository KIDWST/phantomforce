import json
import os
import urllib.request

DEFAULT_MODEL = "gpt-4o-mini"
DEFAULT_ENDPOINT = "https://api.openai.com/v1/chat/completions"


def is_configured():
    return bool(os.environ.get("PHANTOMBOT_CLOUD_API_KEY", ""))


def stream_chat(messages, on_delta, model=None, endpoint=DEFAULT_ENDPOINT, temperature=0.35, max_tokens=4096, timeout=60):
    """Streams a chat completion from an OpenAI-compatible cloud endpoint.
    Calls on_delta(text_chunk) for each token chunk as it arrives and
    returns the full accumulated response text. Raises RuntimeError if no
    PHANTOMBOT_CLOUD_API_KEY is configured — callers (router.py) should
    check is_configured() first, or catch this and fall back to local."""
    key = os.environ.get("PHANTOMBOT_CLOUD_API_KEY", "")
    if not key:
        raise RuntimeError("No cloud API key configured (PHANTOMBOT_CLOUD_API_KEY).")
    body = {
        "model": model or DEFAULT_MODEL,
        "messages": messages,
        "stream": True,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    req = urllib.request.Request(
        endpoint,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
        method="POST",
    )
    full_text = []
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        for raw_line in resp:
            line = raw_line.decode("utf-8", errors="replace").strip()
            if not line or not line.startswith("data:"):
                continue
            payload = line[len("data:"):].strip()
            if payload == "[DONE]":
                break
            try:
                chunk = json.loads(payload)
            except json.JSONDecodeError:
                continue
            if not isinstance(chunk, dict):
                continue
            choices = chunk.get("choices") or []
            if not choices:
                continue
            delta = (choices[0].get("delta") or {}).get("content", "")
            if delta:
                full_text.append(delta)
                on_delta(delta)
    return "".join(full_text)
