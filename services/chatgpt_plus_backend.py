"""
PhantomBot ChatGPT Plus backend — drives chatgpt.com with the user's own
logged-in session via Playwright + the real Chrome/Edge profile.

Endpoints (all local-only, 127.0.0.1):
  GET  /health   -> status
  POST /ask      -> {"prompt": "...", "effort": "instant|high|xhigh"} -> {"ok", "output_text"}
  POST /image    -> {"prompt": "..."} -> {"ok", "image_b64", "content_type"} or {"ok": False, "error"}

Protocol contract with chatgpt-assist-adapter.mjs:
  stdin  : JSON {"prompt"|"packet": {...}, "mode"|"effort": "..."}
  stdout : JSON {"ok": true, "output_text": "..."}  (or image fields)

Environment:
  PHANTOM_CHATGPT_BACKEND_PORT   (default 8792)
  PHANTOM_CHATGPT_BACKEND_HOST   (default 127.0.0.1)
  PHANTOM_CHATGPT_PROFILE_DIR    browser profile clone dir (default %LOCALAPPDATA%\\phantom-chatgpt-profile)
  PHANTOM_CHATGPT_BROWSER        chrome|edge (default chrome)
  PHANTOM_CHATGPT_HEADLESS       1|0 (default 0; headless can trigger web anti-bot checks)
  PHANTOM_CHATGPT_HIDE_WINDOW    1|0 (default 1; hide the bridge-owned Chrome window)
  PHANTOM_CHATGPT_MODEL          model label in the picker (default auto — leave whatever Plus defaults to)
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
import logging
from logging.handlers import RotatingFileHandler
import os
import re
import shutil
import sys
import time
import traceback
import uuid
import ctypes
from ctypes import wintypes
from dataclasses import dataclass, asdict
from pathlib import Path

from aiohttp import web
from playwright.async_api import async_playwright, BrowserContext, Page

HOST = os.environ.get("PHANTOM_CHATGPT_BACKEND_HOST", "127.0.0.1")
PORT = int(os.environ.get("PHANTOM_CHATGPT_BACKEND_PORT", "8792"))
# Keep the real Chrome engine for ChatGPT compatibility. The bridge hides its
# own native window instead of using headless mode, which can trigger checks.
BROWSER_HEADLESS = os.environ.get("PHANTOM_CHATGPT_HEADLESS", "0").strip().lower() in {
    "1", "true", "yes", "on"
}
HIDE_BROWSER_WINDOW = os.environ.get("PHANTOM_CHATGPT_HIDE_WINDOW", "1").strip().lower() in {
    "1", "true", "yes", "on"
}
VISIBLE_BROWSER = not BROWSER_HEADLESS
BROWSER_KIND = os.environ.get("PHANTOM_CHATGPT_BROWSER", "chrome").lower()
PROFILE_DIR = Path(os.environ.get(
    "PHANTOM_CHATGPT_PROFILE_DIR",
    str(Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData/Local"))) / "phantom-chatgpt-profile"),
))
CHATGPT_HOME = "https://chatgpt.com/"
LOCALAPPDATA = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData/Local")))
LOG_DIR = LOCALAPPDATA / "hermes" / "logs"
IMAGE_OUTPUT_DIR = Path(os.environ.get("PHANTOM_CHATGPT_IMAGE_DIR", str(LOCALAPPDATA / "hermes" / "cache" / "images")))
WINDOW_X = max(0, int(os.environ.get("PHANTOM_CHATGPT_WINDOW_X", "50")))
WINDOW_Y = max(0, int(os.environ.get("PHANTOM_CHATGPT_WINDOW_Y", "50")))
WINDOW_WIDTH = max(800, int(os.environ.get("PHANTOM_CHATGPT_WINDOW_WIDTH", "1280")))
WINDOW_HEIGHT = max(600, int(os.environ.get("PHANTOM_CHATGPT_WINDOW_HEIGHT", "900")))
MAX_PROMPT_CHARS = int(os.environ.get("PHANTOM_CHATGPT_MAX_PROMPT_CHARS", "300000"))
# ChatGPT Plus is one subscription surface: text and image requests go through
# the same model id, and this bridge chooses the browser flow automatically.
IMAGE_INTENT_FALLBACK = os.environ.get("PHANTOM_CHATGPT_IMAGE_INTENT_FALLBACK", "1") == "1"
INCLUDE_IMAGE_B64 = os.environ.get("PHANTOM_CHATGPT_INCLUDE_IMAGE_B64", "0") == "1"
SERVICE_VERSION = "2026-08-09.1"

# Timeouts
NAV_TIMEOUT_MS = 60_000
RESPONSE_TIMEOUT_S = int(os.environ.get("PHANTOM_CHATGPT_TEXT_TIMEOUT", "180"))
IMAGE_TIMEOUT_S = int(os.environ.get("PHANTOM_CHATGPT_IMAGE_TIMEOUT", "300"))
POLL_INTERVAL_S = 1.5
EFFORT_RESPONSE_TIMEOUTS = {
    "instant": min(RESPONSE_TIMEOUT_S, 45),
    "high": min(RESPONSE_TIMEOUT_S, 150),
    "xhigh": max(RESPONSE_TIMEOUT_S, 240),
}


def _hide_bridge_browser_windows() -> int:
    """Hide only top-level windows owned by this bridge's Chrome profile."""
    if os.name != "nt" or BROWSER_HEADLESS or not HIDE_BROWSER_WINDOW:
        return 0
    try:
        import psutil

        profile = str(PROFILE_DIR).lower()
        pids = {
            proc.pid
            for proc in psutil.process_iter(["name", "cmdline"])
            if str(proc.info.get("name") or "").lower() in {"chrome.exe", "msedge.exe"}
            and profile in " ".join(proc.info.get("cmdline") or []).lower()
        }
        if not pids:
            return 0

        user32 = ctypes.windll.user32
        hidden = 0
        enum_proc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

        @enum_proc
        def callback(hwnd, _lparam):
            nonlocal hidden
            pid = wintypes.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            if pid.value in pids and user32.IsWindowVisible(hwnd):
                user32.ShowWindow(hwnd, 0)  # SW_HIDE; removes the taskbar window.
                hidden += 1
            return True

        user32.EnumWindows(callback, 0)
        return hidden
    except Exception:
        logger.debug("bridge window hiding unavailable", exc_info=True)
        return 0

