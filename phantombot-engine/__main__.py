import asyncio
import os

import tools
from agent_loop import AgentLoop
from ollama_client import MODEL, default_endpoint
from ws_server import PhantomBotServer


def build_tool_dispatch():
    return {
        "list_dir": tools.list_dir,
        "read_file": tools.read_file,
        "write_pc_file": tools.write_pc_file,
        "edit_file": tools.edit_file,
        "grep": tools.grep,
        "glob_files": tools.glob_files,
        "system_status": tools.system_status,
        "capture_screenshot": tools.capture_screenshot,
        "start_xvfb": tools.start_xvfb,
        "tmux_start": tools.tmux_start,
        "tmux_send": tools.tmux_send,
        "tmux_capture": tools.tmux_capture,
        "desktop_input": tools.desktop_input,
        "open_output_dir": tools.open_output_dir,
        "make_image_card": tools.make_image_card,
        "make_generated_graphic": tools.make_generated_graphic,
        "make_generated_video": tools.make_generated_video,
        "stage_discord": tools.stage_discord,
        "discord_voice_status": tools.discord_voice_status,
        "discord_bridge_status": tools.discord_bridge_status,
        "discord_bridge_stage": tools.discord_bridge_stage,
        "discord_voice_stage": tools.discord_voice_stage,
        "run_acceptance": tools.run_acceptance,
        "run_command": tools.run_command,
        "run_visible_terminal": tools.run_visible_terminal,
        "write_file": tools.write_file,
        "write_and_run": tools.write_and_run,
    }


def main():
    endpoint = os.environ.get("PHANTOMBOT_OLLAMA_ENDPOINT", default_endpoint())
    model = os.environ.get("PHANTOMBOT_MODEL", MODEL)
    dispatch = build_tool_dispatch()

    def agent_loop_factory(on_event):
        return AgentLoop(endpoint=endpoint, model=model, tool_dispatch=dispatch, on_event=on_event)

    server = PhantomBotServer(agent_loop_factory=agent_loop_factory, host="127.0.0.1", port=int(os.environ.get("PHANTOMBOT_WS_PORT", "8766")))
    print(f"PhantomBot engine listening on ws://127.0.0.1:{server.port} (token in {os.path.join(tools.OUTPUT_DIR, 'phantombot-ws-token.txt')})")
    asyncio.run(server.start())


if __name__ == "__main__":
    main()
