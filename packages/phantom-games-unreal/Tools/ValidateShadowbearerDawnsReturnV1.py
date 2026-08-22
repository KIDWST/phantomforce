from __future__ import annotations

import hashlib
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
CPP = ROOT / "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp"
HDR = ROOT / "Source/PhantomGames/Public/Cubetown/CubetownDirector.h"
APP = REPO / "app/js/phantomplay.js"
SHELL = REPO / "packages/phantomplay-dioxus-shell/src/main.rs"
REFERENCE = REPO / "app/assets/phantomplay/shadowbearer-cover.png"
MANIFEST = ROOT / "Docs/Shadowbearer/ArtBible/REFERENCE_MANIFEST.md"
CANON = ROOT / "Docs/Shadowbearer/COMPLETE_STORY_CANON.md"
CAPTURE = ROOT / "Tools/Capture-GameplayProof.ps1"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    for path in (CPP, HDR, APP, SHELL, REFERENCE, MANIFEST, CANON, CAPTURE):
        require(path.is_file(), f"missing {path}")
    cpp = CPP.read_text(encoding="utf-8")
    hdr = HDR.read_text(encoding="utf-8")
    app = APP.read_text(encoding="utf-8")
    shell = SHELL.read_text(encoding="utf-8")
    canon = CANON.read_text(encoding="utf-8")
    capture = CAPTURE.read_text(encoding="utf-8")

    required_runtime = [
        "EShadowbearerWorldState::Dawn",
        "EShadowbearerWorldState::Omen",
        "EShadowbearerWorldState::Shadowfall",
        "EShadowbearerWorldState::Restoring",
        "EShadowbearerWorldState::Restored",
        "BuildShadowbearerOpening",
        "SpawnPaleWarden",
        "IsOpeningStoryDefeatActive",
        "SolidifyFirstShadow",
        "RestoreBramblewickLamp",
        "Shadowbearer.DeliveryShrine",
        "Shadowbearer.FirstShadow",
        "Shadowbearer.RestorationLamp",
        "Shadowbearer.ShadowGrade",
        "ShadowbearerCaptureState=",
        "bFirstShadowSolidified",
        "bBramblewickLampRestored",
        "AdvanceAktarusPhase",
        "MaxHealth",
        "AktarusPhase",
        "Shadowbearer.ReturnedSoulAlly",
        "bNightspineOwned",
        "bVestigeOwned",
        "bFirstEclipseUnlocked",
        "bEclipsedDawnlantern",
        "bPostgameUnlocked",
    ]
    shipped = cpp + "\n" + hdr
    for token in required_runtime:
        require(token in shipped, f"missing Shadowbearer runtime contract: {token}")

    for person in ("SERA", "MARA", "TESS", "VARA", "BRANN", "ORIN"):
        require(person in cpp, f"missing Bramblewick resident: {person}")

    canonical_story = [
        "SUNPETAL MEADOW",
        "THE PALE WARDEN",
        "SHADOWFALL",
        "BELLROOT WOOD",
        "THE CATHEDRAL STAG",
        "ANTLER'S EDGE",
        "MOURNMARKET",
        "THE MARIONETTE MAYOR",
        "THE PUPPETMASTER'S CANE",
        "THE REMNANT ESTATE",
        "CHRONOS LIGHT",
        "DEEPWARREN",
        "THE BURROW MAW",
        "UMBRAL STORAGE",
        "LIVING SHADOWS",
        "THE SKYFALL MATRON",
        "STORMVEIL",
        "VESPERHOLD",
        "THE ECLIPSE SERAPH",
        "ECLIPSE BRAND",
        "THE BLACK MERIDIAN",
        "PHASE I // THE BEARER OF NIGHT",
        "PHASE II // NIGHTSPINE",
        "PHASE III // THE STOLEN",
        "PHASE IV // BEFORE THE SHADOWBEARER",
        "PHASE V // THE LAST SHADOW",
        "NIGHTSPINE ACQUIRED",
        "VESTIGE OF THE SHADOWBEARER",
        "THE FIRST ECLIPSE",
        "THE DAWNBEARER",
        "DAWN'S RETURN",
    ]
    for token in canonical_story:
        require(token in cpp, f"missing complete-story runtime anchor: {token}")

    exact_dialogue = [
        "The dawn has already ended.",
        "I remember the sun.",
        "Memory is not truth.",
        "Neither did we.",
        "Do not forgive him because you understand him.",
        "I burned his home.",
        "My name is Aktarus.",
        "I became everything I believed the light had done to us.",
        "There is no dawn without night.",
        "I brought him home.",
    ]
    for line in exact_dialogue:
        require(line in cpp, f"missing canonical dialogue: {line}")

    for retired in ("KAEL", "ILYRA"):
        require(retired not in cpp and retired not in hdr, f"superseded Bramblewick resident remains: {retired}")

    for capture_state in ("prologue", "finale", "aktarus", "eclipse", "postgame"):
        require(f"'{capture_state}'" in capture, f"gameplay proof cannot capture story state: {capture_state}")
    require("sole story authority" in canon, "canon document does not establish authority")
    require("5182BAFAA1D62890BD4C14BDAABF5CF43CC3412870C661033961425DF60D64EE" in canon,
            "canon source hash changed or is absent")

    require('title: "Shadowbearer: Dawn\'s Return"' in app, "web catalog still lacks public title")
    require('version: "1.0.1-dawns-return"' in app, "web catalog is not advertising the complete-story build")
    require('"Shadowbearer: Dawn\'s Return"' in shell, "desktop catalog still lacks public title")
    require('artUrl("shadowbearer-cover.png")' in app, "web catalog is not using canonical art")
    require(REFERENCE.stat().st_size > 500_000, "canonical reference art is missing or placeholder-sized")
    require(cpp.count("{") == cpp.count("}"), "C++ source brace count mismatch")
    require(hdr.count("{") == hdr.count("}"), "C++ header brace count mismatch")

    forbidden_public = ('title: "CubeTown"', '"Cubetown",\n            "Voxel echo-adventure')
    public_surface = app + "\n" + shell
    for term in forbidden_public:
        require(term not in public_surface, f"retired public identity remains: {term}")

    print("PASS: Shadowbearer: Dawn's Return V1 static validation")
    print("cpp_sha256", hashlib.sha256(CPP.read_bytes()).hexdigest())
    print("reference_sha256", hashlib.sha256(REFERENCE.read_bytes()).hexdigest())
    print("NOTE: internal cubetown id/target remains intentionally stable for save, install, and launcher compatibility.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        raise SystemExit(1)