# Selectors (chatgpt.com web UI). These change occasionally; multiple fallbacks.
PROMPT_TEXTAREA = [
    "#prompt-textarea",
    "div#prompt-textarea[contenteditable='true']",
    "textarea[data-id='root']",
    "div[contenteditable='true'][data-virtualkeyboard]",
    "div[contenteditable='true']",
]
SEND_BUTTON = [
    "button[data-testid='send-button']",
    "button[aria-label='Send prompt']",
    "button[aria-label='Send']",
]
STOP_BUTTON = [
    "button[data-testid='stop-button']",
    "button[aria-label='Stop generating']",
    "button[aria-label='Stop']",
]
# Assistant turn containers (newest last)
ASSISTANT_TURN = [
    "section[data-testid^='conversation-turn'][data-turn='assistant']",
    "div[data-message-author-role='assistant']",
    "article[data-testid^='conversation-turn'] div[data-message-author-role='assistant']",
]
# Generated image inside the latest assistant turn
GENERATED_IMAGE = [
    "div[data-message-author-role='assistant'] img[alt*='Generated']",
    "div[data-message-author-role='assistant'] img[src*='oaidalleapiprodscus']",
    "div[data-message-author-role='assistant'] img",
]

# ---------------------------------------------------------------------------
# Browser lifecycle
# ---------------------------------------------------------------------------

_pw = None
_ctx: BrowserContext | None = None
_page: Page | None = None
_lock = asyncio.Lock()          # serialize requests — one chat at a time
_boot_time = 0.0
_last_error: str | None = None
_last_request: dict | None = None
_logged_in: bool | None = None


LOG_DIR.mkdir(parents=True, exist_ok=True)
logger = logging.getLogger("chatgpt_plus_backend")
logger.setLevel(logging.INFO)
if not logger.handlers:
    handler = RotatingFileHandler(LOG_DIR / "chatgpt_plus_backend.log", maxBytes=2_000_000, backupCount=5, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s request=%(request_id)s operation=%(operation)s stage=%(stage)s elapsed_ms=%(elapsed_ms)s %(message)s"))
    logger.addHandler(handler)


def _request_id() -> str:
    return uuid.uuid4().hex[:10]


def _log(request_id: str, operation: str, stage: str, start: float, message: str = "", level: int = logging.INFO) -> None:
    logger.log(level, message, extra={
        "request_id": request_id or "-",
        "operation": operation or "-",
        "stage": stage or "-",
        "elapsed_ms": int((time.time() - start) * 1000) if start else 0,
    })


@dataclass
class BackendError(Exception):
    message: str
    status: int = 502
    error_type: str = "backend_error"
    error_origin: str = "local_backend"

    def __str__(self) -> str:
        return self.message


class AuthenticationRequiredError(BackendError):
    def __init__(self, message: str = "ChatGPT authentication is required"):
        super().__init__(message, 401, "authentication_required", "chatgpt_visible_ui")


class ComposerNotFoundError(BackendError):
    def __init__(self, message: str = "ChatGPT prompt composer was not found"):
        super().__init__(message, 502, "composer_not_found", "chatgpt_visible_ui")


class GenerationTimeoutError(BackendError):
    def __init__(self, message: str):
        super().__init__(message, 504, "generation_timeout", "local_backend")


class PromptTooLargeError(BackendError):
    def __init__(self, length: int):
        super().__init__(f"Prompt length {length} exceeds configured limit {MAX_PROMPT_CHARS}", 400, "prompt_too_large", "local_backend")


class ImageDownloadError(BackendError):
    def __init__(self, message: str):
        super().__init__(message, 502, "image_download_error", "image_download")


def _chrome_path() -> str | None:
    candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ]
    for c in candidates:
        if Path(c).exists():
            return c
    return None


def _edge_path() -> str | None:
    candidates = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ]
    for c in candidates:
        if Path(c).exists():
            return c
    return None


async def launch_browser() -> None:
    """Launch a persistent Playwright context with a cloned user profile."""
    global _pw, _ctx, _page, _boot_time, _logged_in, _last_error

    PROFILE_DIR.mkdir(parents=True, exist_ok=True)

    executable = _chrome_path() if BROWSER_KIND == "chrome" else _edge_path()
    if executable is None:
        # fall back to bundled chromium
        executable = None

    _pw = await async_playwright().start()
    args = [
        "--disable-blink-features=AutomationControlled",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-session-crashed-bubble",
        "--hide-crash-restore-bubble",
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=9223",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-background-timer-throttling",
        "--disable-features=CalculateNativeWinOcclusion",
        f"--window-position={WINDOW_X},{WINDOW_Y}",
        f"--window-size={WINDOW_WIDTH},{WINDOW_HEIGHT}",
    ]
    if BROWSER_HEADLESS:
        # Playwright's new headless mode uses the same Chrome engine and
        # profile, while creating no desktop window or taskbar item.
        args.append("--headless=new")
    launch_kwargs = dict(
        user_data_dir=str(PROFILE_DIR),
        headless=BROWSER_HEADLESS,
        args=args,
        viewport={"width": WINDOW_WIDTH, "height": WINDOW_HEIGHT},
        ignore_https_errors=True,
    )
    if executable:
        launch_kwargs["executable_path"] = executable
    else:
        launch_kwargs["channel"] = "chromium"

    _ctx = await _pw.chromium.launch_persistent_context(**launch_kwargs)
    _ctx.set_default_navigation_timeout(NAV_TIMEOUT_MS)
    _ctx.set_default_timeout(30_000)

    # stealth-ish: hide webdriver flag
    await _ctx.add_init_script(
        "Object.defineProperty(navigator, 'webdriver', {get: () => undefined});"
    )

    _page = _ctx.pages[0] if _ctx.pages else await _ctx.new_page()
    await _page.goto(CHATGPT_HOME, wait_until="domcontentloaded")
    await asyncio.sleep(0.5)
    _hide_bridge_browser_windows()
    _boot_time = time.time()
    _logged_in = None
    _last_error = None
    print(
        f"[backend] browser launched (headless={BROWSER_HEADLESS}, "
        f"window={WINDOW_X},{WINDOW_Y},{WINDOW_WIDTH}x{WINDOW_HEIGHT}, exe={executable or 'chromium'})",
        flush=True,
    )
    _log("-", "startup", "BROWSER_READY", _boot_time, f"exe={executable or 'chromium'} profile={PROFILE_DIR} window={WINDOW_X},{WINDOW_Y},{WINDOW_WIDTH}x{WINDOW_HEIGHT}")


