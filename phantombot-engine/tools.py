import fnmatch
import json
import os
import platform
import re
import shlex
import shutil
import subprocess
import sys
import time

try:
    from PIL import Image, ImageDraw, ImageFont
except Exception:
    Image = None
    ImageDraw = None
    ImageFont = None

HOME_DIR = os.path.abspath(os.path.expanduser("~"))
WORKSPACE_DIR = os.path.abspath(os.path.expanduser(os.environ.get("PHANTOMBOT_WORKSPACE_DIR", "~/Phantombot-Workspace")))
_DEFAULT_OUTPUT = "~/Phantombot-Unleashed/output" if sys.platform.startswith("win") else "~/.redfin/output"
OUTPUT_DIR = os.path.abspath(os.path.expanduser(os.environ.get("PHANTOMBOT_OUTPUT_DIR", _DEFAULT_OUTPUT)))
TMUX_SOCKET = os.environ.get("PHANTOMBOT_TMUX_SOCKET", "redfin").strip() or "redfin"
TMUX_SESSION = os.environ.get("PHANTOMBOT_TMUX_SESSION", "phantombot").strip() or "phantombot"
SAFE_KEY_RE = re.compile(r"^[A-Za-z0-9_+:@.,/-]{1,80}$")

os.makedirs(WORKSPACE_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)


def safe_pc_path(path=""):
    raw = (path or "").strip()
    target = os.path.abspath(os.path.expanduser(raw)) if raw else HOME_DIR
    if not os.path.isabs(raw):
        target = os.path.abspath(os.path.join(HOME_DIR, raw))
    allowed_roots = [HOME_DIR, os.path.abspath(WORKSPACE_DIR), os.path.abspath(OUTPUT_DIR)]
    if not any(target.lower().startswith(root.lower()) for root in allowed_roots):
        raise ValueError("Path outside allowed user/workspace/output area needs operator approval.")
    return target


def safe_output_path(name="redfin_screen_capture.png"):
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    raw = os.path.basename(str(name or "redfin_screen_capture.png").replace("\\", "/"))
    safe = "".join(c for c in raw if c.isalnum() or c in " .-_")[:96].strip(". ") or "redfin_screen_capture.png"
    if "." not in safe:
        safe += ".png"
    path = os.path.abspath(os.path.join(OUTPUT_DIR, safe))
    if not path.lower().startswith(os.path.abspath(OUTPUT_DIR).lower()):
        raise ValueError("Invalid output path.")
    return path


def list_dir(path=".", limit=80):
    target = safe_pc_path(path)
    if not os.path.exists(target):
        return {"ok": False, "error": "Path does not exist.", "path": target}
    if os.path.isfile(target):
        return {"ok": True, "path": target, "type": "file", "bytes": os.path.getsize(target)}
    rows = []
    for name in sorted(os.listdir(target), key=lambda n: (not os.path.isdir(os.path.join(target, n)), n.lower()))[:int(limit or 80)]:
        p = os.path.join(target, name)
        rows.append({"name": name, "type": "dir" if os.path.isdir(p) else "file", "bytes": None if os.path.isdir(p) else os.path.getsize(p)})
    return {"ok": True, "path": target, "items": rows}


def read_file(path, max_bytes=30000, offset=0):
    """offset/line-range support: offset is a byte offset into the file (new vs. today's all-or-nothing read)."""
    target = safe_pc_path(path)
    if not os.path.isfile(target):
        return {"ok": False, "error": "Not a file.", "path": target}
    with open(target, "rb") as f:
        f.seek(max(0, int(offset or 0)))
        data = f.read(int(max_bytes or 30000))
    return {"ok": True, "path": target, "bytesRead": len(data), "offset": int(offset or 0), "content": data.decode("utf-8", errors="replace")}


def write_pc_file(path, content):
    target = safe_pc_path(path)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "w", encoding="utf-8") as f:
        f.write(content)
    return {"ok": True, "path": target, "bytes": len(content.encode("utf-8"))}


def write_file(name, content):
    base = WORKSPACE_DIR
    os.makedirs(base, exist_ok=True)
    safe = "".join(c for c in name if c.isalnum() or c in " .-_\\/")[:160].replace("\\", "/").lstrip("/") or "note.md"
    path = os.path.abspath(os.path.join(base, safe))
    if not path.startswith(os.path.abspath(base)):
        return {"ok": False, "error": "Invalid file path."}
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    return {"ok": True, "path": path, "bytes": len(content.encode("utf-8"))}


