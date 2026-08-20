#!/usr/bin/env python3
"""Higgsfield-specific video edit/remix tool."""

from __future__ import annotations

import json
from typing import Any, Dict, Optional

from hermes_cli.config import load_config
from plugins.video_gen.higgsfield import has_higgsfield_cli, run_higgsfield_video_edit
from tools.registry import registry, tool_error


def _configured_for_higgsfield_video() -> bool:
    try:
        cfg = load_config()
    except Exception:
        return False
    section = cfg.get("video_gen") if isinstance(cfg, dict) else None
    return isinstance(section, dict) and section.get("provider") == "higgsfield"


def _check_higgsfield_video_requirements() -> bool:
    return _configured_for_higgsfield_video() and has_higgsfield_cli()


def _clean_string(value: Any) -> Optional[str]:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _coerce_int(value: Any) -> Optional[int]:
    if value is None or isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _coerce_bool(value: Any) -> Optional[bool]:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        v = value.strip().lower()
        if v in {"true", "1", "yes", "on"}:
            return True
        if v in {"false", "0", "no", "off"}:
            return False
    return None


HIGGSFIELD_VIDEO_EDIT_SCHEMA: Dict[str, Any] = {
    "name": "higgsfield_video_edit",
    "description": (
        "Edit, remix, or regenerate from an existing video using Higgsfield. "
        "The `video_url` value may be a local file path, upload/job id, or "
        "HTTPS URL accepted by the Higgsfield CLI. Requires Video Generation "
        "provider set to Higgsfield in `hermes tools` or Settings."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "prompt": {
                "type": "string",
                "description": "Instruction for how Higgsfield should change or reinterpret the source video.",
            },
            "video_url": {
                "type": "string",
                "description": "Source video path, upload/job id, or HTTPS URL.",
            },
            "model": {
                "type": "string",
                "description": "Optional Higgsfield video job_type override. Defaults to Seedance 2.0.",
            },
            "duration": {
                "type": "integer",
                "description": "Desired output duration in seconds. The selected model may clamp it.",
            },
            "aspect_ratio": {
                "type": "string",
                "description": "Output aspect ratio such as 16:9, 9:16, 1:1, 4:3, 3:4, or 21:9.",
                "default": "16:9",
            },
            "resolution": {
                "type": "string",
                "description": "Output resolution such as 480p, 720p, 1080p, or 4k.",
                "default": "720p",
            },
            "audio": {
                "type": "boolean",
                "description": "Optional native audio generation toggle for models that support it.",
            },
        },
        "required": ["prompt", "video_url"],
    },
}


def _provider_not_configured_error() -> str:
    return json.dumps({
        "success": False,
        "error": (
            "higgsfield_video_edit requires `video_gen.provider` to be "
            "configured as `higgsfield` via `hermes tools` -> Video Generation "
            "or Settings."
        ),
        "error_type": "provider_not_configured",
        "provider": "higgsfield",
    })


def _handle_higgsfield_video_edit(args: Dict[str, Any], **_kw: Any) -> str:
    prompt = _clean_string(args.get("prompt"))
    video_url = _clean_string(args.get("video_url"))
    model = _clean_string(args.get("model"))
    duration = _coerce_int(args.get("duration"))
    aspect_ratio = _clean_string(args.get("aspect_ratio")) or "16:9"
    resolution = _clean_string(args.get("resolution")) or "720p"
    audio = _coerce_bool(args.get("audio"))

    if not prompt:
        return tool_error("prompt is required for Higgsfield video edit")
    if not video_url:
        return tool_error("video_url is required for Higgsfield video edit")
    if not _configured_for_higgsfield_video():
        return _provider_not_configured_error()

    result = run_higgsfield_video_edit(
        prompt=prompt,
        video_url=video_url,
        model=model,
        duration=duration,
        aspect_ratio=aspect_ratio,
        resolution=resolution,
        audio=audio,
    )
    return json.dumps(result)


registry.register(
    name="higgsfield_video_edit",
    toolset="video_gen",
    schema=HIGGSFIELD_VIDEO_EDIT_SCHEMA,
    handler=_handle_higgsfield_video_edit,
    check_fn=_check_higgsfield_video_requirements,
    requires_env=[],
    is_async=False,
    emoji="video",
)
