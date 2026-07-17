# PhantomBot ⇄ Termina Mission Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let PhantomBot (`C:\Users\jorda\Documents\VM-Share\Phantombot-Unleashed\phantombot_unleashed.py`) trigger Termina's existing Mission Mode — decompose an objective into up to 20 parallel Claude/Codex CLI workers, each in an isolated git worktree — via `/mission`, `/termina`, or plain language, from PhantomBot's own desktop chat.

**Architecture:** PhantomBot becomes an HTTP client of Termina's already-running local mission API (`http://127.0.0.1:7420`, token-gated, `127.0.0.1`-only). A new `termina_bridge.py` module in the PhantomBot repo owns all HTTP calls and process auto-launch; `phantombot_unleashed.py` gains two new tools (`start_mission`, `get_mission_status`) in its existing tool-calling loop, plus direct `/mission`/`/termina` slash-command parsing. A background polling thread relays worker-status changes into PhantomBot's chat and, when the mission finishes, stages (and — see Task 6 — auto-approves) a Discord notification through PhantomBot's existing staged-send pipeline.

**Tech Stack:** Node.js (Termina, unchanged), Python 3.11 stdlib only for the PhantomBot side (`urllib.request`, `json`, `threading`, `unittest` — no new pip dependency).

## Global Constraints

- Termina's API is token-gated via the `x-termina-token` header; the token comes from the `TERMINA_TOKEN` environment variable (Termina already supports this — `server.js` line 48: `process.env.TERMINA_TOKEN ?? randomBytes(24)...`). Both processes must have the **same** `TERMINA_TOKEN` set in their environment — this plan does not invent a new config file for it.
- Termina binds to `127.0.0.1` only. Nothing in this plan changes that.
- Mission `mode` (`plan`/`approval`/`auto`) is never silently defaulted or inferred from wording — always explicit from the command, a stored user preference, or an asked question (per the approved design).
- No new pip/npm dependencies. PhantomBot side uses only stdlib (`urllib.request`, already imported at the top of `phantombot_unleashed.py`). Termina side has no new dependency either.
- **Known gap, out of scope for this plan (see "Follow-up" section at the end):** PhantomBot's Discord bridge (`phantombot-discord-bridge.py`) is currently outbound-only (stage → manual `send_approved`), with no inbound message listener. True "trigger a mission by texting Discord from your phone" requires a new inbound bot listener that does not exist yet. This plan delivers the full local-desktop-chat round trip and *outbound* Discord status notifications through the existing staged-send pipeline; it does not build a new inbound Discord bot connection.

---

## File Structure

**Termina repo** (`C:\Users\jorda\Termina`):
- Modify: `server.js` — raise the mission worker-count cap from 10 to 20.
- Modify: `mission/decompose.js` — update the cap mentioned in the LLM prompt text.
- Create: `tests/mission/decompose-cap.test.mjs` — covers the cap change.

**PhantomBot repo** (`C:\Users\jorda\Documents\VM-Share\Phantombot-Unleashed`):
- Create: `termina_bridge.py` — pure HTTP client + process launcher for Termina's mission API. No UI/LLM code, no `tkinter` import — testable standalone.
- Create: `mission_config.py` — tiny JSON-file-backed store for the persistent mode default (`/mission set-default`).
- Create: `tests/test_termina_bridge.py` — unit tests for `termina_bridge.py`, mocking `urllib.request.urlopen`.
- Create: `tests/test_mission_config.py` — unit tests for `mission_config.py`.
- Modify: `phantombot_unleashed.py` — env constants, system-prompt tool entries, `_execute_tool_plan` branches, `_start_mission`/`_get_mission_status`/`_infer_workspace_root`/`_quiet_llm_call` methods, `/mission`+`/termina` direct-trigger parsing, background status-poller + Discord relay.

---

### Task 1: Termina — raise mission worker cap from 10 to 20

**Files:**
- Modify: `C:\Users\jorda\Termina\server.js:647`
- Modify: `C:\Users\jorda\Termina\mission\decompose.js:39-40`
- Test: `C:\Users\jorda\Termina\tests\mission\decompose-cap.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `/api/missions/decompose` now accepts `workerCount` up to 20 (was 10). No signature changes — `decomposeObjective({ objective, workerCount, workspaceRoot, scratchDir })` in `mission/decompose.js` is unchanged except its prompt string.

- [ ] **Step 1: Write the failing test**

Create `C:\Users\jorda\Termina\tests\mission\decompose-cap.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";

// decomposeObjective itself just forwards workerCount into a prompt string —
// the actual clamping (2..20) happens in server.js's request handler, which
// isn't unit-testable without an HTTP call. This test locks the *prompt*
// side of the contract: the guidance text must mention the new ceiling so a
// future reader (human or model) doesn't see stale "10" language.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const decomposeSrc = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "mission", "decompose.js"),
  "utf-8"
);

test("decompose.js's worker-count guidance mentions the 20-worker ceiling, not the old 10", () => {
  assert.ok(!decomposeSrc.includes("(typically 2-6"), "old guidance text should have been replaced");
  assert.ok(decomposeSrc.includes("up to 20"), "prompt should mention the new ceiling");
});