def system_status():
    commands = {}
    for name in ["python3", "python", "Xvfb", "xvfb-run", "xdotool", "tmux", "jq", "xterm", "x-terminal-emulator", "xdg-open", "docker", "tailscale", "mullvad", "ffmpeg"]:
        commands[name] = bool(shutil.which(name))
    return {
        "ok": True,
        "platform": platform.platform(),
        "python": sys.version.split()[0],
        "workspaceDir": WORKSPACE_DIR,
        "outputDir": OUTPUT_DIR,
        "display": os.environ.get("DISPLAY", ""),
        "tmuxSocket": TMUX_SOCKET,
        "tmuxSession": TMUX_SESSION,
        "commands": commands,
        "privacy": {
            "publicInboundShell": False,
            "publicTunnelsRequireApproval": True,
            "discordSendsRequireApproval": True,
            "xvfbUsesNoListenTcp": True,
        },
    }


def capture_screenshot(name="redfin_screen_capture.png"):
    path = safe_output_path(name)
    try:
        from PIL import ImageGrab
        img = ImageGrab.grab()
        img.save(path)
        return {"ok": True, "path": path, "bytes": os.path.getsize(path), "method": "PIL.ImageGrab", "display": os.environ.get("DISPLAY", "")}
    except Exception as pil_error:
        fallback_error = str(pil_error)
    if not sys.platform.startswith("win"):
        for binary, args in [("gnome-screenshot", ["gnome-screenshot", "-f", path]), ("scrot", ["scrot", path]), ("import", ["import", "-window", "root", path])]:
            if shutil.which(binary):
                try:
                    p = subprocess.run(args, text=True, capture_output=True, timeout=25)
                    if p.returncode == 0 and os.path.exists(path):
                        return {"ok": True, "path": path, "bytes": os.path.getsize(path), "method": binary, "display": os.environ.get("DISPLAY", "")}
                except Exception as e:
                    fallback_error = str(e)
    return {"ok": False, "error": "Screenshot failed. Start Xvfb or a real desktop display first.", "detail": fallback_error, "path": path}


