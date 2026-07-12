#!/usr/bin/env python3
"""PhantomForce Asset Cloud image probe + thumbnail.

Usage: asset_probe.py <input_path> <thumbnail_output_path>

Prints a single JSON line to stdout:
  {"ok": true, "width": W, "height": H, "format": "PNG",
   "thumbnail": true|false, "thumb_width": W2, "thumb_height": H2}

The thumbnail is a max-512px WEBP (quality 82). Never modifies the input.
Exit code 0 with ok:false + error for unreadable/non-image inputs so the
caller can mark processing failed without treating it as a crash.
"""
import json
import sys


def main() -> int:
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "usage: asset_probe.py <input> <thumb_out>"}))
        return 0
    input_path, thumb_path = sys.argv[1], sys.argv[2]
    try:
        from PIL import Image
    except Exception as exc:  # pragma: no cover
        print(json.dumps({"ok": False, "error": f"pillow_unavailable: {exc}"}))
        return 0
    try:
        with Image.open(input_path) as im:
            im.load()
            width, height = im.size
            fmt = im.format or "unknown"
            thumb = im.convert("RGBA") if im.mode in ("P", "LA") else im.copy()
            thumb.thumbnail((512, 512))
            if thumb.mode not in ("RGB", "RGBA"):
                thumb = thumb.convert("RGB")
            thumb.save(thumb_path, "WEBP", quality=82, method=4)
            tw, th = thumb.size
        print(json.dumps({
            "ok": True, "width": width, "height": height, "format": fmt,
            "thumbnail": True, "thumb_width": tw, "thumb_height": th,
        }))
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)[:300]}))
        return 0


if __name__ == "__main__":
    sys.exit(main())
