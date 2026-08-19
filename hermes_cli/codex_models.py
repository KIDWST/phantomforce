"""Codex model discovery from API, local cache, and config."""

from __future__ import annotations

import base64
import json
import logging
import threading
import time
from pathlib import Path
from typing import List, Optional

import os

logger = logging.getLogger(__name__)

DEFAULT_CODEX_MODELS: List[str] = [
    # GPT-5.6 series (Sol/Terra/Luna + -pro high-effort modes) — GA 2026-07-09
    # (previewed 2026-06-26).
    "gpt-5.6-sol",
    "gpt-5.6-sol-pro",
    "gpt-5.6-terra",
    "gpt-5.6-terra-pro",
    "gpt-5.6-luna",
    "gpt-5.6-luna-pro",
    "gpt-5.5",
    "gpt-5.4-mini",
    "gpt-5.4",
    "gpt-5.3-codex",
    # gpt-5.3-codex-spark is in research preview and is exposed *only* via
    # the Codex CLI / OAuth backend (chatgpt.com/backend-api/codex/models)
    # for ChatGPT Pro subscribers. It is NOT available in the public OpenAI
    # API, so it intentionally stays out of the "openai" provider catalog
    # in hermes_cli/models.py — only the openai-codex (OAuth) provider
    # surfaces it. The Codex backend reports ``supported_in_api: false`` for
    # this slug; that flag describes API availability, not Codex backend
    # availability, so the fetch/cache code paths below intentionally do
    # not filter on it. PR #12994 removed this entry on the assumption it
    # was unsupported — that was wrong; restored here. Keep it in the
    # curated fallback so Pro users still see Spark in `/model` when live
    # discovery is unavailable (offline first run, transient API failure).
    "gpt-5.3-codex-spark",
    # NOTE: gpt-5.2-codex / gpt-5.1-codex-max / gpt-5.1-codex-mini were
    # previously listed here but the chatgpt.com Codex backend returns
    # HTTP 400 "The '<model>' model is not supported when using Codex with
    # a ChatGPT account." for all three on every ChatGPT Pro account we've
    # tested (verified live 2026-05-27). Keeping them in the fallback list
    # leaked dead slugs into /model when live discovery was unavailable
    # (transient API failure, first-run before refresh) and surfaced HTTP 400
    # crashes on selection. The Codex CLI public catalog still references
    # these slugs, which is why they survived previously — but those entries
    # describe the public OpenAI API, not the OAuth-backed Codex backend
    # Hermes uses. Removed here. If OpenAI re-enables them on Codex backend,
    # live discovery will pick them up automatically via _fetch_models_from_api.
]

_FORWARD_COMPAT_TEMPLATE_MODELS: List[tuple[str, tuple[str, ...]]] = [
    ("gpt-5.6-sol", ("gpt-5.5", "gpt-5.4")),
    ("gpt-5.6-sol-pro", ("gpt-5.5", "gpt-5.4")),
    ("gpt-5.6-terra", ("gpt-5.5", "gpt-5.4")),
    ("gpt-5.6-terra-pro", ("gpt-5.5", "gpt-5.4")),
    ("gpt-5.6-luna", ("gpt-5.5", "gpt-5.4")),
    ("gpt-5.6-luna-pro", ("gpt-5.5", "gpt-5.4")),
    ("gpt-5.5", ("gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex")),
    ("gpt-5.4-mini", ("gpt-5.3-codex",)),
    ("gpt-5.4", ("gpt-5.3-codex",)),
    # Surface Spark whenever any compatible Codex template is present so
    # accounts hitting the live endpoint with an older lineup still see
    # Spark in the picker. Backend gates real availability by ChatGPT Pro
    # entitlement; Hermes does not.
    ("gpt-5.3-codex-spark", ("gpt-5.3-codex",)),
]