async def _click_resilient(locator, timeout: int = 1200) -> bool:
    try:
        if not await locator.count():
            return False
        await locator.first.click(force=True, timeout=timeout)
        return True
    except Exception:
        try:
            await locator.first.evaluate("element => element.click()")
            return True
        except Exception:
            return False


async def _dismiss_blocking_overlays() -> None:
    """Dismiss bridge-blocking onboarding without touching conversation UI."""
    modal_selectors = (
        '[data-testid="modal-beacon"]',
        '#modal-beacon',
        '[role="dialog"][data-state="open"]',
    )
    for selector in modal_selectors:
        dialogs = _page.locator(selector)
        try:
            count = await dialogs.count()
        except Exception:
            continue
        for index in range(count):
            dialog = dialogs.nth(index)
            try:
                if not await dialog.is_visible(timeout=300):
                    continue
            except Exception:
                continue
            close = dialog.locator(
                'button[aria-label="Close"], [data-testid="close-button"], '
                'button:has-text("Not now"), button:has-text("Maybe later"), '
                'button:has-text("Dismiss")'
            )
            if not await _click_resilient(close):
                try:
                    await _page.keyboard.press("Escape")
                except Exception:
                    pass
            await _page.wait_for_timeout(150)

    for selector in ("button:has-text('Accept')", "button:has-text('Okay')"):
        button = _page.locator(selector)
        try:
            if await button.count() and await button.first.is_visible(timeout=300):
                await _click_resilient(button, timeout=1000)
        except Exception:
            pass


def _normalize_effort(value: object) -> str:
    clean = re.sub(r"[\s_-]+", "", str(value or "").strip().lower())
    if clean in {"xhigh", "extrahigh", "maximum", "max", "deepest"}:
        return "xhigh"
    if clean in {"high", "deep", "standard", "medium"}:
        return "high"
    return "instant"


def _request_effort(body: dict) -> str:
    metadata = body.get("metadata") if isinstance(body.get("metadata"), dict) else {}
    return _normalize_effort(
        body.get("reasoning_effort")
        or body.get("effort")
        or body.get("mode")
        or metadata.get("phantom_effort")
        or "high"
    )


async def _ensure_chat_mode() -> None:
    """Use normal Chat, not credit-metered Work, for subscription requests."""
    chat = _page.get_by_role("radio", name="Chat", exact=True)
    try:
        if await chat.count() and await chat.first.get_attribute("aria-checked") != "true":
            await _click_resilient(chat)
            await _page.wait_for_timeout(500)
    except Exception:
        pass


async def _composer_effort_label() -> str:
    switcher = _page.locator('button.__composer-pill[aria-haspopup="menu"]')
    if not await switcher.count():
        return ""
    return re.sub(r"\s+", " ", await switcher.first.inner_text()).strip()


async def _open_effort_menu():
    await _dismiss_blocking_overlays()
    try:
        await _page.keyboard.press("Escape")
        await _page.wait_for_timeout(150)
    except Exception:
        pass
    menu = _page.locator('[role="menu"]').filter(
        has=_page.locator('[role="menuitem"][aria-label="Power"]')
    )
    for _ in range(3):
        switcher = _page.locator('button.__composer-pill[aria-haspopup="menu"]')
        if not await switcher.count():
            switcher = _page.locator('button[aria-haspopup="menu"]').filter(
                has_text=re.compile(r"(?:5\.\d|Instant|Extra High|High|Medium|Light)", re.IGNORECASE)
            )
        if not await _click_resilient(switcher):
            continue
        try:
            await menu.wait_for(state="visible", timeout=2500)
            return menu
        except Exception:
            try:
                await _page.keyboard.press("Escape")
                await _page.wait_for_timeout(200)
            except Exception:
                pass
    raise BackendError(
        "ChatGPT effort picker did not open",
        502,
        "effort_picker_unavailable",
        "chatgpt_ui",
    )


async def _set_chatgpt_effort(effort: str) -> None:
    """Apply request-scoped Instant/High depth on normal Chat."""
    effort = _normalize_effort(effort)
    await _ensure_chat_mode()
    current_label = await _composer_effort_label()
    if effort == "instant" and current_label == "Instant":
        return
    if effort == "high" and current_label == "High":
        return
    if effort == "xhigh" and current_label == "Extra High":
        return

    await _open_effort_menu()
    view_toggle = _page.locator(
        '[role="menuitem"][aria-label="Show advanced options"], '
        '[role="menuitem"][aria-label="Show compact options"]'
    )
    if await view_toggle.count() and await view_toggle.first.get_attribute("aria-label") == "Show advanced options":
        await view_toggle.first.focus()
        await _page.keyboard.press("Enter")
        await _page.wait_for_timeout(200)

    effort_row = _page.locator('[role="menuitem"]').filter(has_text="Effort")
    if not await effort_row.count():
        raise BackendError(
            "ChatGPT effort control was not found",
            502,
            "effort_picker_unavailable",
            "chatgpt_ui",
        )
    await effort_row.last.focus()
    await _page.keyboard.press("ArrowRight")
    await _page.wait_for_timeout(200)
    labels = {
        "instant": ("Instant",),
        "high": ("High",),
        "xhigh": ("Extra High", "High"),
    }[effort]
    option = None
    for label in labels:
        candidate = _page.get_by_role("menuitemradio", name=label, exact=True)
        if await candidate.count():
            option = candidate
            break
    if option is None:
        raise BackendError(
            f"ChatGPT effort option for {effort} was not found",
            502,
            "effort_picker_unavailable",
            "chatgpt_ui",
        )
    if await option.first.get_attribute("aria-checked") != "true":
        await _click_resilient(option)
        await _page.wait_for_timeout(350)

    try:
        await _page.keyboard.press("Escape")
        await _page.keyboard.press("Escape")
    except Exception:
        pass


