"""Higgsfield video generation backend.

Uses the local ``higgsfield`` CLI as the credential boundary. Hermes stores
only provider/model preferences in config.yaml; Higgsfield session state stays
with the CLI.
"""

from __future__ import annotations

import json
import logging
import re
import shutil
import subprocess
import threading
import time
from typing import Any, Dict, Iterable, List, Optional

from agent.video_gen_provider import VideoGenProvider, error_response, success_response

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "seedance_2_0"
DEFAULT_TIMEOUT_SECONDS = 30 * 60

_STATIC_VIDEO_MODELS: Dict[str, Dict[str, Any]] = {
    "seedance_2_0": {
        "display": "Seedance 2.0",
        "speed": "~1-4m",
        "strengths": "Default. Text, image, video, and audio references; 4-15s serious motion.",
        "price": "Higgsfield credits",
        "modalities": ["text", "image", "reference", "video"],
    },
    "kling3_0": {
        "display": "Kling v3.0",
        "speed": "~1-5m",
        "strengths": "Strong single-shot motion, start/end frames, optional sound.",
        "price": "Higgsfield credits",
        "modalities": ["text", "image"],
    },
    "veo3_1": {
        "display": "Google Veo 3.1",
        "speed": "~1-5m",
        "strengths": "Cinematic prompt adherence; 4/6/8s; start image support.",
        "price": "Higgsfield credits",
        "modalities": ["text", "image"],
    },
    "veo3_1_lite": {
        "display": "Google Veo 3.1 Lite",
        "speed": "~1-4m",
        "strengths": "Faster Veo 3.1 tier for iteration.",
        "price": "Higgsfield credits",
        "modalities": ["text", "image"],
    },
    "marketing_studio_video": {
        "display": "Marketing Studio Video",
        "speed": "~2-8m",
        "strengths": "UGC, product, demo, unboxing, and ad-style videos.",
        "price": "Higgsfield credits",
        "modalities": ["text", "image"],
    },
    "kling3_0_turbo": {
        "display": "Kling 3.0 Turbo",
        "speed": "~1-4m",
        "strengths": "Fast Kling tier.",
        "price": "Higgsfield credits",
        "modalities": ["text", "image"],
    },
    "minimax_hailuo": {
        "display": "Minimax Hailuo",
        "speed": "~1-4m",
        "strengths": "Physics-heavy clips and fast iteration.",
        "price": "Higgsfield credits",
        "modalities": ["text", "image"],
    },
    "wan2_7": {
        "display": "Wan 2.7",
        "speed": "~1-5m",
        "strengths": "General text/image-to-video generation.",
        "price": "Higgsfield credits",
        "modalities": ["text", "image"],
    },
}

_MODEL_LIST_CACHE: tuple[float, List[Dict[str, Any]]] | None = None
_MODEL_LIST_LOCK = threading.Lock()


def _higgsfield_exe() -> Optional[str]:
    return shutil.which("higgsfield")