def _add_forward_compat_models(model_ids: List[str]) -> List[str]:
    """Add Clawdbot-style synthetic forward-compat Codex models.

    If a newer Codex slug isn't returned by live discovery, surface it when an
    older compatible template model is present. This mirrors Clawdbot's
    synthetic catalog / forward-compat behavior for GPT-5 Codex variants.
    """
    ordered: List[str] = []
    seen: set[str] = set()
    for model_id in model_ids:
        if model_id not in seen:
            ordered.append(model_id)
            seen.add(model_id)

    for synthetic_model, template_models in _FORWARD_COMPAT_TEMPLATE_MODELS:
        if synthetic_model in seen:
            continue
        if any(template in seen for template in template_models):
            ordered.append(synthetic_model)
            seen.add(synthetic_model)

    return ordered


def _extract_chatgpt_account_id(access_token: str) -> Optional[str]:
    """Best-effort extraction of ``chatgpt_account_id`` from the OAuth JWT.

    The Codex backend requires the ``ChatGPT-Account-Id`` header for the
    per-account catalog. Without it, ``GET /backend-api/codex/models``
    returns ``{"models":[]}`` (HTTP 200) — which masquerades as "no
    models available" and silently degrades the picker to the curated
    fallback list. The request-side path in ``auxiliary_client.py``
    already extracts the same claim; this mirrors that logic here so the
    probe sees the same catalog the request path will actually use.

    Returns ``None`` on any parse error — the probe then degrades
    gracefully to the unauthenticated fallback list instead of crashing.
    """
    try:
        parts = access_token.split(".")
        if len(parts) < 2:
            return None
        payload_b64 = parts[1] + "=" * (-len(parts[1]) % 4)
        claims = json.loads(base64.urlsafe_b64decode(payload_b64))
        acct_id = (
            claims.get("https://api.openai.com/auth", {}).get("chatgpt_account_id")
            if isinstance(claims, dict)
            else None
        )
        return acct_id if isinstance(acct_id, str) and acct_id else None
    except Exception:
        return None


def _fetch_models_from_api(access_token: str) -> List[str]:
    """Fetch available models from the Codex API. Returns visible models sorted by priority."""
    try:
        import httpx
        headers = {"Authorization": f"Bearer {access_token}"}
        acct_id = _extract_chatgpt_account_id(access_token)
        if acct_id:
            headers["ChatGPT-Account-Id"] = acct_id
        resp = httpx.get(
            "https://chatgpt.com/backend-api/codex/models?client_version=1.0.0",
            headers=headers,
            timeout=10,
        )
        if resp.status_code != 200:
            return []
        data = resp.json()
        entries = data.get("models", []) if isinstance(data, dict) else []
    except Exception as exc:
        logger.debug("Failed to fetch Codex models from API: %s", exc)
        return []

    sortable = []
    for item in entries:
        if not isinstance(item, dict):
            continue
        slug = item.get("slug")
        if not isinstance(slug, str) or not slug.strip():
            continue
        slug = slug.strip()
        # Codex CLI's catalog uses ``supported_in_api`` for the public OpenAI
        # API, not for the OAuth-backed Codex backend that this provider uses.
        # Some valid Codex CLI models (for example gpt-5.3-codex-spark) are
        # marked false here but are still accepted by the Codex route.
        visibility = item.get("visibility", "")
        if isinstance(visibility, str) and visibility.strip().lower() in {"hide", "hidden"}:
            continue
        priority = item.get("priority")
        rank = int(priority) if isinstance(priority, (int, float)) else 10_000
        sortable.append((rank, slug))

    sortable.sort(key=lambda x: (x[0], x[1]))
    return _add_forward_compat_models([slug for _, slug in sortable])


def _read_default_model(codex_home: Path) -> Optional[str]:
    config_path = codex_home / "config.toml"
    if not config_path.exists():
        return None
    try:
        import tomllib
    except Exception:
        return None
    try:
        payload = tomllib.loads(config_path.read_text(encoding="utf-8"))
    except Exception:
        return None
    model = payload.get("model") if isinstance(payload, dict) else None
    if isinstance(model, str) and model.strip():
        return model.strip()
    return None


