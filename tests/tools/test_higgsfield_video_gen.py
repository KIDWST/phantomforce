"""Higgsfield video generation provider/tool tests."""

from __future__ import annotations

import json
import subprocess
from typing import Any, Dict, List

import pytest
import yaml


@pytest.fixture(autouse=True)
def _reset_video_registry():
    from agent import video_gen_registry

    video_gen_registry._reset_for_tests()
    yield
    video_gen_registry._reset_for_tests()


@pytest.fixture
def higgsfield_env(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))

    calls: List[List[str]] = []

    import plugins.video_gen.higgsfield as provider_mod

    provider_mod._MODEL_LIST_CACHE = None
    monkeypatch.setattr(provider_mod, "_higgsfield_exe", lambda: "higgsfield")

    def _fake_run(args, *, timeout=provider_mod.DEFAULT_TIMEOUT_SECONDS):
        calls.append(list(args))
        if args[:3] == ["model", "list", "--json"]:
            return subprocess.CompletedProcess(
                ["higgsfield", *args],
                0,
                stdout=json.dumps([
                    {"display_name": "Seedance 2.0", "job_type": "seedance_2_0", "type": "video"},
                    {"display_name": "GPT Image 2", "job_type": "gpt_image_2", "type": "image"},
                ]),
                stderr="",
            )
        if args[:2] == ["account", "status"]:
            return subprocess.CompletedProcess(["higgsfield", *args], 0, stdout="signed in", stderr="")
        return subprocess.CompletedProcess(
            ["higgsfield", *args],
            0,
            stdout=json.dumps({"url": "https://cdn.example.com/higgsfield.mp4"}),
            stderr="",
        )

    monkeypatch.setattr(provider_mod, "_run_higgsfield", _fake_run)

    from agent import video_gen_registry

    video_gen_registry.register_provider(provider_mod.HiggsfieldVideoGenProvider())
    import hermes_cli.plugins as plugins_mod

    monkeypatch.setattr(plugins_mod, "_ensure_plugins_discovered", lambda *a, **kw: None)
    return tmp_path, calls


def _invoke_tool(home, cfg: dict, args: dict, tool_name: str = "video_generate") -> Dict[str, Any]:
    (home / "config.yaml").write_text(yaml.safe_dump(cfg))
    import hermes_cli.config as cfg_mod

    if hasattr(cfg_mod, "_invalidate_load_config_cache"):
        cfg_mod._invalidate_load_config_cache()

    from tools.registry import discover_builtin_tools, registry

    if tool_name not in registry._tools:
        discover_builtin_tools()
    handler = registry._tools[tool_name].handler
    return json.loads(handler(args))


def test_higgsfield_provider_generate_builds_cli_call(higgsfield_env):
    home, calls = higgsfield_env

    result = _invoke_tool(
        home,
        {"video_gen": {"provider": "higgsfield", "model": "seedance_2_0"}},
        {
            "prompt": "cinematic neon street",
            "image_url": "C:/refs/start.png",
            "reference_image_urls": ["https://example.com/style.png"],
            "duration": 12,
            "aspect_ratio": "9:16",
            "resolution": "1080p",
            "audio": True,
        },
    )

    assert result["success"] is True
    assert result["provider"] == "higgsfield"
    assert result["video"] == "https://cdn.example.com/higgsfield.mp4"

    generate_call = calls[-1]
    assert generate_call[:3] == ["generate", "create", "seedance_2_0"]
    assert generate_call[generate_call.index("--prompt") + 1] == "cinematic neon street"
    assert generate_call[generate_call.index("--start-image") + 1] == "C:/refs/start.png"
    assert generate_call[generate_call.index("--image-references") + 1] == "https://example.com/style.png"
    assert generate_call[generate_call.index("--duration") + 1] == "12"
    assert generate_call[generate_call.index("--aspect-ratio") + 1] == "9:16"
    assert generate_call[generate_call.index("--resolution") + 1] == "1080p"
    assert generate_call[generate_call.index("--generate-audio") + 1] == "true"
    assert "--wait" in generate_call
    assert "--json" in generate_call


def test_higgsfield_video_edit_tool_uses_video_reference(higgsfield_env):
    home, calls = higgsfield_env

    result = _invoke_tool(
        home,
        {"video_gen": {"provider": "higgsfield", "model": "seedance_2_0"}},
        {
            "prompt": "make it cyberpunk and add rain",
            "video_url": "C:/refs/source.mp4",
            "duration": 8,
        },
        tool_name="higgsfield_video_edit",
    )

    assert result["success"] is True
    assert result["modality"] == "edit"

    edit_call = calls[-1]
    assert edit_call[:3] == ["generate", "create", "seedance_2_0"]
    assert edit_call[edit_call.index("--video-references") + 1] == "C:/refs/source.mp4"
    assert edit_call[edit_call.index("--prompt") + 1] == "make it cyberpunk and add rain"


def test_higgsfield_catalog_merges_live_and_static_models(higgsfield_env):
    _, _ = higgsfield_env
    from hermes_cli import tools_config

    catalog, default = tools_config._plugin_video_gen_catalog("higgsfield")

    assert default == "seedance_2_0"
    assert "seedance_2_0" in catalog
    # Not returned by the stubbed model list, but intentionally added from the
    # known Higgsfield video modes because the CLI exposes it via model get.
    assert "marketing_studio_video" in catalog


def test_higgsfield_edit_tool_hidden_when_provider_differs(higgsfield_env):
    home, _ = higgsfield_env

    result = _invoke_tool(
        home,
        {"video_gen": {"provider": "fal"}},
        {"prompt": "change it", "video_url": "C:/refs/source.mp4"},
        tool_name="higgsfield_video_edit",
    )

    assert result["success"] is False
    assert result["error_type"] == "provider_not_configured"
