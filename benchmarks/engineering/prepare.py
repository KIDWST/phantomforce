"""Prepare an isolated benchmark repository without copying evaluator metadata."""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path


FIXTURES = {
    "BROWSER-001": "golden-web-app",
    "FULL-001": "golden-web-app",
    "WEB-001": "golden-web-app",
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mission", choices=sorted(FIXTURES))
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    source = Path(__file__).resolve().parent / "fixtures" / FIXTURES[args.mission]
    destination = args.destination.resolve()
    if destination.exists():
        raise SystemExit(f"destination already exists: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, destination)
    print(destination)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
