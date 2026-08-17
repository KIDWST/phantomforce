from __future__ import annotations

import argparse
import os
from pathlib import Path

from panda3d.core import Filename, loadPrcFileData


def repo_root() -> Path:
    configured = os.environ.get("PHANTOMPLAY_LIVE_ROOT")
    if configured:
        return Path(configured).resolve()
    return Path(__file__).resolve().parents[3]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Launch a native PhantomPlay game through Panda3D")
    parser.add_argument("--game", choices=("phantom-strike",), required=True)
    parser.add_argument("--save-root", type=Path)
    parser.add_argument("--no-save", action="store_true")
    parser.add_argument("--smoke-test", action="store_true")
    parser.add_argument("--frames", type=int, default=10)
    parser.add_argument("--screenshot", type=Path)
    return parser.parse_args()


def configure_panda(offscreen: bool) -> None:
    settings = "\n".join(
        (
            f"window-type {'offscreen' if offscreen else 'onscreen'}",
            "win-size 1440 900",
            "framebuffer-srgb true",
            "framebuffer-multisample true",
            "multisamples 4",
            "threading-model Cull/Draw",
            "support-threads true",
            "gl-version 3 2",
            "prefer-parasite-buffer false",
            "texture-compression 1",
            "keep-texture-ram true",
            "driver-compress-textures true",
            "sync-video true",
            "show-frame-rate-meter false",
            "textures-power-2 none",
            "audio-library-name null" if offscreen else "audio-library-name p3openal_audio",
            "notify-level warning",
        )
    )
    loadPrcFileData("phantomplay-native", settings)


def main() -> int:
    args = parse_args()
    configure_panda(args.smoke_test)

    from .phantom_strike import PhantomStrikeGame
    from .state import SaveStore, read_enabled_mods
    from .runtime import emit_smoke_report

    root = repo_root()
    save_root = args.save_root.resolve() if args.save_root else None
    store = SaveStore(args.game, root=save_root, enabled=not args.no_save and not args.smoke_test)
    mods = read_enabled_mods(root, args.game)
    game = PhantomStrikeGame(store, mods, args.screenshot)

    if not args.smoke_test:
        game.run()
        return 0

    try:
        for _ in range(max(2, args.frames)):
            game.taskMgr.step()
            game.graphicsEngine.renderFrame()
        if args.screenshot and game.win:
            args.screenshot.parent.mkdir(parents=True, exist_ok=True)
            game.win.saveScreenshot(Filename.fromOsSpecific(str(args.screenshot)))
        print(emit_smoke_report(game), flush=True)
    finally:
        game.destroy()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
