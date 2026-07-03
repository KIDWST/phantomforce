#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
SOURCE_DIR="${REPO_ROOT}/app"

fail() {
  printf 'sync-admin-app: %s\n' "$*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}

normalize_path() {
  local input="$1"
  if [[ "$input" =~ ^([A-Za-z]):[\\/](.*)$ ]]; then
    local drive="${BASH_REMATCH[1],,}"
    local rest="${BASH_REMATCH[2]}"
    rest="${rest//\\//}"
    printf '/mnt/%s/%s\n' "$drive" "$rest"
    return
  fi
  printf '%s\n' "$input"
}

git_repo() {
  if git -C "$REPO_ROOT" "$@" 2>/dev/null; then
    return 0
  fi

  if [[ -f "$REPO_ROOT/.git" ]] && grep -q "^gitdir:" "$REPO_ROOT/.git"; then
    local git_dir
    git_dir="$(sed -n 's/^gitdir: //p' "$REPO_ROOT/.git" | head -n 1)"
    git_dir="$(normalize_path "$git_dir")"
    GIT_DIR="$git_dir" GIT_WORK_TREE="$REPO_ROOT" git "$@"
    return
  fi

  git -C "$REPO_ROOT" "$@"
}

need_cmd git
need_cmd find
need_cmd cp
need_cmd rm
need_cmd realpath
need_cmd date

[[ -d "$SOURCE_DIR" ]] || fail "source app directory not found: $SOURCE_DIR"
[[ -f "$SOURCE_DIR/index.html" ]] || fail "source index.html not found: $SOURCE_DIR/index.html"
grep -q "data-phantom" "$SOURCE_DIR/index.html" || fail "source index.html is not the Phantom shell; data-phantom missing"

LIVE_INPUT="${PF_ADMIN_APP_DIR:-}"
[[ -n "$LIVE_INPUT" ]] || fail "PF_ADMIN_APP_DIR must point to the live admin.phantomforce.online/app directory"

NORMALIZED_LIVE_INPUT="$(normalize_path "$LIVE_INPUT")"
case "$NORMALIZED_LIVE_INPUT" in
  /*) ;;
  *) fail "PF_ADMIN_APP_DIR must be an absolute path: $LIVE_INPUT" ;;
esac

LIVE_DIR="$(realpath -m "$NORMALIZED_LIVE_INPUT")"
SOURCE_REAL="$(realpath -m "$SOURCE_DIR")"

[[ "$LIVE_DIR" != "$SOURCE_REAL" ]] || fail "live directory cannot be the repo source app directory"
[[ "$LIVE_DIR" != "/" ]] || fail "refusing to sync to filesystem root"
[[ "$LIVE_DIR" != "$REPO_ROOT" ]] || fail "refusing to sync to repo root"
[[ "$LIVE_DIR" != "$HOME" ]] || fail "refusing to sync to HOME"

if [[ ! -d "$LIVE_DIR" ]]; then
  [[ "${PF_SYNC_INIT:-}" == "1" ]] || fail "live directory does not exist; rerun once with PF_SYNC_INIT=1"
  mkdir -p "$LIVE_DIR"
fi

MANIFEST="$LIVE_DIR/.phantomforce-sync.json"
if [[ ! -f "$MANIFEST" && "${PF_SYNC_INIT:-}" != "1" ]]; then
  fail "missing $MANIFEST; rerun once with PF_SYNC_INIT=1 to claim this mirror directory"
fi

printf 'sync-admin-app: source=%s\n' "$SOURCE_REAL"
printf 'sync-admin-app: live=%s\n' "$LIVE_DIR"

find "$LIVE_DIR" -mindepth 1 -maxdepth 1 ! -name ".phantomforce-sync.json" -exec rm -rf -- {} +
cp -R "$SOURCE_DIR"/. "$LIVE_DIR"/

COMMIT="$(git_repo rev-parse HEAD)"
BRANCH="$(git_repo rev-parse --abbrev-ref HEAD)"
SYNCED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

cat >"$MANIFEST" <<JSON
{
  "source": $(json_escape "$SOURCE_REAL"),
  "live": $(json_escape "$LIVE_DIR"),
  "branch": $(json_escape "$BRANCH"),
  "commit": $(json_escape "$COMMIT"),
  "synced_at": $(json_escape "$SYNCED_AT")
}
JSON

cmp -s "$SOURCE_DIR/index.html" "$LIVE_DIR/index.html" || fail "index.html did not mirror correctly"
cmp -s "$SOURCE_DIR/js/main.js" "$LIVE_DIR/js/main.js" || fail "js/main.js did not mirror correctly"

printf 'sync-admin-app: mirrored repo app to live admin app at commit %s\n' "$COMMIT"
