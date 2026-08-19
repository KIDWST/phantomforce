"""One-editor-session CubeTown V17 import + persistent map patch."""
from __future__ import annotations
import os, runpy, unreal
root = os.path.abspath(unreal.Paths.project_dir())
for rel in ("Tools/ImportCubeTownV17CoreArt.py", "Tools/PatchCubeTownV17Diorama.py"):
    path = os.path.join(root, *rel.split('/'))
    unreal.log("CUBETOWN V17 RUNNING " + path)
    runpy.run_path(path, run_name="__main__")
unreal.log("CUBETOWN V17 EDITOR PIPELINE PASS")