async def ensure_ready() -> None:
    """Make sure browser is up and on a fresh chat."""
    global _page, _logged_in
    if _ctx is None or _page is None or _page.is_closed():
        await launch_browser()
    # New chat to avoid polluting prior conversation
    try:
        await _page.goto(CHATGPT_HOME, wait_until="domcontentloaded")
    except Exception:
        pass
    await _dismiss_blocking_overlays()
    # Detect login state: logged-out page shows a "Log in" button
    try:
        login_btn = _page.locator("button:has-text('Log in'), a:has-text('Log in')").first
        logged_out = await login_btn.count() > 0 and await login_btn.is_visible(timeout=2000)
        _logged_in = not logged_out
    except Exception:
        _logged_in = True  # assume ok; prompt box will fail below if wrong


async def _find_prompt_box():
    for index, sel in enumerate(PROMPT_TEXTAREA):
        loc = _page.locator(sel).first
        try:
            # ChatGPT's React shell reaches DOMContentLoaded before the composer
            # mounts. Wait on the canonical selector instead of checking count
            # instantly and falsely reporting a logged-out session.
            await loc.wait_for(
                state="visible" if VISIBLE_BROWSER else "attached",
                timeout=15_000 if index == 0 else 2_000,
            )
            return loc
        except Exception:
            continue
    return None


async def _page_diagnostics() -> dict:
    if _page is None:
        return {"page": None}
    data = {"url": _page.url, "title": await _page.title()}
    try:
        data["composer_candidates"] = await _page.locator("#prompt-textarea, textarea, div[contenteditable='true'], [role='textbox']").count()
    except Exception:
        data["composer_candidates"] = None
    try:
        data["assistant_count"] = max([await _page.locator(sel).count() for sel in ASSISTANT_TURN] or [0])
    except Exception:
        data["assistant_count"] = None
    try:
        data["visible_text"] = (await _page.locator("body").inner_text(timeout=1000))[:600]
    except Exception:
        data["visible_text"] = ""
    return data


async def _latest_assistant_text() -> str:
    for sel in ASSISTANT_TURN:
        locs = _page.locator(sel)
        try:
            n = await locs.count()
            if n:
                text = (await locs.nth(n - 1).inner_text()).strip()
                return re.sub(
                    r"\n+\s*Is this conversation helpful so far\?\s*$",
                    "",
                    text,
                    flags=re.IGNORECASE,
                ).strip()
        except Exception:
            continue
    return ""


async def _generating() -> bool:
    for sel in STOP_BUTTON:
        loc = _page.locator(sel).first
        try:
            if await loc.count() and await loc.is_visible(timeout=300):
                return True
        except Exception:
            continue
    return False


async def _set_prompt_text(box, text: str) -> None:
    """Set ChatGPT's ProseMirror/contenteditable composer without locator.fill().

    ChatGPT's current composer can resolve as visible but never satisfy
    Playwright's editable check. Using execCommand through the focused element
    triggers the same input path the React/ProseMirror shell expects.
    """
    await box.evaluate(
        """(el, value) => {
            const escapeHtml = (s) => s
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
            el.focus();
            if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                const setter = Object.getOwnPropertyDescriptor(el.__proto__, 'value')?.set;
                setter ? setter.call(el, value) : el.value = value;
            } else {
                const paragraphs = String(value).split(/\\n/).map(line => `<p>${escapeHtml(line) || '<br>'}</p>`).join('');
                el.innerHTML = paragraphs || '<p><br></p>';
            }
            el.dispatchEvent(new InputEvent('input', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertText',
                data: value
            }));
            el.dispatchEvent(new Event('change', {bubbles: true}));
        }""",
        text,
    )
    await _page.wait_for_timeout(250)
    actual = await box.inner_text(timeout=2000)
    expected = re.sub(r"\s+", " ", text).strip()
    observed = re.sub(r"\s+", " ", actual).strip()
    if expected not in observed:
        await box.click(force=not VISIBLE_BROWSER)
        await box.evaluate("(el) => el.focus()")
        await _page.keyboard.press("Control+A")
        await _page.keyboard.insert_text(text)
        await _page.wait_for_timeout(250)
        actual = await box.inner_text(timeout=2000)
        observed = re.sub(r"\s+", " ", actual).strip()
    if expected not in observed:
        raise BackendError(f"Prompt composer did not retain the expected text; observed_chars={len(actual)} observed_excerpt={observed[:120]!r}", 502, "submission_failed", "local_backend")


async def ask_chatgpt(prompt: str, request_id: str | None = None, effort: str = "high") -> str:
    """Send a text prompt, return the completed answer text."""
    async with _lock:
        request_id = request_id or _request_id()
        start = time.time()
        _log(request_id, "text", "REQUEST_ACCEPTED", start, f"prompt_chars={len(prompt)}")
        await ensure_ready()
        _log(request_id, "text", "PAGE_READY", start)
        effort = _normalize_effort(effort)
        poll_interval = 0.5 if effort == "instant" else 1.0
        await _set_chatgpt_effort(effort)
        _log(request_id, "text", "EFFORT_SELECTED", start, f"effort={effort}")

        box = await _find_prompt_box()
        if box is None:
            diag = await _page_diagnostics()
            if "log in" in str(diag).lower():
                raise AuthenticationRequiredError()
            raise ComposerNotFoundError(f"ChatGPT prompt composer was not found; diagnostics={diag}")
        _log(request_id, "text", "COMPOSER_READY", start)

        await _dismiss_blocking_overlays()
        await box.click(force=True)
        await _set_prompt_text(box, prompt)
        _log(request_id, "text", "PROMPT_ENTERED", start)

        # snapshot count of assistant turns so we know when a NEW one appears
        baseline = 0
        for sel in ASSISTANT_TURN:
            try:
                baseline = max(baseline, await _page.locator(sel).count())
            except Exception:
                pass

        # send
        sent = False
        for sel in SEND_BUTTON:
            btn = _page.locator(sel).first
            try:
                if await btn.count() and await btn.is_enabled(timeout=1000):
                    await btn.click(force=not VISIBLE_BROWSER)
                    sent = True
                    break
            except Exception:
                continue
        if not sent:
            await box.press("Enter")
        _log(request_id, "text", "PROMPT_SUBMITTED", start)

        # wait for new assistant turn to appear
        deadline = time.time() + EFFORT_RESPONSE_TIMEOUTS[effort]
        appeared = False
        while time.time() < deadline:
            for sel in ASSISTANT_TURN:
                try:
                    if await _page.locator(sel).count() > baseline:
                        appeared = True
                        break
                except Exception:
                    pass
            if appeared:
                break
            await asyncio.sleep(poll_interval)
        if not appeared:
            raise GenerationTimeoutError("No assistant response appeared within timeout")
        _log(request_id, "text", "RESPONSE_STARTED", start)

        # wait until generation stops (stop button disappears) AND text stabilizes
        last_text = ""
        stable_ticks = 0
        while time.time() < deadline:
            generating = await _generating()
            text = await _latest_assistant_text()
            if not generating:
                if text == last_text and text:
                    stable_ticks += 1
                    if stable_ticks >= 2:
                        _log(request_id, "text", "TEXT_COMPLETE", start)
                        return text
                else:
                    stable_ticks = 0
                    last_text = text
            await asyncio.sleep(poll_interval)
        # fall through — return whatever we have
        text = await _latest_assistant_text()
        if text:
            _log(request_id, "text", "TEXT_COMPLETE", start, "returned unstabilized final text")
            return text
        raise GenerationTimeoutError("Response did not stabilize within timeout")