def start_xvfb(display=":1", screen="1280x800x24"):
    if sys.platform.startswith("win"):
        return {"ok": False, "error": "Xvfb is Linux/Kali only. Windows uses the real desktop session."}
    display = str(display or ":1").strip()
    if not re.match(r"^:[0-9]{1,2}$", display):
        return {"ok": False, "error": "Invalid DISPLAY. Use a value like :1."}
    if not shutil.which("Xvfb"):
        return {"ok": False, "error": "Xvfb is not installed. Run the Kali tool installer first."}
    check = subprocess.run(["bash", "-lc", f"pgrep -af 'Xvfb {shlex.quote(display)}'"], text=True, capture_output=True, timeout=8)
    if check.returncode != 0:
        subprocess.Popen(["Xvfb", display, "-screen", "0", screen, "-nolisten", "tcp"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        time.sleep(0.8)
    os.environ["DISPLAY"] = display
    return {"ok": True, "display": display, "screen": screen, "tcpListening": False, "note": "Xvfb started with -nolisten tcp for privacy."}


def _tmux_args(*extra):
    return ["tmux", "-L", TMUX_SOCKET, *extra]


def tmux_start():
    if sys.platform.startswith("win"):
        return {"ok": False, "error": "tmux is Linux/Kali only. Use run_visible_terminal on Windows."}
    if not shutil.which("tmux"):
        return {"ok": False, "error": "tmux is not installed. Run the Kali tool installer first."}
    has = subprocess.run(_tmux_args("has-session", "-t", TMUX_SESSION), text=True, capture_output=True, timeout=10)
    if has.returncode != 0:
        subprocess.run(_tmux_args("new-session", "-d", "-s", TMUX_SESSION, "-c", WORKSPACE_DIR), text=True, capture_output=True, timeout=10, check=True)
    return {"ok": True, "socket": TMUX_SOCKET, "session": TMUX_SESSION, "workspace": WORKSPACE_DIR, "publicPort": False}


def tmux_send(cmd):
    from guardrails import is_protected, protected_result
    cmd = str(cmd or "").strip()
    if not cmd:
        return {"ok": False, "error": "Missing command."}
    if is_protected(cmd):
        return protected_result(cmd, "This tmux command is on the hard-blocked list and needs operator approval.")
    start = tmux_start()
    if not start.get("ok"):
        return start
    p = subprocess.run(_tmux_args("send-keys", "-t", TMUX_SESSION, cmd, "Enter"), text=True, capture_output=True, timeout=10)
    return {"ok": p.returncode == 0, "cmd": cmd, "stderr": p.stderr[-4000:], "socket": TMUX_SOCKET, "session": TMUX_SESSION}


def tmux_capture(lines=160):
    start = tmux_start()
    if not start.get("ok"):
        return start
    try:
        count = max(20, min(int(lines or 160), 500))
    except Exception:
        count = 160
    p = subprocess.run(_tmux_args("capture-pane", "-p", "-t", TMUX_SESSION, "-S", f"-{count}"), text=True, capture_output=True, timeout=10)
    return {"ok": p.returncode == 0, "output": p.stdout[-20000:], "stderr": p.stderr[-4000:], "socket": TMUX_SOCKET, "session": TMUX_SESSION}


def desktop_input(tool):
    if sys.platform.startswith("win"):
        return {"ok": False, "error": "Desktop input automation is Kali/X11 only in this build. Windows stays visible-terminal only."}
    if not shutil.which("xdotool"):
        return {"ok": False, "error": "xdotool is not installed. Run the Kali tool installer first."}
    mode = str((tool or {}).get("mode", "key")).strip().lower()
    env = os.environ.copy()
    env.setdefault("DISPLAY", os.environ.get("DISPLAY", ":1"))
    if mode == "key":
        key = str(tool.get("key", "")).strip()
        if not SAFE_KEY_RE.match(key):
            return {"ok": False, "error": "Invalid key name."}
        args = ["xdotool", "key", key]
    elif mode == "click":
        button = int(tool.get("button", 1) or 1)
        if button not in (1, 2, 3, 4, 5):
            return {"ok": False, "error": "Invalid mouse button."}
        args = ["xdotool", "click", str(button)]
    elif mode == "move":
        x = max(0, min(int(tool.get("x", 0) or 0), 10000))
        y = max(0, min(int(tool.get("y", 0) or 0), 10000))
        args = ["xdotool", "mousemove", str(x), str(y)]
    elif mode == "type":
        text = str(tool.get("text", ""))[:500]
        args = ["xdotool", "type", "--delay", "10", text]
    else:
        return {"ok": False, "error": "Unsupported desktop input mode."}
    p = subprocess.run(args, text=True, capture_output=True, timeout=20, env=env)
    return {"ok": p.returncode == 0, "mode": mode, "stderr": p.stderr[-4000:], "display": env.get("DISPLAY", "")}


def open_output_dir():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    if sys.platform.startswith("win"):
        subprocess.Popen(["explorer", OUTPUT_DIR])
    else:
        opener = shutil.which("xdg-open")
        if not opener:
            return {"ok": False, "error": "xdg-open is not installed.", "path": OUTPUT_DIR}
        subprocess.Popen([opener, OUTPUT_DIR], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    return {"ok": True, "path": OUTPUT_DIR}


def make_image_card(title="PhantomBot", subtitle="Private output ready", name="phantombot-card.png"):
    if Image is None or ImageDraw is None:
        return {"ok": False, "error": "Pillow image drawing is not available."}
    path = safe_output_path(name)
    width, height = 1280, 720
    img = Image.new("RGB", (width, height), "#03100b")
    draw = ImageDraw.Draw(img)
    for y in range(height):
        shade = int(8 + 34 * (y / height))
        draw.line((0, y, width, y), fill=(0, shade, 20))
    draw.rectangle((48, 48, width - 48, height - 48), outline="#35ff92", width=3)
    draw.rectangle((78, 78, width - 78, height - 78), outline="#123323", width=2)
    title_font = ImageFont.truetype("arial.ttf", 72) if sys.platform.startswith("win") else ImageFont.load_default()
    body_font = ImageFont.truetype("arial.ttf", 34) if sys.platform.startswith("win") else ImageFont.load_default()
    draw.text((96, 160), str(title)[:80], fill="#eefbff", font=title_font)
    draw.text((100, 278), str(subtitle)[:160], fill="#8dffc4", font=body_font)
    draw.text((100, height - 130), "PHANTOMBOT · PRIVATE OUTPUT", fill="#35ff92", font=body_font)
    img.save(path)
    return {"ok": True, "path": path, "bytes": os.path.getsize(path), "method": "PIL.ImageDraw"}


def run_command(cmd):
    from guardrails import is_protected, protected_result
    if is_protected(cmd):
        return protected_result(cmd)
    cwd = WORKSPACE_DIR
    start = time.time()
    p = subprocess.run(cmd, shell=True, cwd=cwd, text=True, capture_output=True, timeout=90)
    return {"ok": p.returncode == 0, "stdout": p.stdout[-12000:], "stderr": p.stderr[-12000:], "code": p.returncode, "seconds": round(time.time() - start, 2), "cmd": cmd, "cwd": cwd}


def run_visible_terminal(cmd):
    from guardrails import is_protected, protected_result
    if is_protected(cmd):
        return protected_result(cmd)
    cwd = WORKSPACE_DIR
    os.makedirs(cwd, exist_ok=True)
    if sys.platform.startswith("win"):
        stamp = int(time.time() * 1000)
        script = os.path.join(cwd, f"redfin_exec_{stamp}.cmd")
        with open(script, "w", encoding="utf-8", newline="\r\n") as f:
            f.write("@echo off\r\n")
            f.write("title Phantombot Exec\r\n")
            f.write(f"cd /d \"{cwd}\"\r\n")
            f.write("echo PhantomBot command is running...\r\n")
            f.write(f"{cmd}\r\n")
            f.write("set REDFIN_EXIT=%ERRORLEVEL%\r\n")
            f.write("echo.\r\n")
            f.write("echo [PhantomBot finished - terminal left open, exit %REDFIN_EXIT%]\r\n")
            f.write("cmd /k\r\n")
        subprocess.Popen(["cmd.exe", "/k", script], cwd=cwd, shell=False)
    else:
        env = os.environ.copy()
        env.setdefault("DISPLAY", ":0")
        env.setdefault("DBUS_SESSION_BUS_ADDRESS", "unix:path=/run/user/1000/bus")
        env.setdefault("XAUTHORITY", os.path.join(os.path.expanduser("~"), ".Xauthority"))
        full = f"cd {shlex.quote(cwd)}; {cmd}; echo; echo '[PhantomBot finished - terminal left open]'; exec bash"
        try:
            if subprocess.run(["bash", "-lc", "command -v x-terminal-emulator >/dev/null"], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
                subprocess.Popen(["x-terminal-emulator", "-e", "bash", "-lc", full], env=env, start_new_session=True)
            else:
                subprocess.Popen(["bash", "-lc", full], env=env, start_new_session=True)
        except Exception:
            subprocess.Popen(["bash", "-lc", full], env=env, start_new_session=True)
    return {"ok": True, "visibleTerminal": True, "cmd": cmd, "cwd": cwd}


def edit_file(path, old_string, new_string, replace_all=False):
    target = safe_pc_path(path)
    if not os.path.isfile(target):
        return {"ok": False, "error": "Not a file.", "path": target}
    with open(target, "r", encoding="utf-8") as f:
        content = f.read()
    count = content.count(old_string)
    if count == 0:
        return {"ok": False, "error": "old_string not found in file.", "path": target}
    if count > 1 and not replace_all:
        return {"ok": False, "error": f"old_string is not unique ({count} matches). Pass replace_all=True or include more context.", "path": target}
    new_content = content.replace(old_string, new_string) if replace_all else content.replace(old_string, new_string, 1)
    with open(target, "w", encoding="utf-8") as f:
        f.write(new_content)
    return {"ok": True, "path": target, "replacements": count if replace_all else 1}


def grep(pattern, path=".", glob_filter=None, limit=200):
    target = safe_pc_path(path)
    try:
        regex = re.compile(pattern)
    except re.error as e:
        return {"ok": False, "error": f"Invalid regex: {e}"}
    matches = []
    walk_root = target if os.path.isdir(target) else os.path.dirname(target)
    files = [target] if os.path.isfile(target) else None
    if files is None:
        files = []
        for root, _dirs, names in os.walk(walk_root):
            for name in names:
                if glob_filter and not fnmatch.fnmatch(name, glob_filter):
                    continue
                files.append(os.path.join(root, name))
    for file_path in files:
        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                for line_no, line in enumerate(f, start=1):
                    if regex.search(line):
                        matches.append({"path": file_path, "line": line_no, "text": line.rstrip("\n")[:500]})
                        if len(matches) >= limit:
                            return {"ok": True, "matches": matches, "truncated": True}
        except (IsADirectoryError, PermissionError, UnicodeDecodeError):
            continue
    return {"ok": True, "matches": matches, "truncated": False}


def glob_files(pattern, path=".", limit=200):
    target = safe_pc_path(path)
    if not os.path.isdir(target):
        return {"ok": False, "error": "Path is not a directory.", "path": target}
    matches = []
    for root, _dirs, names in os.walk(target):
        for name in names:
            if fnmatch.fnmatch(name, pattern):
                matches.append(os.path.join(root, name))
                if len(matches) >= limit:
                    return {"ok": True, "paths": matches, "truncated": True}
    return {"ok": True, "paths": matches, "truncated": False}


APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _run_helper(script_name, args, timeout=120):
    helper = os.path.join(APP_DIR, script_name)
    if not os.path.exists(helper):
        return {"ok": False, "error": f"{script_name} is missing."}
    p = subprocess.run([sys.executable, helper, *args], text=True, capture_output=True, timeout=timeout)
    try:
        payload = json.loads(p.stdout)
    except Exception:
        payload = {"stdout": p.stdout[-12000:], "stderr": p.stderr[-12000:]}
    return {"ok": p.returncode == 0, "result": payload, "stderr": p.stderr[-4000:], "code": p.returncode}


def make_generated_graphic(title="PhantomBot generated graphic", prompt="Private output ready", format="png", name=None):
    args = ["graphic", "--title", str(title), "--prompt", str(prompt), "--format", str(format)]
    if name:
        args.extend(["--name", str(name)])
    return _run_helper("phantombot-media-tools.py", args)


def make_generated_video(title="PhantomBot generated video", subtitle="Private MP4 ready", name="phantombot-generated-video.mp4"):
    return _run_helper("phantombot-media-tools.py", ["video", "--title", str(title), "--subtitle", str(subtitle), "--name", str(name)])


def stage_discord(message="", files=None):
    stage_dir = os.path.join(OUTPUT_DIR, "discord-staging")
    os.makedirs(stage_dir, exist_ok=True)
    safe_files = []
    for item in files or []:
        raw = str(item or "").strip()
        if not raw:
            continue
        candidate = os.path.abspath(os.path.expanduser(raw))
        if not os.path.isabs(raw):
            candidate = os.path.abspath(os.path.join(OUTPUT_DIR, raw))
        allowed = candidate.lower().startswith(OUTPUT_DIR.lower()) or candidate.lower().startswith(WORKSPACE_DIR.lower())
        if allowed and os.path.isfile(candidate):
            safe_files.append(candidate)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    manifest = {
        "ok": True,
        "createdAt": stamp,
        "message": str(message or "")[:2000],
        "files": safe_files,
        "sendPerformed": False,
        "approvalRequired": True,
        "note": "Discord upload is staged only. Operator approval is required before any send/upload.",
    }
    path = os.path.join(stage_dir, f"discord-stage-{stamp}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    manifest["manifestPath"] = path
    return manifest


def discord_voice_status():
    return _run_helper("phantombot-discord-voice.py", ["status"], timeout=30)


def discord_bridge_status():
    return _run_helper("phantombot-discord-bridge.py", ["status"], timeout=60)


def discord_bridge_stage(message="", files=None):
    args = ["stage", "--kind", "upload", "--message", str(message or "")]
    for item in files or []:
        args.append(str(item))
    return _run_helper("phantombot-discord-bridge.py", args, timeout=60)


def discord_voice_stage(mode="both", message="PhantomBot voice bridge request"):
    return _run_helper("phantombot-discord-bridge.py", ["voice-stage", "--mode", str(mode), "--message", str(message)], timeout=60)


def run_acceptance():
    return _run_helper("phantombot-acceptance.py", [], timeout=180)


def write_and_run(name, content, cmd=None):
    w = write_file(name, content)
    if not w.get("ok"):
        return {"ok": False, "write": w}
    run_cmd = cmd or ("python " + shlex.quote(os.path.basename(w.get("path", "agent_task.py"))))
    r = run_visible_terminal(run_cmd)
    return {"ok": bool(r.get("ok")), "write": w, "run": r}