def _run_higgsfield(args: List[str], *, timeout: int = DEFAULT_TIMEOUT_SECONDS) -> subprocess.CompletedProcess:
    exe = _higgsfield_exe()
    if not exe:
        raise FileNotFoundError("higgsfield CLI is not installed or not on PATH")
    return subprocess.run(
        [exe, *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        check=False,
    )


def _json_from_stdout(stdout: str) -> Any:
    text = (stdout or "").strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Some CLI versions may print a short status line before JSON. Find the
        # first plausible JSON container and parse from there.
        starts = [idx for idx in (text.find("["), text.find("{")) if idx >= 0]
        if not starts:
            return None
        try:
            return json.loads(text[min(starts):])
        except json.JSONDecodeError:
            return None


def _extract_first_url(value: Any) -> Optional[str]:
    if isinstance(value, str):
        match = re.search(r"https?://\S+", value)
        return match.group(0).rstrip(".,)") if match else None
    if isinstance(value, dict):
        preferred = (
            "url", "video_url", "output_url", "result_url", "download_url",
            "public_url", "asset_url", "media_url",
        )
        for key in preferred:
            if key in value:
                found = _extract_first_url(value[key])
                if found:
                    return found
        for child in value.values():
            found = _extract_first_url(child)
            if found:
                return found
    if isinstance(value, list):
        for child in value:
            found = _extract_first_url(child)
            if found:
                return found
    return None


def _cli_error(proc: subprocess.CompletedProcess) -> str:
    detail = (proc.stderr or proc.stdout or "").strip()
    return detail[-1200:] if detail else f"higgsfield exited with code {proc.returncode}"


def _append_param(args: List[str], name: str, value: Any) -> None:
    if value is None:
        return
    flag = f"--{name.replace('_', '-')}"
    if isinstance(value, bool):
        args.extend([flag, "true" if value else "false"])
    else:
        args.extend([flag, str(value)])


def _append_many(args: List[str], flag: str, values: Optional[Iterable[str]]) -> None:
    for value in values or []:
        cleaned = (value or "").strip()
        if cleaned:
            args.extend([flag, cleaned])


def _run_generation(
    *,
    prompt: str,
    model: Optional[str],
    image_url: Optional[str],
    reference_image_urls: Optional[List[str]],
    video_url: Optional[str],
    duration: Optional[int],
    aspect_ratio: str,
    resolution: str,
    audio: Optional[bool],
    extra_params: Optional[Dict[str, Any]] = None,
    operation: str = "generate",
) -> Dict[str, Any]:
    model_id = (model or DEFAULT_MODEL).strip() or DEFAULT_MODEL
    cleaned_prompt = (prompt or "").strip()
    if not cleaned_prompt:
        return error_response(
            error="prompt is required for Higgsfield video generation",
            error_type="missing_prompt",
            provider="higgsfield",
            model=model_id,
        )

    args = ["generate", "create", model_id, "--prompt", cleaned_prompt]
    _append_param(args, "duration", duration)
    _append_param(args, "aspect_ratio", aspect_ratio)
    _append_param(args, "resolution", resolution)
    if audio is not None:
        _append_param(args, "generate_audio", audio)
    if image_url:
        args.extend(["--start-image", image_url])
    _append_many(args, "--image-references", reference_image_urls)
    if video_url:
        args.extend(["--video-references", video_url])
    for key, value in (extra_params or {}).items():
        if key.startswith("_"):
            continue
        _append_param(args, key, value)
    args.extend(["--wait", "--wait-timeout", "30m", "--wait-interval", "5s", "--json"])

    try:
        proc = _run_higgsfield(args)
    except FileNotFoundError as exc:
        return error_response(
            error=f"{exc}. Install with: curl -fsSL https://raw.githubusercontent.com/higgsfield-ai/cli/main/install.sh | sh",
            error_type="missing_dependency",
            provider="higgsfield",
            model=model_id,
            prompt=cleaned_prompt,
        )
    except subprocess.TimeoutExpired:
        return error_response(
            error="Timed out waiting for Higgsfield video generation after 30 minutes",
            error_type="timeout",
            provider="higgsfield",
            model=model_id,
            prompt=cleaned_prompt,
        )

    if proc.returncode != 0:
        return error_response(
            error=f"Higgsfield {operation} failed: {_cli_error(proc)}",
            error_type="api_error",
            provider="higgsfield",
            model=model_id,
            prompt=cleaned_prompt,
            aspect_ratio=aspect_ratio,
        )

    parsed = _json_from_stdout(proc.stdout)
    video = _extract_first_url(parsed) or _extract_first_url(proc.stdout)
    if not video:
        return error_response(
            error="Higgsfield completed but no output URL was found in the CLI response",
            error_type="empty_response",
            provider="higgsfield",
            model=model_id,
            prompt=cleaned_prompt,
            aspect_ratio=aspect_ratio,
        )

    modality = "video" if video_url else ("image" if image_url else ("reference" if reference_image_urls else "text"))
    return success_response(
        video=video,
        model=model_id,
        prompt=cleaned_prompt,
        modality=modality if operation == "generate" else operation,
        aspect_ratio=aspect_ratio,
        duration=duration or 0,
        provider="higgsfield",
        extra={"raw": parsed} if isinstance(parsed, dict) else None,
    )


def has_higgsfield_cli() -> bool:
    return bool(_higgsfield_exe())


def has_higgsfield_session() -> bool:
    if not has_higgsfield_cli():
        return False
    try:
        proc = _run_higgsfield(["account", "status"], timeout=10)
    except Exception:
        return False
    return proc.returncode == 0 and "not authenticated" not in (proc.stdout + proc.stderr).lower()


def _is_higgsfield_configured() -> bool:
    try:
        from hermes_cli.config import load_config

        cfg = load_config()
    except Exception:
        return False
    section = cfg.get("video_gen") if isinstance(cfg, dict) else None
    return isinstance(section, dict) and section.get("provider") == "higgsfield"


def run_higgsfield_video_edit(
    *,
    prompt: str,
    video_url: str,
    model: Optional[str] = None,
    duration: Optional[int] = None,
    aspect_ratio: str = "16:9",
    resolution: str = "720p",
    audio: Optional[bool] = None,
) -> Dict[str, Any]:
    return _run_generation(
        prompt=prompt,
        model=model or DEFAULT_MODEL,
        image_url=None,
        reference_image_urls=None,
        video_url=video_url,
        duration=duration,
        aspect_ratio=aspect_ratio,
        resolution=resolution,
        audio=audio,
        operation="edit",
    )


class HiggsfieldVideoGenProvider(VideoGenProvider):
    @property
    def name(self) -> str:
        return "higgsfield"

    @property
    def display_name(self) -> str:
        return "Higgsfield"

    def is_available(self) -> bool:
        return has_higgsfield_cli() and _is_higgsfield_configured()

    def list_models(self) -> List[Dict[str, Any]]:
        global _MODEL_LIST_CACHE
        now = time.monotonic()
        with _MODEL_LIST_LOCK:
            if _MODEL_LIST_CACHE and now - _MODEL_LIST_CACHE[0] < 300:
                return list(_MODEL_LIST_CACHE[1])
        rows: List[Dict[str, Any]] = []
        try:
            proc = _run_higgsfield(["model", "list", "--json"], timeout=15)
            if proc.returncode == 0:
                data = _json_from_stdout(proc.stdout)
                if isinstance(data, list):
                    for item in data:
                        if not isinstance(item, dict) or item.get("type") != "video":
                            continue
                        job_type = item.get("job_type")
                        if not isinstance(job_type, str) or not job_type:
                            continue
                        static = _STATIC_VIDEO_MODELS.get(job_type, {})
                        rows.append({
                            "id": job_type,
                            "display": item.get("display_name") or static.get("display") or job_type,
                            "speed": static.get("speed", ""),
                            "strengths": static.get("strengths", "Higgsfield video model"),
                            "price": static.get("price", "Higgsfield credits"),
                            "modalities": static.get("modalities", ["text", "image"]),
                        })
        except Exception as exc:
            logger.debug("Higgsfield model list failed: %s", exc)
        seen = {row["id"] for row in rows}
        for mid, meta in _STATIC_VIDEO_MODELS.items():
            if mid not in seen:
                rows.append({"id": mid, **meta})
        if not rows:
            rows = [{"id": mid, **meta} for mid, meta in _STATIC_VIDEO_MODELS.items()]
        rows.sort(key=lambda m: (0 if m["id"] == DEFAULT_MODEL else 1, m.get("display", m["id"])))
        with _MODEL_LIST_LOCK:
            _MODEL_LIST_CACHE = (now, list(rows))
        return rows

    def default_model(self) -> Optional[str]:
        return DEFAULT_MODEL

    def get_setup_schema(self) -> Dict[str, Any]:
        return {
            "name": "Higgsfield",
            "badge": "subscription",
            "tag": (
                "Uses the authenticated Higgsfield CLI session; supports "
                "Seedance 2.0, Kling, Veo, Marketing Studio, and other "
                "Higgsfield video models. Run `higgsfield auth login` if "
                "generation reports an expired session."
            ),
            "env_vars": [],
        }

    def capabilities(self) -> Dict[str, Any]:
        return {
            "modalities": ["text", "image", "reference", "video"],
            "aspect_ratios": ["16:9", "9:16", "4:3", "3:4", "1:1", "21:9"],
            "resolutions": ["480p", "720p", "1080p", "4k"],
            "max_duration": 15,
            "min_duration": 1,
            "supports_audio": True,
            "supports_negative_prompt": False,
            "max_reference_images": 9,
        }

    def generate(
        self,
        prompt: str,
        *,
        model: Optional[str] = None,
        image_url: Optional[str] = None,
        reference_image_urls: Optional[List[str]] = None,
        duration: Optional[int] = None,
        aspect_ratio: str = "16:9",
        resolution: str = "720p",
        negative_prompt: Optional[str] = None,
        audio: Optional[bool] = None,
        seed: Optional[int] = None,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        extra: Dict[str, Any] = {}
        if seed is not None:
            extra["seed"] = seed
        return _run_generation(
            prompt=prompt,
            model=model,
            image_url=image_url,
            reference_image_urls=reference_image_urls,
            video_url=None,
            duration=duration,
            aspect_ratio=aspect_ratio,
            resolution=resolution,
            audio=audio,
            extra_params=extra,
        )


def register(ctx) -> None:
    ctx.register_video_gen_provider(HiggsfieldVideoGenProvider())