async def image_chatgpt(prompt: str, request_id: str | None = None) -> dict:
    """Ask for an image, save it locally, and return structured image metadata."""
    async with _lock:
        request_id = request_id or _request_id()
        start = time.time()
        _log(request_id, "image", "REQUEST_ACCEPTED", start, f"prompt_chars={len(prompt)}")
        await ensure_ready()
        _log(request_id, "image", "PAGE_READY", start)
        box = await _find_prompt_box()
        if box is None:
            diag = await _page_diagnostics()
            if "log in" in str(diag).lower():
                raise AuthenticationRequiredError()
            raise ComposerNotFoundError(f"ChatGPT prompt composer was not found; diagnostics={diag}")
        _log(request_id, "image", "COMPOSER_READY", start)

        full_prompt = f"Generate an image: {prompt}"
        await box.click(force=not VISIBLE_BROWSER)
        await _set_prompt_text(box, full_prompt)
        _log(request_id, "image", "PROMPT_ENTERED", start)

        baseline_turns = 0
        for sel in ASSISTANT_TURN:
            try:
                baseline_turns = max(baseline_turns, await _page.locator(sel).count())
            except Exception:
                pass

        sent = False
        for sel in SEND_BUTTON:
            btn = _page.locator(sel).first
            try:
                if await btn.count() and await btn.is_enabled(timeout=1000):
                    await btn.click(force=not VISIBLE_BROWSER)
                    sent = True
                    break
            except Exception:
                continue
        if not sent:
            await box.press("Enter")
        _log(request_id, "image", "PROMPT_SUBMITTED", start)

        # Wait for a new assistant turn, then inspect images inside that turn
        # only. Comparing global counts from heterogeneous selectors caused
        # valid generated images to be masked by unrelated existing <img>s.
        deadline = time.time() + IMAGE_TIMEOUT_S
        latest_turn = None
        img_loc = None
        last_text = ""
        stable_done_ticks = 0
        while time.time() < deadline:
            for sel in ASSISTANT_TURN:
                turns = _page.locator(sel)
                try:
                    count = await turns.count()
                    if count > baseline_turns:
                        latest_turn = turns.nth(count - 1)
                        break
                except Exception:
                    continue

            generating = await _generating()
            if latest_turn is not None:
                images = latest_turn.locator("img")
                try:
                    for index in range(await images.count()):
                        candidate = images.nth(index)
                        src_value = await candidate.get_attribute("src")
                        if not src_value:
                            continue
                        dimensions = await candidate.evaluate(
                            "el => ({w: el.naturalWidth || el.width, h: el.naturalHeight || el.height})"
                        )
                        if max(int(dimensions.get("w") or 0), int(dimensions.get("h") or 0)) >= 256:
                            # A fully loaded image is the completion signal. The
                            # ChatGPT image UI can leave its stop/progress control
                            # mounted even after usable image bytes exist (and can
                            # simultaneously show a recoverable error banner).
                            img_loc = candidate
                            break
                    else:
                        img_loc = None
                    if img_loc is not None:
                        _log(request_id, "image", "IMAGE_FOUND", start)
                        break
                except Exception:
                    img_loc = None

                try:
                    text = (await latest_turn.inner_text()).strip()
                except Exception:
                    text = ""
                if not generating and text:
                    stable_done_ticks = stable_done_ticks + 1 if text == last_text else 0
                    last_text = text
                    if stable_done_ticks >= 3:
                        raise ImageDownloadError(f"ChatGPT completed without an image: {text[:500]}")
            await asyncio.sleep(2)

        if img_loc is None:
            raise GenerationTimeoutError("No generated image appeared within timeout")

        src = await img_loc.get_attribute("src")
        if not src:
            raise RuntimeError("Generated image had no src")

        if src.startswith("data:"):
            header, b64 = src.split(",", 1)
            ctype = header.split(";")[0].split(":")[1] or "image/png"
            return _store_image_b64(b64, ctype, request_id, start)

        # fetch the image bytes inside the page (carries session cookies)
        data = await _page.evaluate(
            """async (url) => {
                const r = await fetch(url, {credentials: 'include'});
                const buf = await r.arrayBuffer();
                const bytes = new Uint8Array(buf);
                let bin = '';
                for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
                return {b64: btoa(bin), type: r.headers.get('content-type') || 'image/png'};
            }""",
            src,
        )
        return _store_image_b64(data["b64"], data["type"], request_id, start)


# ---------------------------------------------------------------------------
# HTTP layer
# ---------------------------------------------------------------------------

def _adapter_payload_to_prompt(body: dict) -> tuple[str, str]:
    """Accept both our own /ask shape and the adapter's relay-packet shape."""
    effort = _request_effort(body)
    if "prompt" in body and isinstance(body["prompt"], str):
        return body["prompt"], effort
    packet = body.get("packet") or {}
    if isinstance(packet, dict) and packet.get("prompt"):
        return str(packet["prompt"]), effort
    if isinstance(body.get("task"), str):
        return body["task"], effort
    return "", effort


