"""Normalize Phantom gesture art to one stable canvas and visible baseline."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image


POSES = (
    "welcome.webp",
    "present.webp",
    "point.webp",
    "conjure.webp",
    "chin.webp",
    "laugh.webp",
    "mode-dark-write.webp",
    "mode-dark-ask.webp",
)
CANVAS_SIZE = 1024
VISIBLE_HEIGHT = 944
VISIBLE_MAX_WIDTH = 1008
BASELINE = 1000


def normalize_pose(path: Path) -> dict[str, object]:
    with Image.open(path) as source:
        rgba = source.convert("RGBA")
        alpha_box = rgba.getchannel("A").getbbox()
        if alpha_box is None:
            raise ValueError(f"{path.name} has no visible pixels")

        visible = rgba.crop(alpha_box)
        scale = min(VISIBLE_HEIGHT / visible.height, VISIBLE_MAX_WIDTH / visible.width)
        width = max(1, round(visible.width * scale))
        height = max(1, round(visible.height * scale))
        resized = visible.resize((width, height), Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE), (0, 0, 0, 0))
        left = (CANVAS_SIZE - width) // 2
        top = BASELINE - height
        canvas.alpha_composite(resized, (left, top))
        canvas.save(path, "WEBP", lossless=True, method=6)

    return {
        "file": path.name,
        "canvas": [CANVAS_SIZE, CANVAS_SIZE],
        "visible_box": [left, top, left + width, top + height],
        "baseline": BASELINE,
    }


def main() -> None:
    public_dir = Path(__file__).resolve().parents[1] / "public"
    manifest = [normalize_pose(public_dir / pose) for pose in POSES]
    manifest_path = public_dir / "phantom-pose-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
