#!/usr/bin/env bash
# Target syntax: see claude-remote/README.md.

_PARSE_TARGET_LIB_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
CLAUDE_REMOTE_ROOT="$(cd -- "$_PARSE_TARGET_LIB_DIR/../.." &>/dev/null && pwd)"

_conf_get() {
  # key=value 形式の設定ファイルから 1 キーだけ拾う (source しないことで任意コード実行を回避)
  local conf="$1" key="$2"
  awk -F= -v k="$key" '
    /^[[:space:]]*#/ { next }
    $1 == k { sub(/^[^=]*=/, ""); print; exit }
  ' "$conf"
}

parse_target() {
  local raw="${1-}"
  [[ -n "$raw" ]] || die "target is required (e.g. ssh:pve01, serial:ix2215)"

  TARGET_KIND=""
  TARGET_NAME=""
  TARGET_SSH_HOST=""
  TARGET_SERIAL_DEVICE=""
  TARGET_SERIAL_BAUD=""

  case "$raw" in
    ssh:*)
      TARGET_KIND="ssh"
      TARGET_SSH_HOST="${raw#ssh:}"
      [[ -n "$TARGET_SSH_HOST" ]] || die "empty ssh host in target: $raw"
      TARGET_NAME="$TARGET_SSH_HOST"
      ;;
    serial:*)
      TARGET_KIND="serial"
      local spec="${raw#serial:}"
      [[ -n "$spec" ]] || die "empty serial spec in target: $raw"

      if [[ "$spec" == /* ]]; then
        # ad-hoc: /dev/path[@baud]
        if [[ "$spec" =~ @([0-9]+)$ ]]; then
          TARGET_SERIAL_BAUD="${BASH_REMATCH[1]}"
          TARGET_SERIAL_DEVICE="${spec%@*}"
        else
          TARGET_SERIAL_BAUD="9600"
          TARGET_SERIAL_DEVICE="$spec"
        fi
        TARGET_NAME="$(basename "$TARGET_SERIAL_DEVICE")-$TARGET_SERIAL_BAUD"
      else
        local conf="$CLAUDE_REMOTE_ROOT/targets/serial/${spec}.conf"
        [[ -f "$conf" ]] || die "serial target conf not found: $conf"
        TARGET_NAME="$spec"
        TARGET_SERIAL_DEVICE="$(_conf_get "$conf" device)"
        TARGET_SERIAL_BAUD="$(_conf_get "$conf" baud)"
        [[ -n "$TARGET_SERIAL_BAUD" ]] || TARGET_SERIAL_BAUD="9600"
        [[ -n "$TARGET_SERIAL_DEVICE" ]] || die "device not set in $conf"
        # device に glob を含む場合は実デバイスへ解決 (USB ポート由来のサフィックス差を吸収)。
        if [[ "$TARGET_SERIAL_DEVICE" == *[*?[]* ]]; then
          local matches=()
          # shellcheck disable=SC2206
          IFS=$'\n' matches=($(compgen -G "$TARGET_SERIAL_DEVICE" 2>/dev/null)) || true
          case "${#matches[@]}" in
            0) die "no serial device matched glob '$TARGET_SERIAL_DEVICE' (in $conf)" ;;
            1) TARGET_SERIAL_DEVICE="${matches[0]}" ;;
            *) die "serial device glob '$TARGET_SERIAL_DEVICE' is ambiguous: ${matches[*]}" ;;
          esac
        fi
      fi
      ;;
    *)
      die "unknown target syntax: $raw (expected ssh:<host> or serial:<name>)"
      ;;
  esac
}