def _validate_prompt(prompt: str) -> None:
    if len(prompt) > MAX_PROMPT_CHARS:
        raise PromptTooLargeError(len(prompt))
    # Guard against Codex/Hermes summary-control packets accidentally being
    # routed into ChatGPT image generation because they mention image history.
    markers = (
        "You are a summarization agent creating a context checkpoint",
        "TURNS TO SUMMARIZE:",
        "Historical Task Snapshot",
        "Use this exact structure:",
    )
    if any(marker in prompt for marker in markers):
        raise BackendError(
            "Refusing to submit internal summarization/control prompt to ChatGPT",
            400,
            "internal_prompt_rejected",
            "hermes_runtime",
        )


def _openai_messages_to_prompt(body: dict) -> str:
    """Flatten recent conversational context without leaking Hermes internals.

    The web composer should receive the user's work, not Hermes's very large
    internal system/tool prompt. Replaying that prompt made the editor spend
    tens of seconds processing text and exposed implementation instructions to
    the consumer chat. Keep only recent user/assistant conversation.
    """
    parts: list[str] = [
        "Answer the user's latest request directly and accurately. Use earlier turns only as conversational context."
    ]
    messages = body.get("messages")
    if isinstance(messages, list):
        user_messages = [
            item for item in messages
            if isinstance(item, dict) and item.get("role") == "user"
        ]
        non_user_messages = [
            item for item in messages
            if isinstance(item, dict) and item.get("role") != "user"
        ]
        if len(user_messages) == 1 and not non_user_messages:
            content = user_messages[0].get("content")
            if isinstance(content, str):
                _validate_prompt(content)
                return content
        conversational = [
            item for item in messages
            if isinstance(item, dict) and item.get("role") in {"user", "assistant"}
        ][-12:]
        for item in conversational:
            role = str(item.get("role") or "user").upper()
            content = item.get("content")
            if isinstance(content, str):
                text = content
            elif isinstance(content, list):
                chunks = []
                for part in content:
                    if not isinstance(part, dict):
                        continue
                    if part.get("type") in {"text", "input_text"}:
                        chunks.append(str(part.get("text") or ""))
                    elif part.get("type") in {"image_url", "input_image"}:
                        chunks.append("[An image was attached to this message.]")
                text = "\n".join(chunks)
            else:
                text = str(content or "")
            if text.strip():
                parts.append(f"{role}:\n{text.strip()}")
    if len(parts) == 1:
        prompt, _ = _adapter_payload_to_prompt(body)
        parts.append(f"USER:\n{prompt}")
    prompt = "\n\n".join(parts)
    _validate_prompt(prompt)
    return prompt


def _chat_completion_payload(text: str, model: str) -> dict:
    return {
        "id": f"chatcmpl-phantom-{uuid.uuid4().hex[:16]}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [{
            "index": 0,
            "message": {"role": "assistant", "content": text},
            "finish_reason": "stop",
        }],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        "provider": "chatgpt_plus_subscription",
    }


