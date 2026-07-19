#!/usr/bin/env python3
"""PhantomBot acceptance runner.

Runs a local proof pass for the upgraded PhantomBot package. On Kali it can
start the private Xvfb, tmux, and loopback host bridge lanes, capture a
screenshot, create a proof image, stage a Discord manifest, and audit network
state. On Windows it verifies parity pieces that apply there.

No public ports, Tailscale Funnel/Serve, Discord sends, or Docker publish
commands are performed.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import signal
from pathlib import Path


IS_WINDOWS = sys.platform.startswith("win")
APP_DIR = Path(__file__).resolve().parent
DEFAULT_OUTPUT = Path.home() / ("Phantombot-Unleashed/output" if IS_WINDOWS else ".redfin/output")
OUTPUT_DIR = Path(os.environ.get("PHANTOMBOT_OUTPUT_DIR", str(DEFAULT_OUTPUT))).expanduser().resolve()
WORKSPACE_DIR = Path(os.environ.get("PHANTOMBOT_WORKSPACE_DIR", str(Path.home() / "Phantombot-Workspace"))).expanduser().resolve()
BRIDGE_HOST = os.environ.get("PHANTOMBOT_BRIDGE_HOST", "127.0.0.1")
BRIDGE_PORT = int(os.environ.get("PHANTOMBOT_BRIDGE_PORT", "8765"))
TOKEN_FILE = Path(os.environ.get("PHANTOMBOT_BRIDGE_TOKEN_FILE", str(OUTPUT_DIR / "phantombot-bridge-token.txt"))).expanduser().resolve()


def run(args: list[str], *, timeout: int = 60, shell: bool = False) -> dict:
    started = time.time()
    try:
        proc = subprocess.run(args if not shell else " ".join(args), text=True, capture_output=True, timeout=timeout, cwd=str(APP_DIR), shell=shell)
        return {
            "ok": proc.returncode == 0,
            "code": proc.returncode,
            "cmd": args,
            "seconds": round(time.time() - started, 2),
            "stdout": proc.stdout[-12000:],
            "stderr": proc.stderr[-12000:],
        }
    except Exception as exc:
        return {"ok": False, "cmd": args, "seconds": round(time.time() - started, 2), "error": str(exc)}


def http_json(url: str, token: str | None = None, payload: dict | None = None, timeout: int = 4) -> dict:
    data = None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    method = "GET"
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        method = "POST"
    try:
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        with urllib.request.urlopen(req, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
        return {"ok": True, "status": response.status, "json": json.loads(body)}
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(body)
        except Exception:
            parsed = {"body": body}
        return {"ok": False, "status": exc.code, "json": parsed}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def command_presence(names: list[str]) -> dict:
    return {name: {"present": bool(shutil.which(name)), "path": shutil.which(name) or ""} for name in names}


def start_xvfb() -> dict:
    if IS_WINDOWS:
        return {"ok": True, "skipped": True, "reason": "Windows uses the real desktop session."}
    if not shutil.which("Xvfb"):
        return {"ok": False, "error": "Xvfb missing."}
    display = os.environ.get("PHANTOMBOT_DISPLAY", ":1")
    probe = run(["bash", "-lc", f"pgrep -af 'Xvfb {display}'"], timeout=10)
    if not probe["ok"]:
        subprocess.Popen(["Xvfb", display, "-screen", "0", "1280x800x24", "-nolisten", "tcp"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        time.sleep(1)
    os.environ["DISPLAY"] = display
    return {"ok": True, "display": display, "tcpListening": False}


def start_tmux() -> dict:
    if IS_WINDOWS:
        return {"ok": True, "skipped": True, "reason": "tmux is Kali/Linux only."}
    if not shutil.which("tmux"):
        return {"ok": False, "error": "tmux missing."}
    return run(["bash", str(APP_DIR / "phantombot-control.sh"), "tmux-start"], timeout=20)


def start_bridge() -> dict:
    health = http_json(f"http://{BRIDGE_HOST}:{BRIDGE_PORT}/health", timeout=2)
    if health.get("ok"):
        return {"ok": True, "alreadyRunning": True, "startedByAcceptance": False, "health": health}
    out = OUTPUT_DIR / "phantombot-acceptance-bridge.out.log"
    err = OUTPUT_DIR / "phantombot-acceptance-bridge.err.log"
    proc = subprocess.Popen(
        [sys.executable, str(APP_DIR / "phantombot-host-bridge.py"), "--host", BRIDGE_HOST, "--port", str(BRIDGE_PORT)],
        cwd=str(APP_DIR),
        stdout=out.open("w", encoding="utf-8"),
        stderr=err.open("w", encoding="utf-8"),
        start_new_session=not IS_WINDOWS,
    )
    (OUTPUT_DIR / "phantombot-acceptance-bridge.pid").write_text(str(proc.pid), encoding="utf-8")
    for _ in range(20):
        time.sleep(0.25)
        health = http_json(f"http://{BRIDGE_HOST}:{BRIDGE_PORT}/health", timeout=2)
        if health.get("ok"):
            return {"ok": True, "pid": proc.pid, "startedByAcceptance": True, "health": health, "stdout": str(out), "stderr": str(err)}
    return {"ok": False, "pid": proc.pid, "startedByAcceptance": True, "error": "Bridge did not answer health in time.", "stdout": str(out), "stderr": str(err)}


def listener_pids(port: int) -> list[int]:
    if IS_WINDOWS:
        proc = subprocess.run(["netstat", "-ano", "-p", "tcp"], text=True, capture_output=True, timeout=10)
        pids: set[int] = set()
        for line in proc.stdout.splitlines():
            parts = line.split()
            if len(parts) >= 5 and parts[0].upper() == "TCP" and parts[1].endswith(f":{port}") and parts[3].upper() == "LISTENING":
                try:
                    pids.add(int(parts[4]))
                except Exception:
                    pass
        return sorted(pids)
    proc = subprocess.run(["bash", "-lc", f"ss -ltnp 2>/dev/null | awk '/:{port} / {{print $0}}'"], text=True, capture_output=True, timeout=10)
    pids: set[int] = set()
    for item in proc.stdout.replace(",", " ").split():
        if item.startswith("pid="):
            try:
                pids.add(int(item.split("=", 1)[1]))
            except Exception:
                pass
    return sorted(pids)


def stop_bridge(start_info: dict) -> dict:
    if not start_info.get("startedByAcceptance"):
        return {"ok": True, "skipped": True, "reason": "Bridge was already running before acceptance."}
    targets = set(listener_pids(BRIDGE_PORT))
    if start_info.get("pid"):
        try:
            targets.add(int(start_info["pid"]))
        except Exception:
            pass
    errors = []
    for pid in sorted(targets):
        try:
            if IS_WINDOWS:
                subprocess.run(["powershell", "-NoProfile", "-Command", f"Stop-Process -Id {pid} -Force"], capture_output=True, text=True, timeout=10)
            else:
                os.kill(pid, signal.SIGTERM)
        except Exception as exc:
            errors.append({"pid": pid, "error": str(exc)})
    for _ in range(20):
        if not listener_pids(BRIDGE_PORT):
            return {"ok": True, "stoppedPids": sorted(targets), "errors": errors}
        time.sleep(0.25)
    return {"ok": False, "stoppedPids": sorted(targets), "remainingPids": listener_pids(BRIDGE_PORT), "errors": errors}


def read_token() -> str:
    if TOKEN_FILE.exists():
        return TOKEN_FILE.read_text(encoding="utf-8").strip()
    return ""


def client_json(*client_args: str, timeout: int = 30) -> dict:
    result = run([sys.executable, str(APP_DIR / "phantombot-bridge-client.py"), "--json", *client_args], timeout=timeout)
    try:
        result["json"] = json.loads(result.get("stdout", "") or "{}")
    except Exception as exc:
        result["jsonParseError"] = str(exc)
    return result


def run_json(args: list[str], *, timeout: int = 60) -> dict:
    result = run(args, timeout=timeout)
    try:
        result["json"] = json.loads(result.get("stdout", "") or "{}")
    except Exception as exc:
        result["jsonParseError"] = str(exc)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Run PhantomBot package acceptance proof.")
    parser.add_argument("--keep-bridge", action="store_true", help="Leave the private host bridge running after the check.")
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    WORKSPACE_DIR.mkdir(parents=True, exist_ok=True)

    report: dict = {
        "ok": False,
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "platform": platform.platform(),
        "appDir": str(APP_DIR),
        "workspaceDir": str(WORKSPACE_DIR),
        "outputDir": str(OUTPUT_DIR),
        "privacy": {
            "publicPortsOpened": False,
            "tailscaleFunnelStarted": False,
            "discordSendPerformed": False,
            "dockerPublishPerformed": False,
            "bridgeLoopbackOnly": BRIDGE_HOST in {"127.0.0.1", "localhost", "::1"},
        },
        "commands": command_presence(["python3", "python", "Xvfb", "xdotool", "tmux", "jq", "xterm", "docker", "tailscale", "mullvad", "curl"]),
        "checks": {},
    }

    py_files = ["phantombot_unleashed.py", "phantombot-verify.py", "phantombot-host-bridge.py", "phantombot-bridge-client.py", "phantombot-state-manager.py", "phantombot-media-tools.py", "phantombot-discord-voice.py", "phantombot-discord-bridge.py", "phantombot-acceptance.py"]
    report["checks"]["compile"] = run([sys.executable, "-m", "py_compile", *[str(APP_DIR / name) for name in py_files]], timeout=60)
    report["checks"]["verify"] = run([sys.executable, str(APP_DIR / "phantombot-verify.py"), "--json"], timeout=60)
    report["checks"]["xvfb"] = start_xvfb()
    report["checks"]["tmux"] = start_tmux()
    report["checks"]["bridgeStart"] = start_bridge()

    token = read_token()
    report["checks"]["bridgeTokenPresent"] = {"ok": bool(token), "tokenFile": str(TOKEN_FILE)}
    report["checks"]["bridgeStatus"] = http_json(f"http://{BRIDGE_HOST}:{BRIDGE_PORT}/status", token=token) if token else {"ok": False, "error": "No token."}
    report["checks"]["bridgeSafeRun"] = http_json(f"http://{BRIDGE_HOST}:{BRIDGE_PORT}/run", token=token, payload={"cmd": "echo phantom acceptance ok"}) if token else {"ok": False, "error": "No token."}
    report["checks"]["bridgeProtectedRun"] = http_json(f"http://{BRIDGE_HOST}:{BRIDGE_PORT}/run", token=token, payload={"cmd": "tailscale funnel 80"}) if token else {"ok": False, "error": "No token."}

    if token:
        report["checks"]["bridgeScreenshot"] = http_json(f"http://{BRIDGE_HOST}:{BRIDGE_PORT}/screenshot", token=token, payload={"name": "redfin_screen_capture.png"}, timeout=15)
    else:
        report["checks"]["bridgeScreenshot"] = {"ok": False, "error": "No token."}

    report["checks"]["bridgeClientHealth"] = client_json("health", timeout=15)
    report["checks"]["bridgeClientStatus"] = client_json("status", timeout=15)
    report["checks"]["bridgeClientSafeRun"] = client_json("run", "--cmd", "echo phantom bridge client ok", timeout=30)
    report["checks"]["bridgeClientProtectedRun"] = client_json("run", "--cmd", "tailscale funnel 80", timeout=30)
    report["checks"]["bridgeClientScreenshot"] = client_json("screenshot", "--name", "redfin_client_screen_capture.png", timeout=30)
    report["checks"]["bridgeClientOutput"] = client_json("output", timeout=15)
    if not IS_WINDOWS:
        report["checks"]["bridgeClientTmuxStart"] = client_json("tmux-start", timeout=30)
        report["checks"]["bridgeClientTmuxSend"] = client_json("tmux-send", "--cmd", "echo phantom tmux client ok", timeout=30)
        report["checks"]["bridgeClientTmuxCapture"] = client_json("tmux-capture", "--lines", "40", timeout=30)
    else:
        report["checks"]["bridgeClientTmuxStart"] = {"ok": True, "skipped": True, "reason": "Kali/Linux-only tmux client check skipped on Windows."}
        report["checks"]["bridgeClientTmuxSend"] = {"ok": True, "skipped": True, "reason": "Kali/Linux-only tmux client check skipped on Windows."}
        report["checks"]["bridgeClientTmuxCapture"] = {"ok": True, "skipped": True, "reason": "Kali/Linux-only tmux client check skipped on Windows."}

    card = run([sys.executable, str(APP_DIR / "phantombot-media-tools.py"), "card", "--title", "PhantomBot acceptance", "--subtitle", "Private output verified", "--name", "phantombot-acceptance-card.png"], timeout=60)
    report["checks"]["mediaCard"] = card
    report["checks"]["mediaGraphicPng"] = run([sys.executable, str(APP_DIR / "phantombot-media-tools.py"), "graphic", "--title", "PhantomBot generated PNG", "--prompt", "Local Python graphics generated into the private output folder.", "--format", "png", "--name", "phantombot-generated-graphic.png"], timeout=60)
    report["checks"]["mediaGraphicJpg"] = run([sys.executable, str(APP_DIR / "phantombot-media-tools.py"), "graphic", "--title", "PhantomBot generated JPG", "--prompt", "JPG export proof for approved Discord/media workflows.", "--format", "jpg", "--name", "phantombot-generated-graphic.jpg"], timeout=60)
    report["checks"]["mediaVideoMp4"] = run([sys.executable, str(APP_DIR / "phantombot-media-tools.py"), "video", "--title", "PhantomBot generated MP4", "--subtitle", "Local video output ready for approval-gated sharing", "--name", "phantombot-generated-video.mp4", "--seconds", "2", "--fps", "10"], timeout=120)
    report["checks"]["discordStage"] = run([sys.executable, str(APP_DIR / "phantombot-media-tools.py"), "stage-discord", "--message", "PhantomBot acceptance staged for approval", str(OUTPUT_DIR / "phantombot-acceptance-card.png")], timeout=60)
    report["checks"]["discordVoiceStatus"] = run([sys.executable, str(APP_DIR / "phantombot-discord-voice.py"), "status"], timeout=60)
    report["checks"]["discordBridgeStatus"] = run_json([sys.executable, str(APP_DIR / "phantombot-discord-bridge.py"), "status"], timeout=60)
    report["checks"]["discordBridgeStage"] = run_json([sys.executable, str(APP_DIR / "phantombot-discord-bridge.py"), "stage", "--kind", "upload", "--message", "PhantomBot acceptance staged for approved Discord send", str(OUTPUT_DIR / "phantombot-acceptance-card.png")], timeout=60)
    report["checks"]["discordBridgeVoiceStage"] = run_json([sys.executable, str(APP_DIR / "phantombot-discord-bridge.py"), "voice-stage", "--mode", "both", "--message", "PhantomBot acceptance voice bridge request"], timeout=60)
    discord_manifest = report["checks"]["discordBridgeStage"].get("json", {}).get("manifestPath", str(OUTPUT_DIR / "missing-discord-stage.json"))
    report["checks"]["discordBridgeSendBlocked"] = run_json([sys.executable, str(APP_DIR / "phantombot-discord-bridge.py"), "send-approved", "--manifest", discord_manifest], timeout=60)
    report["checks"]["discordBridgeReadBlocked"] = run_json([sys.executable, str(APP_DIR / "phantombot-discord-bridge.py"), "read-approved"], timeout=60)
    if not IS_WINDOWS and (APP_DIR / "phantombot-network-audit.sh").exists():
        report["checks"]["networkAudit"] = run(["bash", str(APP_DIR / "phantombot-network-audit.sh")], timeout=90)
    else:
        report["checks"]["networkAudit"] = {"ok": True, "skipped": True, "reason": "Kali/Linux-only audit skipped on Windows."}
    if (APP_DIR / "phantombot-state-manager.py").exists():
        report["checks"]["stateManager"] = run([sys.executable, str(APP_DIR / "phantombot-state-manager.py"), "--json", "--write-templates"], timeout=120)
    else:
        report["checks"]["stateManager"] = {"ok": False, "error": "State manager is missing."}

    if not args.keep_bridge:
        report["checks"]["bridgeStop"] = stop_bridge(report["checks"]["bridgeStart"])

    protected = report["checks"]["bridgeProtectedRun"]
    protected_ok = bool(protected.get("json", {}).get("approvalRequired")) if isinstance(protected, dict) else False
    client_protected = report["checks"]["bridgeClientProtectedRun"].get("json", {})
    client_protected_ok = bool(client_protected.get("approvalRequired") or client_protected.get("result", {}).get("approvalRequired"))
    discord_send_blocked = bool(report["checks"]["discordBridgeSendBlocked"].get("json", {}).get("approvalRequired"))
    discord_read_blocked = bool(report["checks"]["discordBridgeReadBlocked"].get("json", {}).get("approvalRequired"))
    required = [
        report["checks"]["compile"].get("ok"),
        report["checks"]["verify"].get("ok"),
        report["checks"]["bridgeStart"].get("ok"),
        report["checks"]["bridgeTokenPresent"].get("ok"),
        report["checks"]["bridgeStatus"].get("ok"),
        report["checks"]["bridgeSafeRun"].get("ok"),
        protected_ok,
        report["checks"]["bridgeScreenshot"].get("ok"),
        report["checks"]["bridgeClientHealth"].get("ok"),
        report["checks"]["bridgeClientStatus"].get("ok"),
        report["checks"]["bridgeClientSafeRun"].get("ok"),
        client_protected_ok,
        report["checks"]["bridgeClientScreenshot"].get("ok"),
        report["checks"]["bridgeClientOutput"].get("ok"),
        report["checks"]["bridgeClientTmuxStart"].get("ok"),
        report["checks"]["bridgeClientTmuxSend"].get("ok"),
        report["checks"]["bridgeClientTmuxCapture"].get("ok"),
        report["checks"]["mediaCard"].get("ok"),
        report["checks"]["mediaGraphicPng"].get("ok"),
        report["checks"]["mediaGraphicJpg"].get("ok"),
        report["checks"]["mediaVideoMp4"].get("ok"),
        report["checks"]["discordStage"].get("ok"),
        report["checks"]["discordVoiceStatus"].get("ok"),
        report["checks"]["discordBridgeStatus"].get("ok"),
        report["checks"]["discordBridgeStage"].get("ok"),
        report["checks"]["discordBridgeVoiceStage"].get("ok"),
        discord_send_blocked,
        discord_read_blocked,
        report["checks"]["networkAudit"].get("ok"),
        report["checks"]["stateManager"].get("ok"),
        report["privacy"]["bridgeLoopbackOnly"],
    ]
    if not args.keep_bridge:
        required.append(report["checks"]["bridgeStop"].get("ok"))
    if not IS_WINDOWS:
        required.extend([
            report["checks"]["xvfb"].get("ok"),
            report["checks"]["tmux"].get("ok"),
        ])
    report["ok"] = all(bool(item) for item in required)

    proof = OUTPUT_DIR / "phantombot-acceptance.json"
    proof.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"ok": report["ok"], "proofPath": str(proof), "outputDir": str(OUTPUT_DIR)}, indent=2))
    return 0 if report["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