const serverSrc = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "server.js"), "utf-8");

test("server.js clamps workerCount to a max of 20, not 10", () => {
  assert.ok(serverSrc.includes("Math.min(20, rawCount)"), "server.js should clamp to 20");
  assert.ok(!serverSrc.includes("Math.min(10, rawCount)"), "old 10-cap should be gone");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\Users\jorda\Termina && node --test tests/mission/decompose-cap.test.mjs`
Expected: both tests FAIL (current code still says `Math.min(10, rawCount)` and `"typically 2-6"`).

- [ ] **Step 3: Make the change**

In `server.js`, find (around line 647):

```js
    const workerCount = Number.isFinite(rawCount) && rawCount > 0 ? Math.max(2, Math.min(10, rawCount)) : undefined;
```

Replace with:

```js
    const workerCount = Number.isFinite(rawCount) && rawCount > 0 ? Math.max(2, Math.min(20, rawCount)) : undefined;
```

In `mission/decompose.js`, find (around lines 39-40):

```js
    : `into however many distinct, non-overlapping worker roles this objective actually calls for ` +
      `(typically 2-6 — use your judgment; don't split into more roles than there is real independent work)`;
```

Replace with:

```js
    : `into however many distinct, non-overlapping worker roles this objective actually calls for ` +
      `(typically 2-6, up to 20 for genuinely large objectives — use your judgment; don't split into more ` +
      `roles than there is real independent work)`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:\Users\jorda\Termina && node --test tests/mission/decompose-cap.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full existing mission test suite to check for regressions**

Run: `cd C:\Users\jorda\Termina && node --test tests/mission/`
Expected: all existing tests still PASS (this change doesn't touch anything else they cover).

- [ ] **Step 6: Commit**

```bash
cd C:\Users\jorda\Termina
git add server.js mission/decompose.js tests/mission/decompose-cap.test.mjs
git commit -m "Raise mission worker cap from 10 to 20"
```

---

### Task 2: PhantomBot — `termina_bridge.py` HTTP client module

**Files:**
- Create: `C:\Users\jorda\Documents\VM-Share\Phantombot-Unleashed\termina_bridge.py`
- Test: `C:\Users\jorda\Documents\VM-Share\Phantombot-Unleashed\tests\test_termina_bridge.py`

**Interfaces:**
- Consumes: nothing from other new files (foundational module). Reads `TERMINA_URL`/`TERMINA_TOKEN` from the environment via parameters passed in by the caller (not read internally — keeps this module free of global state, easier to test).
- Produces (used by Task 4):
  - `class TerminaError(Exception)`
  - `is_running(base_url: str, timeout_s: float = 3.0) -> bool`
  - `ensure_running(base_url: str, launch_dir: str, timeout_s: float = 30.0) -> None` — raises `TerminaError` if it can't reach Termina after attempting to launch it.
  - `decompose(base_url: str, token: str, objective: str, workspace_root: str, worker_count: int | None = None) -> dict` — returns `{"roles": [...], "missionName": str, "costUsd": float | None}`.
  - `create_mission(base_url: str, token: str, name: str, objective: str, workspace_root: str, launch_mode: str, roles: list) -> dict` — returns the `mission` object.
  - `get_mission(base_url: str, token: str, mission_id: str) -> dict` — returns `{"mission": {...}, "ledger": [...], "tokens": {...}}`.
  - `list_repos(base_url: str, token: str) -> list` — returns `[{"path": str, "name": str}, ...]`.
  - `is_mission_done(mission: dict, ledger: list) -> bool` — `True` once every worker is either abnormally terminated by status (`failed`/`stopped`) or has a `COMPLETE`/`FAILED` event for its id in the ledger. (`worker.status` alone never reaches a "finished successfully" value in Termina's real server — that signal only exists as a ledger event from the CLI's own self-reporting protocol, `mission/protocol.js`.)
  - `synthesize(base_url: str, token: str, mission_id: str) -> dict` — returns `{"report": {...}, "markdown": str, "costUsd": float | None}`.

- [ ] **Step 1: Add `tests/conftest.py` so test files can import the app-root modules**

Create `C:\Users\jorda\Documents\VM-Share\Phantombot-Unleashed\tests\conftest.py`:

```python
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
```

(Standard pytest pattern: this runs once before any test in `tests/` collects, and puts the app root — where `termina_bridge.py` and `mission_config.py` live — on `sys.path`, so `import termina_bridge` works from a test file one directory down without needing a package/`__init__.py` setup. Task 3's `tests/test_mission_config.py` relies on this same `conftest.py`; it does not need its own.)

- [ ] **Step 2: Write the failing tests**

Create `C:\Users\jorda\Documents\VM-Share\Phantombot-Unleashed\tests\test_termina_bridge.py`:

```python
import json
import unittest
from unittest.mock import patch, MagicMock
from urllib.error import URLError

import termina_bridge as tb


def _mock_response(payload, status=200):
    m = MagicMock()
    m.read.return_value = json.dumps(payload).encode("utf-8")
    m.status = status
    m.__enter__.return_value = m
    m.__exit__.return_value = False
    return m


class TerminaBridgeHttpTests(unittest.TestCase):
    def test_is_running_true_on_200(self):
        with patch("termina_bridge.urllib.request.urlopen", return_value=_mock_response({"ok": True})):
            self.assertTrue(tb.is_running("http://127.0.0.1:7420"))

    def test_is_running_false_on_connection_error(self):
        with patch("termina_bridge.urllib.request.urlopen", side_effect=URLError("refused")):
            self.assertFalse(tb.is_running("http://127.0.0.1:7420"))

    def test_decompose_sends_token_header_and_parses_roles(self):
        payload = {"ok": True, "roles": [{"name": "A", "scope": "s", "deliverables": "d", "prohibited": "p"}], "missionName": "Test Mission", "costUsd": 0.02}
        captured = {}

        def fake_urlopen(req, timeout=None):
            captured["header"] = req.get_header("X-termina-token")
            captured["url"] = req.full_url
            return _mock_response(payload)

        with patch("termina_bridge.urllib.request.urlopen", side_effect=fake_urlopen):
            result = tb.decompose("http://127.0.0.1:7420", "tok123", "fix the bug", "C:\\proj")

        self.assertEqual(captured["header"], "tok123")
        self.assertIn("/api/missions/decompose", captured["url"])
        self.assertEqual(result["missionName"], "Test Mission")
        self.assertEqual(len(result["roles"]), 1)

    def test_decompose_raises_terminia_error_on_ok_false(self):
        with patch("termina_bridge.urllib.request.urlopen", return_value=_mock_response({"ok": False, "error": "objective_required"})):
            with self.assertRaises(tb.TerminaError):
                tb.decompose("http://127.0.0.1:7420", "tok123", "", "C:\\proj")

    def test_create_mission_returns_mission_object(self):
        payload = {"ok": True, "mission": {"id": "abc123", "name": "Test", "workers": []}}
        with patch("termina_bridge.urllib.request.urlopen", return_value=_mock_response(payload)):
            mission = tb.create_mission("http://127.0.0.1:7420", "tok", "Test", "objective", "C:\\proj", "approval", [{"name": "A", "scope": "s", "deliverables": "d", "prohibited": "p"}])
        self.assertEqual(mission["id"], "abc123")

    def test_get_mission_returns_full_payload(self):
        payload = {"ok": True, "mission": {"id": "abc123", "workers": []}, "ledger": [], "tokens": {}}
        with patch("termina_bridge.urllib.request.urlopen", return_value=_mock_response(payload)):
            result = tb.get_mission("http://127.0.0.1:7420", "tok", "abc123")
        self.assertEqual(result["mission"]["id"], "abc123")
        self.assertEqual(result["ledger"], [])

    def test_list_repos_returns_repo_list(self):
        payload = {"ok": True, "repos": [{"path": "C:\\proj", "name": "proj"}]}
        with patch("termina_bridge.urllib.request.urlopen", return_value=_mock_response(payload)):
            repos = tb.list_repos("http://127.0.0.1:7420", "tok")
        self.assertEqual(repos, [{"path": "C:\\proj", "name": "proj"}])

    def test_synthesize_returns_markdown(self):
        payload = {"ok": True, "report": {"summary": "done"}, "markdown": "# Report", "costUsd": 0.5}
        with patch("termina_bridge.urllib.request.urlopen", return_value=_mock_response(payload)):
            result = tb.synthesize("http://127.0.0.1:7420", "tok", "abc123")
        self.assertEqual(result["markdown"], "# Report")


class IsMissionDoneTests(unittest.TestCase):
    def test_false_when_any_worker_still_running(self):
        mission = {"workers": [{"status": "completed"}, {"status": "running"}]}
        self.assertFalse(tb.is_mission_done(mission))

    def test_false_when_any_worker_still_starting(self):
        mission = {"workers": [{"status": "starting"}]}
        self.assertFalse(tb.is_mission_done(mission))

    def test_true_when_all_workers_terminal(self):
        mission = {"workers": [{"status": "completed"}, {"status": "failed"}, {"status": "stopped"}]}
        self.assertTrue(tb.is_mission_done(mission))

    def test_true_when_no_workers(self):
        self.assertTrue(tb.is_mission_done({"workers": []}))


class EnsureRunningTests(unittest.TestCase):
    def test_does_nothing_if_already_running(self):
        with patch("termina_bridge.is_running", return_value=True), \
             patch("termina_bridge.subprocess.Popen") as popen:
            tb.ensure_running("http://127.0.0.1:7420", "C:\\Users\\jorda\\Termina")
            popen.assert_not_called()

    def test_launches_and_waits_if_not_running(self):
        calls = {"n": 0}

        def fake_is_running(url):
            calls["n"] += 1
            return calls["n"] > 2  # not running for first 2 checks, then up

        with patch("termina_bridge.is_running", side_effect=fake_is_running), \
             patch("termina_bridge.subprocess.Popen") as popen, \
             patch("termina_bridge.time.sleep"):
            tb.ensure_running("http://127.0.0.1:7420", "C:\\Users\\jorda\\Termina", timeout_s=10)
            popen.assert_called_once()

    def test_raises_terminia_error_if_never_comes_up(self):
        with patch("termina_bridge.is_running", return_value=False), \
             patch("termina_bridge.subprocess.Popen"), \
             patch("termina_bridge.time.sleep"), \
             patch("termina_bridge.time.monotonic", side_effect=[0, 1, 5, 11, 31]):
            with self.assertRaises(tb.TerminaError):
                tb.ensure_running("http://127.0.0.1:7420", "C:\\Users\\jorda\\Termina", timeout_s=30)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd C:\Users\jorda\Documents\VM-Share\Phantombot-Unleashed && python -m pytest tests/test_termina_bridge.py -v`
Expected: collection error / `ModuleNotFoundError: No module named 'termina_bridge'` (module doesn't exist yet).

- [ ] **Step 4: Write `termina_bridge.py`**

Create `C:\Users\jorda\Documents\VM-Share\Phantombot-Unleashed\termina_bridge.py`:

```python
"""HTTP client for Termina's local Mission API (http://127.0.0.1:7420).

No UI, no LLM calls, no tkinter import here on purpose — this module is
pure I/O against Termina's REST API plus the one bit of process management
(auto-launching Termina if it isn't running) needed to make that reliable.
Kept import-light and side-effect-free at import time so it's cheap to unit
test with urllib mocked out.
"""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

# Worker states Termina's own mission UI (public/mission.js) treats as
# finished — a worker never returns to a non-terminal state once it hits
# one of these. Mirrors the set the "Trigger Final Synthesis" button
# implicitly assumes is safe to act on.
TERMINAL_WORKER_STATUSES = {"completed", "failed", "stopped", "exited", "error"}


class TerminaError(Exception):
    pass


def _request(base_url, token, method, path, body=None, timeout=30):
    url = base_url.rstrip("/") + path
    headers = {"Content-Type": "application/json"}
    if token:
        headers["X-Termina-Token"] = token
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            payload = json.loads(r.read().decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as e:
        try:
            payload = json.loads(e.read().decode("utf-8", errors="replace"))
        except Exception:
            payload = {"ok": False, "error": f"http_{e.code}"}
    if not payload.get("ok", False):
        raise TerminaError(payload.get("error", "unknown_termina_error"))
    return payload


def is_running(base_url, timeout_s=3.0):
    try:
        req = urllib.request.Request(base_url.rstrip("/") + "/api/health", method="GET")
        with urllib.request.urlopen(req, timeout=timeout_s) as r:
            return r.status == 200
    except Exception:
        return False


def ensure_running(base_url, launch_dir, timeout_s=30.0):
    if is_running(base_url):
        return
    electron = os.path.join(launch_dir, "node_modules", "electron", "dist", "electron.exe")
    if sys.platform.startswith("win") and os.path.exists(electron):
        subprocess.Popen([electron, "."], cwd=launch_dir, close_fds=True)
    else:
        # Non-Windows / dev fallback: run the plain HTTP server directly.
        subprocess.Popen(["node", "server.js"], cwd=launch_dir, close_fds=True)

    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if is_running(base_url):
            return
        time.sleep(1)
    raise TerminaError(f"Termina did not come up at {base_url} within {timeout_s}s")


def decompose(base_url, token, objective, workspace_root, worker_count=None):
    body = {"objective": objective, "workspaceRoot": workspace_root}
    if worker_count is not None:
        body["workerCount"] = worker_count
    payload = _request(base_url, token, "POST", "/api/missions/decompose", body)
    return {"roles": payload["roles"], "missionName": payload["missionName"], "costUsd": payload.get("costUsd")}


def create_mission(base_url, token, name, objective, workspace_root, launch_mode, roles):
    body = {"name": name, "objective": objective, "workspaceRoot": workspace_root, "launchMode": launch_mode, "roles": roles}
    payload = _request(base_url, token, "POST", "/api/missions", body)
    return payload["mission"]


def get_mission(base_url, token, mission_id):
    payload = _request(base_url, token, "GET", f"/api/missions/{mission_id}")
    return {"mission": payload["mission"], "ledger": payload.get("ledger", []), "tokens": payload.get("tokens", {})}


def list_repos(base_url, token):
    payload = _request(base_url, token, "GET", "/api/repos")
    return payload["repos"]


def is_mission_done(mission):
    workers = mission.get("workers", [])
    if not workers:
        return True
    return all(w.get("status") in TERMINAL_WORKER_STATUSES for w in workers)


def synthesize(base_url, token, mission_id):
    payload = _request(base_url, token, "POST", f"/api/missions/{mission_id}/synthesize", body={})
    return {"report": payload["report"], "markdown": payload["markdown"], "costUsd": payload.get("costUsd")}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd C:\Users\jorda\Documents\VM-Share\Phantombot-Unleashed && python -m pytest tests/test_termina_bridge.py -v`
Expected: PASS (13 tests).

- [ ] **Step 6: Commit**

```bash
cd C:\Users\jorda\Documents\VM-Share\Phantombot-Unleashed
git init -q 2>NUL || echo already a repo
git add termina_bridge.py tests/test_termina_bridge.py tests/conftest.py
git commit -m "Add termina_bridge.py HTTP client for Termina's mission API"
```

(This repo may not have git initialized yet — the `git init -q 2>NUL || echo already a repo` guard handles both cases without failing the step. If it wasn't a repo before, this is the first commit; check with the user before doing anything with it beyond local commits, per standing policy on new repos.)

---

### Task 3: PhantomBot — `mission_config.py` persistent mode-default store

**Files:**
- Create: `C:\Users\jorda\Documents\VM-Share\Phantombot-Unleashed\mission_config.py`
- Test: `C:\Users\jorda\Documents\VM-Share\Phantombot-Unleashed\tests\test_mission_config.py`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Task 5):
  - `VALID_DEFAULTS = {"auto", "approval", "ask"}`
  - `get_default_mode(config_path: str) -> str` — returns `"ask"` if no config file exists yet or the file is corrupt.
  - `set_default_mode(config_path: str, mode: str) -> None` — raises `ValueError` if `mode` isn't in `VALID_DEFAULTS`.

- [ ] **Step 1: Write the failing tests**

Create `C:\Users\jorda\Documents\VM-Share\Phantombot-Unleashed\tests\test_mission_config.py`:

```python
import json
import os
import tempfile
import unittest

import mission_config as mc


class MissionConfigTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.path = os.path.join(self.tmpdir, "phantombot-mission-config.json")

    def test_get_default_mode_returns_ask_when_no_file(self):
        self.assertEqual(mc.get_default_mode(self.path), "ask")

    def test_set_then_get_round_trips(self):
        mc.set_default_mode(self.path, "auto")
        self.assertEqual(mc.get_default_mode(self.path), "auto")

    def test_set_default_mode_rejects_invalid_value(self):
        with self.assertRaises(ValueError):
            mc.set_default_mode(self.path, "bypassPermissions")

    def test_get_default_mode_returns_ask_on_corrupt_file(self):
        with open(self.path, "w", encoding="utf-8") as f:
            f.write("{not valid json")
        self.assertEqual(mc.get_default_mode(self.path), "ask")

    def test_set_default_mode_overwrites_previous_value(self):
        mc.set_default_mode(self.path, "auto")
        mc.set_default_mode(self.path, "approval")
        self.assertEqual(mc.get_default_mode(self.path), "approval")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\Users\jorda\Documents\VM-Share\Phantombot-Unleashed && python -m pytest tests/test_mission_config.py -v`
Expected: `ModuleNotFoundError: No module named 'mission_config'`.

- [ ] **Step 3: Write `mission_config.py`**

Create `C:\Users\jorda\Documents\VM-Share\Phantombot-Unleashed\mission_config.py`:

```python
"""Tiny JSON-file-backed store for the /mission set-default preference."""
import json
import os

VALID_DEFAULTS = {"auto", "approval", "ask"}


def get_default_mode(config_path):
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        mode = data.get("defaultMode", "ask")
        return mode if mode in VALID_DEFAULTS else "ask"
    except Exception:
        return "ask"


def set_default_mode(config_path, mode):
    if mode not in VALID_DEFAULTS:
        raise ValueError(f"invalid mode: {mode!r}, must be one of {sorted(VALID_DEFAULTS)}")
    os.makedirs(os.path.dirname(config_path) or ".", exist_ok=True)
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump({"defaultMode": mode}, f, indent=2)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:\Users\jorda\Documents\VM-Share\Phantombot-Unleashed && python -m pytest tests/test_mission_config.py -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd C:\Users\jorda\Documents\VM-Share\Phantombot-Unleashed
git add mission_config.py tests/test_mission_config.py
git commit -m "Add mission_config.py for persistent /mission mode default"
```

---

### Task 4: PhantomBot — wire mission tools into the main app

**Files:**
- Modify: `C:\Users\jorda\Documents\VM-Share\Phantombot-Unleashed\phantombot_unleashed.py`

**Interfaces:**
- Consumes: `termina_bridge.{TerminaError, ensure_running, decompose, create_mission, get_mission, list_repos, is_mission_done, synthesize}` (Task 2), `mission_config.{get_default_mode, set_default_mode}` (Task 3).
- Produces: `RedFinApp._start_mission(self, objective, mode, workspace_hint=None) -> dict`, `RedFinApp._get_mission_status(self, mission_id) -> dict`, `RedFinApp._infer_workspace_root(self, objective, hint=None) -> str | None`, `RedFinApp._quiet_llm_call(self, prompt) -> str` — all consumed by Task 5 (slash commands) and Task 6 (status poller).

- [ ] **Step 1: Add imports and env-var constants**

In `phantombot_unleashed.py`, after line 17 (`import urllib.request`), add:

```python
import termina_bridge
import mission_config
```

After line 58 (`SAFE_KEY_RE = re.compile(...)`), add:

```python
TERMINA_URL = os.environ.get("TERMINA_URL", "http://127.0.0.1:7420").rstrip("/")
TERMINA_TOKEN = os.environ.get("TERMINA_TOKEN", "").strip()
TERMINA_LAUNCH_DIR = os.environ.get("TERMINA_LAUNCH_DIR", os.path.expanduser("~/Termina"))
MISSION_CONFIG_PATH = os.path.join(APP_DIR, "phantombot-mission-config.json")
```

For this to work outside of test mocks, both Termina and PhantomBot need to see the **same** `TERMINA_TOKEN` value. Set it once, persistently, as a Windows user environment variable (not just a per-terminal `set`, which wouldn't survive PhantomBot or Termina being auto-launched later from a different process tree):

```powershell
[Environment]::SetEnvironmentVariable("TERMINA_TOKEN", "<a-long-random-string-you-pick-once>", "User")
```

Run this once from any PowerShell window, then start a fresh terminal (env changes don't apply to already-open shells) before running either app. Both `server.js` (reads `process.env.TERMINA_TOKEN`) and this plan's PhantomBot code (reads `os.environ.get("TERMINA_TOKEN")`) pick it up automatically from there — no code change needed beyond what Task 4 already adds.

- [ ] **Step 2: Add the two new tools to the system prompt**

In the big system-prompt string (around line 116-118), after the `"run_acceptance"` line and before the `"write_and_run"` line, add two new tool examples:

```python
                "{\"tool\":\"run_acceptance\"} or "
                "{\"tool\":\"start_mission\",\"objective\":\"fix the leaderboard race condition\",\"mode\":\"approval\",\"workspaceHint\":\"phantomforce\"} or "
                "{\"tool\":\"get_mission_status\",\"missionId\":\"abc123\"} or "
                "{\"tool\":\"write_and_run\",\"name\":\"task.py\",\"content\":\"print('generated by RedFin')\",\"cmd\":\"python3 task.py\"} or "
```

(This replaces the existing `"write_and_run"` line at its current position — same line, just now preceded by the two new entries. `mode` is required whenever it's known; omit it only when the mode truly hasn't been established yet, in which case you must ask the user before calling `start_mission` — never guess auto vs. approval.)

Also add one sentence to the surrounding instructions, right after the line ending `...Use write_and_run when code must be created then executed. Use run_visible_terminal when the user wants to see a terminal. ` (line 119):

```python
                "For requests that call for a real, independent, multi-part effort (e.g. \"fix X and audit Y and write docs for Z\"), use start_mission instead of doing it yourself — it dispatches real parallel Claude/Codex CLI workers through Termina, each in an isolated git worktree. Never call start_mission without a mode of \"auto\" or \"approval\" (or \"plan\" for read-only investigation) — if the user hasn't said which, ask them first. "
```

- [ ] **Step 3: Add the mission methods**

After `_discord_bridge` (ends at line 651, right before `_run_acceptance` at line 653), insert:

```python
    def _quiet_llm_call(self, prompt):
        # Same one-shot completion call as _post_chat, but deliberately does
        # NOT append to self.messages — used for internal classification
        # calls (workspace inference) that shouldn't pollute the visible
        # conversation history.
        url = self.endpoint.get().rstrip("/") + "/chat/completions"
        body = {"model": self.model.get(), "messages": [{"role": "user", "content": prompt}], "stream": False, "temperature": 0.1, "max_tokens": 200}
        req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=60) as r:
            result = json.loads(r.read().decode("utf-8", errors="replace"))
        return result["choices"][0]["message"]["content"]

    def _infer_workspace_root(self, objective, hint=None):
        try:
            repos = termina_bridge.list_repos(TERMINA_URL, TERMINA_TOKEN)
        except Exception:
            repos = []
        if not repos:
            return None
        listing = "\n".join(f"- {r['name']}: {r['path']}" for r in repos)
        prompt = (
            "Given this objective and a list of known project folders, reply with ONLY the exact path of the "
            "single best-matching folder, or the literal word NONE if nothing clearly matches (do not guess).\n\n"
            f"Objective: {objective}\n"
            f"Hint (may be empty): {hint or ''}\n\n"
            f"Known folders:\n{listing}\n\n"
            "Reply with just the path or NONE, nothing else."
        )
        try:
            answer = self._quiet_llm_call(prompt).strip().strip('"')
        except Exception:
            return None
        if answer == "NONE":
            return None
        for r in repos:
            if os.path.normcase(os.path.normpath(answer)) == os.path.normcase(os.path.normpath(r["path"])):
                return r["path"]
        return None

    def _start_mission(self, objective, mode, workspace_hint=None):
        if mode not in ("auto", "approval", "plan"):
            return {"ok": False, "needsMode": True, "error": "Mode must be one of auto, approval, plan — which one?"}
        try:
            termina_bridge.ensure_running(TERMINA_URL, TERMINA_LAUNCH_DIR)
        except termina_bridge.TerminaError as e:
            return {"ok": False, "error": f"Couldn't reach or start Termina: {e}"}

        workspace_root = self._infer_workspace_root(objective, workspace_hint)
        if not workspace_root:
            return {"ok": False, "needsWorkspace": True, "error": "Couldn't confidently match a known project folder to this objective — which project is this for?"}

        try:
            decomposed = termina_bridge.decompose(TERMINA_URL, TERMINA_TOKEN, objective, workspace_root)
            mission = termina_bridge.create_mission(
                TERMINA_URL, TERMINA_TOKEN, decomposed["missionName"], objective, workspace_root, mode, decomposed["roles"],
            )
        except termina_bridge.TerminaError as e:
            return {"ok": False, "error": f"Termina rejected the mission: {e}"}

        return {"ok": True, "missionId": mission["id"], "missionName": mission["name"], "workerCount": len(mission["workers"]), "workspaceRoot": workspace_root, "mode": mode}

    def _get_mission_status(self, mission_id):
        try:
            result = termina_bridge.get_mission(TERMINA_URL, TERMINA_TOKEN, mission_id)
        except termina_bridge.TerminaError as e:
            return {"ok": False, "error": str(e)}
        mission = result["mission"]
        ledger = result["ledger"]
        workers = [{"name": w.get("name"), "status": w.get("status")} for w in mission.get("workers", [])]
        return {"ok": True, "missionId": mission["id"], "status": mission.get("status"), "workers": workers, "done": termina_bridge.is_mission_done(mission, ledger)}

```

- [ ] **Step 4: Wire the two tools into `_execute_tool_plan`**

In `_execute_tool_plan` (around line 862-863, right before `if action == "run_command":`), add:

```python
        if action == "start_mission":
            return self._start_mission(tool.get("objective", ""), tool.get("mode", ""), tool.get("workspaceHint"))
        if action == "get_mission_status":
            return self._get_mission_status(tool.get("missionId", ""))
```

- [ ] **Step 5: Manual smoke test**

With Termina running (`cd C:\Users\jorda\Termina && npm run app`) and `TERMINA_TOKEN` set to the same value in both terminals' environment, launch PhantomBot and send a message that should trigger `start_mission` via the LLM tool path (e.g. "start a mission in approval mode to add a README to the Termina project"). Confirm in Termina's own "Missions" panel that a new mission with workers actually appears.

- [ ] **Step 6: Commit**

```bash
cd C:\Users\jorda\Documents\VM-Share\Phantombot-Unleashed
git add phantombot_unleashed.py
git commit -m "Wire start_mission/get_mission_status tools into the main tool loop"
```

---

### Task 5: PhantomBot — `/mission`, `/termina`, and `/mission set-default` direct triggers

**Files:**
- Modify: `C:\Users\jorda\Documents\VM-Share\Phantombot-Unleashed\phantombot_unleashed.py`

**Interfaces:**
- Consumes: `RedFinApp._start_mission` (Task 4), `mission_config.{get_default_mode, set_default_mode}` (Task 3).
- Produces: nothing new consumed by later tasks — this is a leaf feature.

- [ ] **Step 1: Add slash-command parsing to `_direct_execution_from_prompt`**

In `_direct_execution_from_prompt` (around line 927-930, right before the existing `for prefix in ["/run ", ...]:` block), add:

```python
        for cmd_prefix in ["/mission ", "/termina "]:
            if low.startswith(cmd_prefix):
                rest = p[len(cmd_prefix):].strip()
                if rest.lower().startswith("set-default"):
                    parts = rest.split(None, 1)
                    new_default = parts[1].strip().lower() if len(parts) > 1 else ""
                    if new_default not in mission_config.VALID_DEFAULTS:
                        return {"ok": False, "error": "Usage: /mission set-default auto|approval|ask"}
                    mission_config.set_default_mode(MISSION_CONFIG_PATH, new_default)
                    return {"ok": True, "defaultModeSet": new_default}

                words = rest.split(None, 1)
                first_word = words[0].lower() if words else ""
                if first_word in ("auto", "approval", "plan"):
                    mode = first_word
                    objective = words[1] if len(words) > 1 else ""
                else:
                    stored_default = mission_config.get_default_mode(MISSION_CONFIG_PATH)
                    if stored_default == "ask":
                        return {"ok": False, "needsMode": True, "error": "Which mode — auto, approval, or plan?"}
                    mode = stored_default
                    objective = rest
                if not objective:
                    return {"ok": False, "error": "Give me an objective, e.g. /mission auto fix the leaderboard bug"}
                return self._start_mission(objective, mode)
```

- [ ] **Step 2: Manual smoke test**

With Termina running and `TERMINA_TOKEN` set, launch PhantomBot and type:
```
/mission set-default approval
```
Confirm the reply confirms the default was set. Then type:
```
/mission fix a small typo in the README
```
(no mode word this time) — confirm it uses the stored `approval` default rather than asking. Then type:
```
/termina auto add a CONTRIBUTING.md file
```
— confirm the explicit `auto` overrides the stored default and a mission starts.

- [ ] **Step 3: Commit**

```bash
cd C:\Users\jorda\Documents\VM-Share\Phantombot-Unleashed
git add phantombot_unleashed.py
git commit -m "Add /mission and /termina direct-trigger slash commands"
```

---

### Task 6: PhantomBot — background status poller, chat relay, and outbound Discord notification

**Files:**
- Modify: `C:\Users\jorda\Documents\VM-Share\Phantombot-Unleashed\phantombot_unleashed.py`

**Interfaces:**
- Consumes: `RedFinApp._get_mission_status` (Task 4), `termina_bridge.{is_mission_done, synthesize}` (Task 2), `self._discord_bridge` (existing, line 642) for the outbound notification.
- Produces: nothing consumed elsewhere — terminal task.

- [ ] **Step 1: Add the poller method**

After `_get_mission_status` (end of the block added in Task 4, Step 3), add:

```python
    def _poll_mission_until_done(self, mission_id, mission_name):
        last_statuses = {}
        while True:
            time.sleep(7)
            result = self._get_mission_status(mission_id)
            if not result.get("ok"):
                self.q.put(("assistant", f"Lost track of mission {mission_name} ({mission_id}): {result.get('error')}"))
                return
            changed = []
            for w in result["workers"]:
                key = w["name"]
                if last_statuses.get(key) != w["status"]:
                    changed.append(f"{w['name']}: {w['status']}")
                    last_statuses[key] = w["status"]
            if changed:
                self.q.put(("assistant", f"[{mission_name}] " + ", ".join(changed)))
            if result.get("done"):
                self._finish_mission(mission_id, mission_name)
                return

    def _finish_mission(self, mission_id, mission_name):
        try:
            report = termina_bridge.synthesize(TERMINA_URL, TERMINA_TOKEN, mission_id)
        except termina_bridge.TerminaError as e:
            self.q.put(("assistant", f"[{mission_name}] All workers finished, but the final report failed: {e}"))
            return
        markdown = report["markdown"]
        self.q.put(("assistant", f"[{mission_name}] Mission complete. Final report:\n\n{markdown}"))
        self._notify_discord_mission_complete(mission_name, markdown)

    def _notify_discord_mission_complete(self, mission_name, markdown):
        # Stage-then-send, same approval-gated pipeline every other Discord
        # send in this app already uses (see _stage_discord/_discord_bridge)
        # — a finished mission's report is exactly the kind of external-facing
        # content that pipeline exists to gate, so this does not bypass it.
        summary = markdown if len(markdown) <= 1800 else markdown[:1800] + "\n\n…(truncated, see local report)"
        stage_args = ["stage", "--kind", "upload", "--message", f"Mission complete: {mission_name}\n\n{summary}"]
        self._discord_bridge(stage_args)
```

- [ ] **Step 2: Kick off the poller whenever a mission successfully starts**

`_start_mission` (Task 4) is called from two places: the LLM tool path (`_execute_tool_plan`) and the slash-command path (`_direct_execution_from_prompt`). Both already run on a background thread (`_send_worker`, started from `send()` at line 982). Modify `_start_mission`'s success path — find the final `return` in `_start_mission`:

```python
        return {"ok": True, "missionId": mission["id"], "missionName": mission["name"], "workerCount": len(mission["workers"]), "workspaceRoot": workspace_root, "mode": mode}
```

Replace with:

```python
        threading.Thread(target=self._poll_mission_until_done, args=(mission["id"], mission["name"]), daemon=True).start()
        return {"ok": True, "missionId": mission["id"], "missionName": mission["name"], "workerCount": len(mission["workers"]), "workspaceRoot": workspace_root, "mode": mode}
```

- [ ] **Step 3: Manual smoke test**

With Termina running, `TERMINA_TOKEN` set, and (if you want to verify the Discord leg) `PHANTOMBOT_DISCORD_WEBHOOK_URL` set per the existing bridge's requirements, start a small mission via `/mission approval add a one-line comment to the README explaining what this project is`. Watch PhantomBot's chat window for status-transition messages as workers run, and confirm a final "Mission complete" message with the report appears once all workers finish. Check `Phantombot-Unleashed/output/discord-staging/` for the staged manifest — per the existing safety pipeline, this stages the notification but does **not** send it to Discord until a human runs the existing approval step (`phantombot-discord-bridge.py send-approved`), which this plan intentionally leaves untouched.

- [ ] **Step 4: Commit**

```bash
cd C:\Users\jorda\Documents\VM-Share\Phantombot-Unleashed
git add phantombot_unleashed.py
git commit -m "Add mission status polling, chat relay, and staged Discord completion notice"
```

---

## Follow-up (explicitly out of scope for this plan)

**Triggering a mission by texting PhantomBot on Discord from your phone is not yet possible after this plan.** `phantombot-discord-bridge.py` today is outbound-only: `stage` writes a manifest, and a human must separately run `send_approved` to actually post it via webhook. There is no inbound message listener — nothing is watching a Discord channel for you to type into. Building that (a persistent bot connection via a library like `discord.py`, a bot token instead of just a webhook URL, message-received handling that calls into the same `_start_mission`/`_direct_execution_from_prompt` path this plan builds) is a separate, larger project and should get its own brainstorming/design/plan cycle rather than being folded in here under time pressure.

What this plan *does* deliver: the full local-desktop round trip (`/mission`, `/termina`, or plain language → real parallel Termina workers → live status in PhantomBot's own chat → final report), plus outbound Discord notifications on completion through the existing staged-approval pipeline (respecting the safety boundary that pipeline was built for, not bypassing it).
