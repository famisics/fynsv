#!/usr/bin/env bash

SESSION_PREFIX="claude-remote"
CACHE_DIR="${HOME}/.cache/claude-remote"

if [[ -t 2 ]]; then
  C_RED=$'\033[31m'
  C_YELLOW=$'\033[33m'
  C_GREEN=$'\033[32m'
  C_DIM=$'\033[2m'
  C_RESET=$'\033[0m'
else
  C_RED=''; C_YELLOW=''; C_GREEN=''; C_DIM=''; C_RESET=''
fi

log_info()  { printf '%s[info]%s %s\n'  "$C_DIM"    "$C_RESET" "$*" >&2; }
log_ok()    { printf '%s[ok]%s   %s\n'  "$C_GREEN"  "$C_RESET" "$*" >&2; }
log_warn()  { printf '%s[warn]%s %s\n'  "$C_YELLOW" "$C_RESET" "$*" >&2; }
log_error() { printf '%s[err]%s  %s\n'  "$C_RED"    "$C_RESET" "$*" >&2; }

die() {
  log_error "$*"
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

session_name_for() {
  local kind="$1" name="$2"
  local safe="${name//[.\/:@ ]/-}"
  printf '%s-%s-%s' "$SESSION_PREFIX" "$kind" "$safe"
}

session_exists() {
  tmux has-session -t "$1" 2>/dev/null
}

# 各 bin/remote-* スクリプトから 1 行で呼ぶ初期化ヘルパ。
# 副作用: tmux 必須化、ターゲット解析、TARGET_SESSION の設定。
remote_bootstrap() {
  require_cmd tmux
  parse_target "${1-}"
  TARGET_SESSION="$(session_name_for "$TARGET_KIND" "$TARGET_NAME")"
}
