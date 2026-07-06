#!/usr/bin/env bash
# auto-sync — keeps the live admin app (admin.phantomforce.online) current with
# GitHub main, unattended. Fetches origin/main; when it moves, fast-forwards
# the checkout and mirrors app/ to the live dir via sync-admin-app.sh.
#
# One-time install on the admin box (run from the repo checkout):
#   PF_ADMIN_APP_DIR=/path/to/live/admin/app PF_SYNC_INIT=1 ops/admin-live/auto-sync.sh
#
# Then make it automatic (every 5 minutes) — add ONE line with `crontab -e`:
#   */5 * * * * PF_ADMIN_APP_DIR=/path/to/live/admin/app /path/to/repo/ops/admin-live/auto-sync.sh >> "$HOME/pf-admin-sync.log" 2>&1
#
# Safety: refuses to touch a dirty checkout or a non-main branch, fast-forward
# only (never rewrites local history), and uses a lock so overlapping cron
# firings can't collide.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
LOCK_FILE="${TMPDIR:-/tmp}/pf-admin-auto-sync.lock"

log() { printf '[%s] auto-sync: %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$*"; }
fail() { log "ERROR: $*" >&2; exit 1; }

# never run two syncs at once (cron overlap)
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE"
  flock -n 9 || { log "another sync is running; skipping"; exit 0; }
fi

command -v git >/dev/null 2>&1 || fail "git not found"
[[ -n "${PF_ADMIN_APP_DIR:-}" ]] || fail "PF_ADMIN_APP_DIR must point to the live admin app directory"
[[ -d "$REPO_ROOT/.git" || -f "$REPO_ROOT/.git" ]] || fail "not a git checkout: $REPO_ROOT"

cd "$REPO_ROOT"

# the box's checkout must be a clean main — we never clobber local work
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[[ "$BRANCH" == "main" ]] || fail "checkout is on '$BRANCH', not main — switch it once with: git checkout main"
# untracked files (logs, scratch) are fine; only real edits to tracked files block
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || fail "checkout has local changes — commit or stash them first"

git fetch --quiet origin main || fail "could not fetch origin/main (network?)"

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse origin/main)"

mirror_commit() {
  python3 -c "import json;print(json.load(open('$PF_ADMIN_APP_DIR/.phantomforce-sync.json'))['commit'])" 2>/dev/null \
    || sed -n 's/.*"commit": *"\([0-9a-f]*\)".*/\1/p' "$PF_ADMIN_APP_DIR/.phantomforce-sync.json" 2>/dev/null \
    || echo ""
}

if [[ "$LOCAL" == "$REMOTE" ]]; then
  # nothing new on GitHub — but converge the mirror if it lags the checkout
  # (a prior sync failed mid-way, someone pulled by hand, or first install)
  MIRRORED="$(mirror_commit)"
  if [[ "$MIRRORED" == "$LOCAL" ]]; then
    log "up to date at ${LOCAL:0:7}"
    exit 0
  fi
  if [[ -f "$PF_ADMIN_APP_DIR/.phantomforce-sync.json" || "${PF_SYNC_INIT:-}" == "1" ]]; then
    log "repo current at ${LOCAL:0:7} but mirror at '${MIRRORED:0:7}'; re-mirroring"
    exec "$SCRIPT_DIR/sync-admin-app.sh"
  fi
  log "up to date at ${LOCAL:0:7} (mirror not initialised — run once with PF_SYNC_INIT=1)"
  exit 0
fi

log "main moved ${LOCAL:0:7} -> ${REMOTE:0:7}; updating"
git merge --ff-only origin/main || fail "fast-forward failed — resolve manually on the box"

exec "$SCRIPT_DIR/sync-admin-app.sh"
