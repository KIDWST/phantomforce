"""ChatGPT Plus browser-session image generation provider for PhantomBot.

Calls the local-only Phantom ChatGPT backend. No OpenAI API key, Codex OAuth,
password, cookie, or bearer token is handled by this plugin.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

from agent.image_gen_provider import (
    DEFAULT_ASPECT_RATIO,
    ImageGenProvider,
    error_response,
    resolve_aspect_ratio,
    save_b64_image,
    success_response,
)

_BACKEND = "http://127.0.0.1:8792"
_MODEL = "chatgpt-plus"


def _json_request(path: str, payload: Optional[dict] = None, timeout: float = 430.0) -> dict:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        f"{_BACKEND}{path}",
        data=data,
        headers={"content-type": "application/json"} if data is not None else {},
        method="POST" if data is not None else "GET",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


class ChatGPTPlusImageGenProvider(ImageGenProvider):
    @property
    def name(self) -> str:
        return "chatgpt-plus"

    @property
    def display_name(self) -> str:
        return "ChatGPT Plus Subscription"

    def is_available(self) -> bool:
        try:
            result = _json_request("/health", timeout=2.0)
            return bool(result.get("ok") and result.get("browser_up"))
        except Exception:
            return False

    def list_models(self) -> List[Dict[str, Any]]:
        return [{
            "id": _MODEL,
            "display": "ChatGPT Plus",
            "speed": "~30–120s",
            "strengths": "Auto-routes image generation through the signed-in ChatGPT Plus browser session",
            "price": "included with subscription limits",
        }]

    def default_model(self) -> Optional[str]:
        return _MODEL

    def get_setup_schema(self) -> Dict[str, Any]:
        return {
            "name": self.display_name,
            "badge": "subscription",
            "tag": "Local browser bridge — no API key and no Codex",
            "env_vars": [],
        }

    def capabilities(self) -> Dict[str, Any]:
        return {"modalities": ["text"], "max_reference_images": 0}

    def generate(
        self,
        prompt: str,
        aspect_ratio: str = DEFAULT_ASPECT_RATIO,
        *,
        image_url: Optional[str] = None,
        reference_image_urls: Optional[List[str]] = None,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        prompt = (prompt or "").strip()
        aspect = resolve_aspect_ratio(aspect_ratio)
        if not prompt:
            return error_response(
                error="Prompt is required and must be non-empty",
                error_type="invalid_argument",
                provider=self.name,
                model=_MODEL,
                aspect_ratio=aspect,
            )
        if image_url or reference_image_urls:
            return error_response(
                error="The ChatGPT Plus browser provider currently supports generation, not source-image editing.",
                error_type="unsupported_modality",
                provider=self.name,
                model=_MODEL,
                prompt=prompt,
                aspect_ratio=aspect,
            )
        shaped_prompt = f"{prompt}\n\nComposition: {aspect} aspect ratio."
        try:
            payload = _json_request("/image", {"prompt": shaped_prompt}, timeout=430.0)
            if not payload.get("ok"):
                raise RuntimeError(str(payload.get("error") or "ChatGPT returned no image"))
            saved = Path(str(payload.get("path") or ""))
            if not saved.is_file() or saved.stat().st_size <= 2048:
                if not payload.get("image_b64"):
                    raise RuntimeError("ChatGPT returned no readable saved image path")
                content_type = str(payload.get("content_type") or "image/png").lower()
                extension = "jpg" if "jpeg" in content_type else "webp" if "webp" in content_type else "png"
                saved = save_b64_image(
                    str(payload["image_b64"]),
                    prefix="chatgpt_plus",
                    extension=extension,
                )
            if not Path(saved).is_file():
                raise RuntimeError(f"Saved image path does not exist: {saved}")
            return success_response(
                image=str(saved),
                model=_MODEL,
                prompt=prompt,
                aspect_ratio=aspect,
                provider=self.name,
                modality="text",
                extra={
                    "subscription_backend": True,
                    "api_billed": False,
                    "request_id": payload.get("request_id"),
                    "mime_type": payload.get("mime_type") or payload.get("content_type"),
                    "width": payload.get("width"),
                    "height": payload.get("height"),
                },
            )
        except urllib.error.HTTPError as exc:
            try:
                detail = json.loads(exc.read().decode("utf-8")).get("error")
            except Exception:
                detail = str(exc)
            return error_response(
                error=f"ChatGPT Plus image backend failed: {detail}",
                error_type="backend_error",
                provider=self.name,
                model=_MODEL,
                prompt=prompt,
                aspect_ratio=aspect,
            )
        except Exception as exc:
            return error_response(
                error=f"ChatGPT Plus image backend unavailable: {exc}",
                error_type="backend_unavailable",
                provider=self.name,
                model=_MODEL,
                prompt=prompt,
                aspect_ratio=aspect,
            )


def register(ctx) -> None:
    ctx.register_image_gen_provider(ChatGPTPlusImageGenProvider())
