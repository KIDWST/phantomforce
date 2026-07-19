import os
import sys
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import tools  # noqa: E402


def test_safe_pc_path_allows_home_dir_subpath(tmp_path, monkeypatch):
    monkeypatch.setattr(tools, "HOME_DIR", str(tmp_path))
    monkeypatch.setattr(tools, "WORKSPACE_DIR", str(tmp_path / "workspace"))
    monkeypatch.setattr(tools, "OUTPUT_DIR", str(tmp_path / "output"))
    result = tools.safe_pc_path("Documents/file.txt")
    assert result == os.path.abspath(os.path.join(str(tmp_path), "Documents/file.txt"))


def test_safe_pc_path_rejects_path_outside_boundary(tmp_path, monkeypatch):
    monkeypatch.setattr(tools, "HOME_DIR", str(tmp_path))
    monkeypatch.setattr(tools, "WORKSPACE_DIR", str(tmp_path / "workspace"))
    monkeypatch.setattr(tools, "OUTPUT_DIR", str(tmp_path / "output"))
    with pytest.raises(ValueError):
        tools.safe_pc_path("../../etc/passwd")


def test_list_dir_returns_items(tmp_path, monkeypatch):
    monkeypatch.setattr(tools, "HOME_DIR", str(tmp_path))
    monkeypatch.setattr(tools, "WORKSPACE_DIR", str(tmp_path / "workspace"))
    monkeypatch.setattr(tools, "OUTPUT_DIR", str(tmp_path / "output"))
    (tmp_path / "a.txt").write_text("hi")
    result = tools.list_dir(".")
    assert result["ok"] is True
    names = [item["name"] for item in result["items"]]
    assert "a.txt" in names


def test_write_then_read_file_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr(tools, "HOME_DIR", str(tmp_path))
    monkeypatch.setattr(tools, "WORKSPACE_DIR", str(tmp_path / "workspace"))
    monkeypatch.setattr(tools, "OUTPUT_DIR", str(tmp_path / "output"))
    write_result = tools.write_pc_file("note.txt", "hello world")
    assert write_result["ok"] is True
    read_result = tools.read_file("note.txt")
    assert read_result["ok"] is True
    assert read_result["content"] == "hello world"


def test_edit_file_replaces_unique_match(tmp_path, monkeypatch):
    monkeypatch.setattr(tools, "HOME_DIR", str(tmp_path))
    monkeypatch.setattr(tools, "WORKSPACE_DIR", str(tmp_path / "workspace"))
    monkeypatch.setattr(tools, "OUTPUT_DIR", str(tmp_path / "output"))
    tools.write_pc_file("code.py", "def foo():\n    return 1\n")
    result = tools.edit_file("code.py", "return 1", "return 2")
    assert result["ok"] is True
    assert tools.read_file("code.py")["content"].replace("\r\n", "\n") == "def foo():\n    return 2\n"


def test_edit_file_rejects_ambiguous_match(tmp_path, monkeypatch):
    monkeypatch.setattr(tools, "HOME_DIR", str(tmp_path))
    monkeypatch.setattr(tools, "WORKSPACE_DIR", str(tmp_path / "workspace"))
    monkeypatch.setattr(tools, "OUTPUT_DIR", str(tmp_path / "output"))
    tools.write_pc_file("code.py", "x = 1\nx = 1\n")
    result = tools.edit_file("code.py", "x = 1", "x = 2")
    assert result["ok"] is False
    assert "not unique" in result["error"]


def test_edit_file_replace_all(tmp_path, monkeypatch):
    monkeypatch.setattr(tools, "HOME_DIR", str(tmp_path))
    monkeypatch.setattr(tools, "WORKSPACE_DIR", str(tmp_path / "workspace"))
    monkeypatch.setattr(tools, "OUTPUT_DIR", str(tmp_path / "output"))
    tools.write_pc_file("code.py", "x = 1\nx = 1\n")
    result = tools.edit_file("code.py", "x = 1", "x = 2", replace_all=True)
    assert result["ok"] is True
    assert tools.read_file("code.py")["content"].replace("\r\n", "\n") == "x = 2\nx = 2\n"