def _read_cache_models(codex_home: Path) -> List[str]:
    cache_path = codex_home / "models_cache.json"
    if not cache_path.exists():
        return []
    try:
        raw = json.loads(cache_path.read_text(encoding="utf-8"))
    except Exception:
        return []

    entries = raw.get("models") if isinstance(raw, dict) else None
    sortable = []
    if isinstance(entries, list):
        for item in entries:
            if not isinstance(item, dict):
                continue
            slug = item.get("slug")
            if not isinstance(slug, str) or not slug.strip():
                continue
            slug = slug.strip()
            # Do not filter on ``supported_in_api`` here.  It describes the
            # public OpenAI API, while Hermes openai-codex talks to the same
            # OAuth-backed Codex backend as Codex CLI.
            visibility = item.get("visibility")
            if isinstance(visibility, str) and visibility.strip().lower() in {"hide", "hidden"}:
                continue
            priority = item.get("priority")
            rank = int(priority) if isinstance(priority, (int, float)) else 10_000
            sortable.append((rank, slug))

    sortable.sort(key=lambda item: (item[0], item[1]))
    deduped: List[str] = []
    for _, slug in sortable:
        if slug not in deduped:
            deduped.append(slug)
    return deduped


_refresh_lock = threading.Lock()
_refresh_in_progress: bool = False
_refresh_start_count: int = 0
_last_refresh_attempt: float = 0.0
_last_successful_refresh: float = 0.0
_last_refresh_error: Optional[str] = None
_cache_present: bool = False
_cache_age: Optional[float] = None


def _background_refresh_worker(access_token: Optional[str], codex_home: Path) -> None:
    """Background worker that fetches live Codex models and caches them.

    Runs on a daemon thread so the synchronous picker path never blocks.
    De-duplication via ``_refresh_in_progress`` ensures at most one worker.
    """
    global _refresh_in_progress, _last_refresh_attempt, _last_successful_refresh, _last_refresh_error
    try:
        if access_token:
            with _refresh_lock:
                _last_refresh_attempt = time.time()
            api_models = _fetch_models_from_api(access_token)
            if api_models:
                _write_cache_models(codex_home, api_models)
                with _refresh_lock:
                    _last_successful_refresh = time.time()
                    _last_refresh_error = None
                return
            with _refresh_lock:
                _last_refresh_error = "Codex live discovery returned no models"
    except Exception as e:  # noqa: BLE001
        with _refresh_lock:
            _last_refresh_error = str(e)
        logger.debug("Background Codex refresh failed: %s", e)
    finally:
        with _refresh_lock:
            _refresh_in_progress = False


def _maybe_start_background_refresh(access_token: Optional[str], codex_home: Path) -> bool:
    """Start a single de-duplicated background Codex refresh, if none running."""
    global _refresh_in_progress, _refresh_start_count
    with _refresh_lock:
        if _refresh_in_progress:
            return False
        _refresh_in_progress = True
        _refresh_start_count += 1
    try:
        thread = threading.Thread(
            target=_background_refresh_worker,
            args=(access_token, codex_home),
            name="codex-models-background-refresh",
            daemon=True,
        )
        thread.start()
        return True
    except Exception:
        with _refresh_lock:
            _refresh_in_progress = False
        return False


def get_codex_refresh_state() -> dict:
    """Return read-only diagnostics for the Codex model cache (no I/O)."""
    with _refresh_lock:
        return {
            "cache_present": _cache_present,
            "cache_age": _cache_age,
            "ttl": _CODEX_CACHE_TTL_SECONDS,
            "refresh_in_progress": _refresh_in_progress,
            "background_refresh_count": _refresh_start_count,
            "last_refresh_attempt": _last_refresh_attempt or None,
            "last_successful_refresh": _last_successful_refresh or None,
            "last_refresh_error": _last_refresh_error,
        }


