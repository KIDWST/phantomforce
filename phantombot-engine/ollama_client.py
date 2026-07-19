import json
import sys
import urllib.request

MODEL = "huihui-qwen3.6-35b-uncensored:q3"
UNLEASHED_MARKERS = ("uncensored", "unleashed", "abliterated", "huihui")


def default_endpoint():
    return "http://127.0.0.1:11434/v1" if sys.platform.startswith("win") else "http://192.168.255.1:11434/v1"


def validate_unleashed(model):
    m = str(model or "").lower()
    if not any(marker in m for marker in UNLEASHED_MARKERS):
        raise RuntimeError(f"Blocked: PhantomBot only allows unleashed/uncensored models, got '{model}'.")


def stream_chat(endpoint, model, messages, on_delta, temperature=0.35, max_tokens=4096, timeout=300, num_ctx=8192):
    """Streams a chat completion. Calls on_delta(text_chunk) for each token
    chunk as it arrives and returns the full accumulated response text.
    num_ctx defaults to 8192 (down from the model's max 32768) to leave more
    VRAM headroom for GPU-resident weight layers on a 12GB card."""
    validate_unleashed(model)
    url = endpoint.rstrip("/") + "/chat/completions"
    body = {
        "model": model,
        "messages": messages,
        "stream": True,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "options": {"num_ctx": num_ctx},
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
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
