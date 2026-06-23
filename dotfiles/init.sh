#!/bin/bash
set -euo pipefail

# 対象ユーザーで実行する。特権が要る箇所だけ sudo を使う。
# sudo で丸ごと実行すると fnm/bun が root のホームに入り、ユーザーから使えなくなる。
if [[ $EUID -eq 0 ]]; then
  echo "do not run as root. run as the target user: bash init.sh" >&2
  exit 1
fi

sudo apt-get update
sudo apt-get install -y zsh fzf fd-find git curl unzip

# Debian は fd-find を fdfind としてインストールする
if command -v fdfind &>/dev/null && ! command -v fd &>/dev/null; then
  sudo ln -s "$(which fdfind)" /usr/local/bin/fd
fi

# ghq
if ! command -v ghq &>/dev/null; then
  tmpdir=$(mktemp -d)
  curl -sL "https://github.com/x-motemen/ghq/releases/latest/download/ghq_linux_amd64.zip" -o "$tmpdir/ghq.zip"
  unzip -o "$tmpdir/ghq.zip" -d "$tmpdir"
  sudo mv "$tmpdir/ghq_linux_amd64/ghq" /usr/local/bin/ghq
  rm -rf "$tmpdir"
fi

# gh
if ! command -v gh &>/dev/null; then
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg 2>/dev/null
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y gh
fi

# fnm + Node.js (PATH は .zshrc が管理するので --skip-shell で rc を汚さない)
if ! command -v fnm &>/dev/null; then
  curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell
fi
export PATH="$HOME/.local/share/fnm:$PATH"
eval "$(fnm env --use-on-cd --shell bash)"
fnm install --lts
fnm default lts-latest

# bun
if ! command -v bun &>/dev/null; then
  curl -fsSL https://bun.sh/install | bash
fi

# pnpm (Node 同梱の corepack で有効化。standalone バイナリの libatomic 依存を避けられる)
if ! command -v pnpm &>/dev/null; then
  corepack enable pnpm
fi

# デフォルトシェルを zsh に変更
zsh_path="$(which zsh)"
if [[ "$(getent passwd "$USER" | cut -d: -f7)" != "$zsh_path" ]]; then
  sudo chsh -s "$zsh_path" "$USER"
fi

echo "init complete. run 'exec zsh' to start zsh."