def test_grep_finds_matching_line(tmp_path, monkeypatch):
    monkeypatch.setattr(tools, "HOME_DIR", str(tmp_path))
    monkeypatch.setattr(tools, "WORKSPACE_DIR", str(tmp_path / "workspace"))
    monkeypatch.setattr(tools, "OUTPUT_DIR", str(tmp_path / "output"))
    tools.write_pc_file("a.py", "def handler():\n    pass\n")
    tools.write_pc_file("b.py", "x = 1\n")
    result = tools.grep("def handler")
    assert result["ok"] is True
    assert any(m["path"].endswith("a.py") and m["line"] == 1 for m in result["matches"])
    assert not any(m["path"].endswith("b.py") for m in result["matches"])


def test_glob_files_matches_pattern(tmp_path, monkeypatch):
    monkeypatch.setattr(tools, "HOME_DIR", str(tmp_path))
    monkeypatch.setattr(tools, "WORKSPACE_DIR", str(tmp_path / "workspace"))
    monkeypatch.setattr(tools, "OUTPUT_DIR", str(tmp_path / "output"))
    tools.write_pc_file("a.py", "x")
    tools.write_pc_file("b.txt", "x")
    result = tools.glob_files("*.py")
    names = [os.path.basename(p) for p in result["paths"]]
    assert "a.py" in names
    assert "b.txt" not in names


from unittest.mock import patch, MagicMock


def test_make_generated_graphic_invokes_media_helper(tmp_path, monkeypatch):
    monkeypatch.setattr(tools, "APP_DIR", str(tmp_path))
    fake_proc = MagicMock(returncode=0, stdout='{"ok": true}', stderr="")
    with patch("subprocess.run", return_value=fake_proc):
        (tmp_path / "phantombot-media-tools.py").write_text("")
        result = tools.make_generated_graphic("Title", "prompt text", format="png")
    assert result["ok"] is True


def test_stage_discord_writes_manifest_without_sending(tmp_path, monkeypatch):
    monkeypatch.setattr(tools, "HOME_DIR", str(tmp_path))
    monkeypatch.setattr(tools, "WORKSPACE_DIR", str(tmp_path / "workspace"))
    monkeypatch.setattr(tools, "OUTPUT_DIR", str(tmp_path / "output"))
    result = tools.stage_discord("hello", [])
    assert result["ok"] is True
    assert result["sendPerformed"] is False
    assert result["approvalRequired"] is True


def test_write_and_run_writes_then_executes(tmp_path, monkeypatch):
    monkeypatch.setattr(tools, "WORKSPACE_DIR", str(tmp_path / "workspace"))
    with patch.object(tools, "run_visible_terminal", return_value={"ok": True, "visibleTerminal": True}) as mock_run:
        result = tools.write_and_run("task.py", "print('hi')", cmd="python task.py")
    assert result["ok"] is True
    mock_run.assert_called_once_with("python task.py")


def test_app_dir_points_to_repo_root_where_helper_scripts_live():
    # Regression test: APP_DIR must point to the repo root (one level above
    # phantombot-engine/), where phantombot-acceptance.py and friends
    # actually live as siblings of the phantombot-engine/ package —
    # NOT monkeypatched, exercises the real __file__-derived path.
    expected_root = os.path.dirname(os.path.dirname(os.path.abspath(tools.__file__)))
    assert tools.APP_DIR == expected_root
    # phantombot-acceptance.py should exist at that location in this repo
    assert os.path.exists(os.path.join(tools.APP_DIR, "phantombot-acceptance.py")), (
        f"expected phantombot-acceptance.py at {tools.APP_DIR}, but it was not found there"
    )