async def _write_chat_completion_stream(req: web.Request, text: str, model: str) -> web.StreamResponse:
    """Write a compact OpenAI-compatible chat.completion.chunk stream."""
    completion_id = f"chatcmpl-phantom-{uuid.uuid4().hex[:16]}"
    created = int(time.time())
    response = web.StreamResponse(
        status=200,
        headers={
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
    await response.prepare(req)

    async def send(data: dict) -> None:
        await response.write(f"data: {json.dumps(data, ensure_ascii=False)}\n\n".encode("utf-8"))

    await send({
        "id": completion_id,
        "object": "chat.completion.chunk",
        "created": created,
        "model": model,
        "choices": [{"index": 0, "delta": {"role": "assistant"}, "finish_reason": None}],
    })
    if text:
        await send({
            "id": completion_id,
            "object": "chat.completion.chunk",
            "created": created,
            "model": model,
            "choices": [{"index": 0, "delta": {"content": text}, "finish_reason": None}],
        })
    await send({
        "id": completion_id,
        "object": "chat.completion.chunk",
        "created": created,
        "model": model,
        "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
    })
    await response.write(b"data: [DONE]\n\n")
    await response.write_eof()
    return response


def _last_user_text(body: dict) -> str:
    messages = body.get("messages")
    if not isinstance(messages, list):
        return ""
    for item in reversed(messages):
        if not isinstance(item, dict) or item.get("role") != "user":
            continue
        content = item.get("content")
        if isinstance(content, str):
            return content.strip()
        if isinstance(content, list):
            return "\n".join(
                str(part.get("text") or "") for part in content
                if isinstance(part, dict) and part.get("type") in {"text", "input_text"}
            ).strip()
    return ""


def _is_image_request(text: str) -> bool:
    value = text.lower()
    return bool(re.search(
        r"\b(generate|create|make|draw|design|render|produce)\b.{0,80}"
        r"\b(image|picture|photo|illustration|artwork|logo|poster|graphic|thumbnail)\b",
        value,
        re.DOTALL,
    ))


def _is_explicit_image_request(body: dict, user_text: str, model: str) -> bool:
    metadata = body.get("metadata") if isinstance(body.get("metadata"), dict) else {}
    # Backward-compat: accept the old split model id, but do not advertise it.
    if model == "chatgpt-plus-image":
        return True
    if body.get("request_type") == "image" or metadata.get("request_type") == "image":
        return True
    return IMAGE_INTENT_FALLBACK and _is_image_request(user_text)


def _image_type(raw: bytes, content_type: str) -> tuple[str, str]:
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png", "png"
    if raw.startswith(b"\xff\xd8\xff"):
        return "image/jpeg", "jpg"
    if raw.startswith(b"RIFF") and raw[8:12] == b"WEBP":
        return "image/webp", "webp"
    lowered = content_type.lower()
    if "jpeg" in lowered:
        return "image/jpeg", "jpg"
    if "webp" in lowered:
        return "image/webp", "webp"
    raise ImageDownloadError("Downloaded asset is not a recognized PNG/JPEG/WebP image")


def _image_dimensions(raw: bytes) -> tuple[int, int]:
    try:
        from PIL import Image
        import io
        with Image.open(io.BytesIO(raw)) as img:
            return int(img.width), int(img.height)
    except Exception:
        # Magic bytes already validated; dimensions are best-effort if Pillow is absent.
        return 0, 0


def _store_image_b64(image_b64: str, content_type: str, request_id: str, start: float) -> dict:
    try:
        raw = base64.b64decode(str(image_b64), validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ImageDownloadError(f"Generated image payload was not valid base64: {exc}") from exc
    if len(raw) < 2048:
        raise ImageDownloadError(f"Generated image payload was too small: {len(raw)} bytes")
    mime_type, ext = _image_type(raw, content_type)
    width, height = _image_dimensions(raw)
    IMAGE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output = IMAGE_OUTPUT_DIR / f"chatgpt_plus_{time.strftime('%Y%m%d_%H%M%S')}_{request_id}.{ext}"
    tmp = output.with_suffix(output.suffix + ".tmp")
    tmp.write_bytes(raw)
    tmp.replace(output)
    if not output.exists() or output.stat().st_size < 2048:
        raise ImageDownloadError(f"Generated image file was not saved correctly: {output}")
    _log(request_id, "image", "IMAGE_DOWNLOADED", start, f"path={output} mime={mime_type} size={len(raw)} width={width} height={height}")
    return {
        "image_b64": image_b64,
        "content_type": mime_type,
        "mime_type": mime_type,
        "path": str(output),
        "width": width,
        "height": height,
    }


async def h_health(_req: web.Request) -> web.Response:
    return web.json_response({
        "ok": True,
        "service": "phantom-chatgpt-plus-backend",
        "version": SERVICE_VERSION,
        "browser": {
            "launched": _ctx is not None,
            "authenticated": _logged_in,
            "page_ready": _page is not None and not _page.is_closed() if _page else False,
            "busy": _lock.locked(),
            "headless": BROWSER_HEADLESS,
            "hidden_window": HIDE_BROWSER_WINDOW,
            "window": {"x": WINDOW_X, "y": WINDOW_Y, "width": WINDOW_WIDTH, "height": WINDOW_HEIGHT},
            "kind": BROWSER_KIND,
        },
        "browser_up": _ctx is not None,
        "logged_in": _logged_in,
        "profile_dir": str(PROFILE_DIR),
        "uptime_s": round(time.time() - _boot_time, 1) if _boot_time else 0,
        "last_error": _last_error,
        "last_request": _last_request,
    })


async def h_ask(req: web.Request) -> web.Response:
    global _last_error, _last_request
    request_id = _request_id()
    start = time.time()
    try:
        body = await req.json()
    except Exception:
        return web.json_response({"ok": False, "request_id": request_id, "error": "invalid json", "error_type": "invalid_json", "error_origin": "local_backend"}, status=400)
    prompt, effort = _adapter_payload_to_prompt(body)
    if not prompt.strip():
        return web.json_response({"ok": False, "request_id": request_id, "error": "empty prompt", "error_type": "invalid_argument", "error_origin": "local_backend"}, status=400)
    try:
        _validate_prompt(prompt)
        text = await ask_chatgpt(prompt, request_id, effort)
        _last_error = None
        _last_request = {"id": request_id, "type": "text", "ok": True, "elapsed_ms": int((time.time() - start) * 1000)}
        return web.json_response({"ok": True, "type": "text", "request_id": request_id, "text": text, "output_text": text, "message": text, "provider": "chatgpt_plus", "effort": effort, "elapsed_ms": _last_request["elapsed_ms"]})
    except BackendError as e:
        _last_error = e.message
        _last_request = {"id": request_id, "type": "text", "ok": False, "elapsed_ms": int((time.time() - start) * 1000)}
        _log(request_id, "text", "REQUEST_FAILED", start, f"{e.error_type}: {e.message}", logging.ERROR)
        return web.json_response({"ok": False, "request_id": request_id, "error": e.message, "error_type": e.error_type, "error_origin": e.error_origin}, status=e.status)
    except Exception as e:
        _last_error = str(e)
        _last_request = {"id": request_id, "type": "text", "ok": False, "elapsed_ms": int((time.time() - start) * 1000)}
        traceback.print_exc()
        _log(request_id, "text", "REQUEST_FAILED", start, str(e), logging.ERROR)
        return web.json_response({"ok": False, "request_id": request_id, "error": str(e), "error_type": "backend_error", "error_origin": "local_backend"}, status=502)


async def h_image(req: web.Request) -> web.Response:
    global _last_error, _last_request
    request_id = _request_id()
    start = time.time()
    try:
        body = await req.json()
    except Exception:
        return web.json_response({"ok": False, "request_id": request_id, "error": "invalid json", "error_type": "invalid_json", "error_origin": "local_backend"}, status=400)
    prompt, _effort = _adapter_payload_to_prompt(body)
    if not prompt.strip():
        return web.json_response({"ok": False, "request_id": request_id, "error": "empty prompt", "error_type": "invalid_argument", "error_origin": "local_backend"}, status=400)
    try:
        _validate_prompt(prompt)
        result = await image_chatgpt(prompt, request_id)
        _last_error = None
        elapsed_ms = int((time.time() - start) * 1000)
        _last_request = {"id": request_id, "type": "image", "ok": True, "elapsed_ms": elapsed_ms}
        payload = {k: v for k, v in result.items() if INCLUDE_IMAGE_B64 or k != "image_b64"}
        return web.json_response({"ok": True, "type": "image", "request_id": request_id, **payload, "provider": "chatgpt_plus", "elapsed_ms": elapsed_ms})
    except BackendError as e:
        _last_error = e.message
        _last_request = {"id": request_id, "type": "image", "ok": False, "elapsed_ms": int((time.time() - start) * 1000)}
        _log(request_id, "image", "REQUEST_FAILED", start, f"{e.error_type}: {e.message}", logging.ERROR)
        return web.json_response({"ok": False, "request_id": request_id, "error": e.message, "error_type": e.error_type, "error_origin": e.error_origin}, status=e.status)
    except Exception as e:
        _last_error = str(e)
        _last_request = {"id": request_id, "type": "image", "ok": False, "elapsed_ms": int((time.time() - start) * 1000)}
        traceback.print_exc()
        _log(request_id, "image", "REQUEST_FAILED", start, str(e), logging.ERROR)
        return web.json_response({"ok": False, "request_id": request_id, "error": str(e), "error_type": "backend_error", "error_origin": "local_backend"}, status=502)


async def h_models(_req: web.Request) -> web.Response:
    return web.json_response({
        "object": "list",
        "data": [
            {"id": "chatgpt-plus", "object": "model", "created": 0, "owned_by": "user-chatgpt-subscription", "context_length": 128000},
        ],
    })


async def h_chat_completions(req: web.Request) -> web.StreamResponse:
    """OpenAI-compatible endpoint used by PhantomBot's custom provider."""
    global _last_error, _last_request
    request_id = _request_id()
    start = time.time()
    try:
        body = await req.json()
    except Exception:
        return web.json_response({"error": {"message": "invalid json", "type": "invalid_json", "origin": "local_backend", "request_id": request_id}}, status=400)
    model = str(body.get("model") or "chatgpt-plus")
    stream = body.get("stream") is True
    effort = _request_effort(body)
    try:
        prompt = _openai_messages_to_prompt(body)
    except BackendError as exc:
        return web.json_response({"error": {"message": exc.message, "type": exc.error_type, "origin": exc.error_origin, "request_id": request_id}}, status=exc.status)
    if not prompt:
        return web.json_response({"error": {"message": "empty messages"}}, status=400)
    try:
        user_text = _last_user_text(body)
        if _is_explicit_image_request(body, user_text, model):
            _validate_prompt(user_text)
            image_result = await image_chatgpt(user_text, request_id)
            text = f"Generated with your ChatGPT Plus subscription.\n\nMEDIA:{image_result['path']}"
        else:
            text = await ask_chatgpt(prompt, request_id, effort)
        _last_error = None
        _last_request = {"id": request_id, "type": "image" if _is_explicit_image_request(body, _last_user_text(body), model) else "text", "ok": True, "elapsed_ms": int((time.time() - start) * 1000)}
    except BackendError as exc:
        _last_error = exc.message
        _last_request = {"id": request_id, "type": "chat_completion", "ok": False, "elapsed_ms": int((time.time() - start) * 1000)}
        _log(request_id, "chat_completion", "REQUEST_FAILED", start, f"{exc.error_type}: {exc.message}", logging.ERROR)
        return web.json_response(
            {"error": {"message": exc.message, "type": exc.error_type, "origin": exc.error_origin, "request_id": request_id}},
            status=exc.status,
        )
    except Exception as exc:
        _last_error = str(exc)
        _last_request = {"id": request_id, "type": "chat_completion", "ok": False, "elapsed_ms": int((time.time() - start) * 1000)}
        traceback.print_exc()
        return web.json_response(
            {"error": {"message": str(exc), "type": "chatgpt_plus_backend_error", "origin": "local_backend", "request_id": request_id}},
            status=502,
        )

    payload = _chat_completion_payload(text, model)
    if stream:
        return await _write_chat_completion_stream(req, text, model)
    return web.json_response(payload)


async def h_openai_images(req: web.Request) -> web.Response:
    """OpenAI-compatible image generation endpoint backed by ChatGPT Plus."""
    global _last_error, _last_request
    request_id = _request_id()
    start = time.time()
    try:
        body = await req.json()
    except Exception:
        return web.json_response({"error": {"message": "invalid json", "type": "invalid_json", "origin": "local_backend", "request_id": request_id}}, status=400)
    prompt = str(body.get("prompt") or "").strip()
    if not prompt:
        return web.json_response({"error": {"message": "empty prompt", "type": "invalid_argument", "origin": "local_backend", "request_id": request_id}}, status=400)
    try:
        _validate_prompt(prompt)
        result = await image_chatgpt(prompt, request_id)
        _last_error = None
        _last_request = {"id": request_id, "type": "image", "ok": True, "elapsed_ms": int((time.time() - start) * 1000)}
        return web.json_response({
            "created": int(time.time()),
            "data": [{"b64_json": result["image_b64"], "path": result["path"]}],
            "model": "chatgpt-plus",
            "provider": "chatgpt_plus_subscription",
            "request_id": request_id,
        })
    except BackendError as exc:
        _last_error = exc.message
        _last_request = {"id": request_id, "type": "image", "ok": False, "elapsed_ms": int((time.time() - start) * 1000)}
        _log(request_id, "image", "REQUEST_FAILED", start, f"{exc.error_type}: {exc.message}", logging.ERROR)
        return web.json_response(
            {"error": {"message": exc.message, "type": exc.error_type, "origin": exc.error_origin, "request_id": request_id}},
            status=exc.status,
        )
    except Exception as exc:
        _last_error = str(exc)
        _last_request = {"id": request_id, "type": "image", "ok": False, "elapsed_ms": int((time.time() - start) * 1000)}
        traceback.print_exc()
        return web.json_response(
            {"error": {"message": str(exc), "type": "chatgpt_plus_backend_error", "origin": "local_backend", "request_id": request_id}},
            status=502,
        )


async def on_startup(app: web.Application) -> None:
    try:
        await launch_browser()
    except Exception as e:
        print(f"[backend] launch failed: {e}", flush=True)
        traceback.print_exc()


async def on_cleanup(app: web.Application) -> None:
    global _ctx, _pw
    try:
        if _ctx:
            await _ctx.close()
        if _pw:
            await _pw.stop()
    except Exception:
        pass


def main() -> None:
    app = web.Application()
    app.router.add_get("/health", h_health)
    app.router.add_post("/ask", h_ask)
    app.router.add_post("/image", h_image)
    app.router.add_post("/assist", h_ask)  # alias so adapter can point straight here
    app.router.add_get("/v1/models", h_models)
    app.router.add_post("/v1/chat/completions", h_chat_completions)
    app.router.add_post("/v1/images/generations", h_openai_images)
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    print(f"[backend] listening on http://{HOST}:{PORT}", flush=True)
    web.run_app(app, host=HOST, port=PORT, print=None)


if __name__ == "__main__":
    main()
