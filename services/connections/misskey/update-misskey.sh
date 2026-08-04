#!/bin/sh
# misskey-web (LXC 210) で root として実行する。
# 使い方: ./update-misskey.sh <tag>  (例: ./update-misskey.sh 2026.6.0)
set -eu

TAG="${1:?usage: update-misskey.sh <tag>}"

sudo -u misskey -H bash -lc "
  set -eu
  cd /opt/misskey
  git fetch --tags
  git checkout '$TAG'
  pnpm install --frozen-lockfile
  NODE_ENV=production pnpm run build
  NODE_ENV=production pnpm run migrate
"

systemctl restart misskey
journalctl -u misskey -n 50 --no-pager
