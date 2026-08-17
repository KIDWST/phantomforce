from __future__ import annotations

import json
import os
import tempfile
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any


def default_save_root() -> Path:
    local = os.environ.get("LOCALAPPDATA")
    if local:
        return Path(local) / "PhantomPlay" / "Native" / "saves"
    return Path.home() / ".phantomplay" / "native" / "saves"


class SaveStore:
    """Atomic JSON persistence shared by the native games."""

    def __init__(self, game_id: str, root: Path | None = None, enabled: bool = True) -> None:
        self.game_id = game_id
        self.root = root or default_save_root()
        self.enabled = enabled
        self.path = self.root / f"{game_id}.json"

    def load(self) -> dict[str, Any]:
        if not self.enabled or not self.path.is_file():
            return {}
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
            return value if isinstance(value, dict) else {}
        except (OSError, json.JSONDecodeError):
            return {}

    def save(self, value: Any) -> None:
        if not self.enabled:
            return
        payload = asdict(value) if is_dataclass(value) else value
        self.root.mkdir(parents=True, exist_ok=True)
        fd, temporary_name = tempfile.mkstemp(
            prefix=f".{self.game_id}-", suffix=".tmp", dir=self.root
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, indent=2, sort_keys=True)
                handle.write("\n")
            os.replace(temporary_name, self.path)
        finally:
            if os.path.exists(temporary_name):
                os.unlink(temporary_name)


def read_enabled_mods(repo_root: Path, game_id: str) -> set[str]:
    directory_game = repo_root / "app" / "games" / game_id
    if (directory_game / "index.html").is_file():
        path = directory_game / "mods" / ".enabled.json"
    else:
        path = repo_root / "app" / "games" / "shared" / "mods" / game_id / ".enabled.json"
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return set()
    return {item for item in value if isinstance(item, str)} if isinstance(value, list) else set()
