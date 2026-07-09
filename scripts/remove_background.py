#!/usr/bin/env python3
"""PhantomForce — local background removal bridge.

Called by the server (server/src/phantom-ai/rembg-bridge.ts) as:
    <python> scripts/remove_background.py <input_path> <output_path>

Reads an image, removes its background with rembg, and writes a
transparent PNG. Never touches the network. Exits nonzero with a clear
message on stderr on any failure so the caller can show a real error
instead of failing silently.
"""
import sys


def fail(message):
    print(f"remove_background.py: {message}", file=sys.stderr)
    sys.exit(1)


def main():
    if len(sys.argv) != 3:
        fail(f"expected 2 arguments (input_path output_path), got {len(sys.argv) - 1}")

    input_path, output_path = sys.argv[1], sys.argv[2]

    try:
        from PIL import Image
    except ImportError as error:
        fail(f"Pillow is not installed ({error}). Install it with: pip install pillow")

    try:
        from rembg import remove
    except ImportError as error:
        fail(f"rembg is not installed ({error}). Install it with: pip install rembg")

    try:
        source = Image.open(input_path)
        source.load()
        source = source.convert("RGBA")
    except Exception as error:
        fail(f"could not open input image at {input_path}: {error}")

    try:
        result = remove(source)
    except Exception as error:
        fail(f"rembg failed while removing the background: {error}")

    try:
        if result.mode != "RGBA":
            result = result.convert("RGBA")
        result.save(output_path, "PNG")
    except Exception as error:
        fail(f"could not save output PNG to {output_path}: {error}")

    print("ok")


if __name__ == "__main__":
    main()
