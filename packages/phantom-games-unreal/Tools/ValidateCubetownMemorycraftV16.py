from __future__ import annotations

import hashlib
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
CPP = ROOT / "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp"
HDR = ROOT / "Source/PhantomGames/Public/Cubetown/CubetownDirector.h"
DOC = ROOT / "Docs/Production/CUBETOWN_MEMORYCRAFT_V16.md"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    require(CPP.is_file(), f"missing {CPP}")
    require(HDR.is_file(), f"missing {HDR}")
    require(DOC.is_file(), f"missing {DOC}")
    cpp = CPP.read_text(encoding="utf-8")
    hdr = HDR.read_text(encoding="utf-8")

    required = [
        "ECubetownEchoType::Bridge",
        "ECubetownEchoType::TideSpire",
        "ECubetownEchoType::SkyPad",
        "ECubetownEchoType::BlastBloom",
        "ECubetownEchoType::GaleTotem",
        "ECubetownEchoType::Climbroot",
        "RecordCreationAtCursor",
        "BeginWeave",
        "UpdateCreationUtilities",
        "SpawnMemorycraftTrials",
        "CreationUnlockMask",
        "GetCreationBudgetUsed",
        "Cubetown.Weavable",
        "SetMobility(EComponentMobility::Movable)",
        "CreationRole",
    ]
    for token in required:
        require(token in cpp or token in hdr, f"missing V16 token: {token}")

    require(cpp.count("{") == cpp.count("}"), "C++ source brace count mismatch")
    require(hdr.count("{") == hdr.count("}"), "C++ header brace count mismatch")

    # The feature must remain original CubeTown content, not branded/copy-pasted Nintendo content.
    forbidden = ["Echoes of Wisdom", "Hyrule", "Tri Rod", "Triforce", "Princess Zelda", "Ganon"]
    shipped = cpp + "\n" + hdr
    for term in forbidden:
        require(term.lower() not in shipped.lower(), f"foreign IP term leaked into shipped source: {term}")

    print("PASS: CubeTown V16 Memorycraft static validation")
    print("cpp_sha256", hashlib.sha256(CPP.read_bytes()).hexdigest())
    print("hdr_sha256", hashlib.sha256(HDR.read_bytes()).hexdigest())
    print("NOTE: this is static validation; Unreal compile/PIE/package verification still runs on the Windows UE5.8 workstation.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        raise SystemExit(1)