def _codex_home_path() -> Path:
    codex_home_str = os.getenv("CODEX_HOME", "").strip() or str(Path.home() / ".codex")
    return Path(codex_home_str).expanduser()


def _write_cache_models(codex_home: Path, model_ids: List[str]) -> None:
    """Persist discovered model IDs to the Codex models cache file (atomically)."""
    try:
        from utils import atomic_json_write

        cache_path = codex_home / "models_cache.json"
        payload = [{"slug": slug} for slug in model_ids]
        atomic_json_write(cache_path, {"models": payload})
        global _cache_present, _cache_age
        with _refresh_lock:
            _cache_present = bool(model_ids)
            _cache_age = 0.0
    except Exception as exc:
        logger.debug("Failed to write Codex models cache: %s", exc)


def get_codex_model_ids(
    access_token: Optional[str] = None,
    *,
    force_refresh: bool = False,
) -> List[str]:
    """Return available Codex model IDs, cache-first; never blocks on network.

    Resolution order on the synchronous path (``force_refresh=False``) — all
    local, zero outbound HTTPS:

      1. Local ``models_cache.json`` (what live discovery wrote last time)
      2. ``config.toml`` default model
      3. Hardcoded curated ``DEFAULT_CODEX_MODELS`` list

    When a live API fetch is possible (an ``access_token`` is provided) and
    the result is not already cached in this process, a single de-duplicated
    background worker refreshes the live catalog asynchronously.  Network or
    SSL failure never blocks or slows the caller.

    ``force_refresh=True`` performs a blocking live fetch (explicit intent).
    """
    global _last_refresh_attempt, _last_successful_refresh, _last_refresh_error
    codex_home = _codex_home_path()
    if force_refresh:
        if not access_token:
            return _add_forward_compat_models(
                _merge_codex_local_sources(codex_home)
            )
        with _refresh_lock:
            _last_refresh_attempt = time.time()
        api_models = _fetch_models_from_api(access_token)
        if api_models:
            _write_cache_models(codex_home, api_models)
            with _refresh_lock:
                _last_successful_refresh = time.time()
                _last_refresh_error = None
            return _add_forward_compat_models(api_models)
        with _refresh_lock:
            _last_refresh_error = "Codex live discovery returned no models"
        return _add_forward_compat_models(_merge_codex_local_sources(codex_home))

    ordered = _merge_codex_local_sources(codex_home)

    # If a live refresh is possible and the local cache is missing/stale, kick
    # off a single background refresh so the picker warms without blocking.
    if access_token and _codex_cache_stale(codex_home):
        _maybe_start_background_refresh(access_token, codex_home)

    return _add_forward_compat_models(ordered)


_CODEX_CACHE_TTL_SECONDS = 3600  # 1 hour


def _codex_cache_stale(codex_home: Path) -> bool:
    """Return True when the Codex models cache is missing or older than TTL."""
    cache_path = codex_home / "models_cache.json"
    try:
        age = time.time() - cache_path.stat().st_mtime
        return age >= _CODEX_CACHE_TTL_SECONDS
    except Exception:
        return True


def _merge_codex_local_sources(codex_home: Path) -> List[str]:
    """Merge local Codex model sources (config default + cache + curated)."""
    global _cache_present, _cache_age
    ordered: List[str] = []
    default_model = _read_default_model(codex_home)
    if default_model:
        ordered.append(default_model)

    cached = _read_cache_models(codex_home)
    cache_path = codex_home / "models_cache.json"
    try:
        cache_age = max(0.0, time.time() - cache_path.stat().st_mtime)
    except Exception:
        cache_age = None
    with _refresh_lock:
        _cache_present = bool(cached)
        _cache_age = cache_age
    for model_id in cached:
        if model_id not in ordered:
            ordered.append(model_id)

    for model_id in DEFAULT_CODEX_MODELS:
        if model_id not in ordered:
            ordered.append(model_id)
    return ordered
