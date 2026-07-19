import importlib.util
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# The module under test is literally named `__main__.py`. A plain
# `import __main__` would resolve to whatever top-level script is already
# running the interpreter (e.g. pytest's own entrypoint), because Python
# always keeps that name pre-populated in sys.modules — sys.path is never
# consulted for it. Load the file explicitly by path under a distinct
# module name instead so we test phantombot-engine's __main__.py itself.
_spec = importlib.util.spec_from_file_location(
    "phantombot_engine_main", os.path.join(os.path.dirname(__file__), "..", "__main__.py")
)
engine_main = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(engine_main)


def test_build_tool_dispatch_includes_every_capability_floor_tool():
    dispatch = engine_main.build_tool_dispatch()
    required = [
        "list_dir", "read_file", "write_pc_file", "edit_file", "grep", "glob_files",
        "system_status", "capture_screenshot", "start_xvfb", "tmux_start", "tmux_send",
        "tmux_capture", "desktop_input", "open_output_dir", "make_image_card",
        "make_generated_graphic", "make_generated_video", "stage_discord",
        "discord_voice_status", "discord_bridge_status", "discord_bridge_stage",
        "discord_voice_stage", "run_acceptance", "run_command", "run_visible_terminal",
        "write_file", "write_and_run",
    ]
    for name in required:
        assert name in dispatch, f"missing tool in dispatch table: {name}"
        assert callable(dispatch[name])
