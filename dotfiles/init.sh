#!/bin/bash
set -euo pipefail

# 対象ユーザーで実行する。特権が要る箇所だけ sudo を使う。
# sudo で丸ごと実行すると fnm/bun が root のホームに入り、ユーザーから使えなくなる。
if [[ $EUID -eq 0 ]]; then
  echo "do not run as root. run as the target user: bash init.sh" >&2
  exit 1
fi

sudo apt-get update
sudo apt-get install -y zsh tmux fzf fd-find git curl unzip

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
# .zshrc 管理の PATH は bash 実行中の init.sh には効かないため、判定前に通しておく
export PATH="$HOME/.local/share/fnm:$PATH"
if command -v fnm &>/dev/null; then
  echo "skip: fnm (already installed)"
else
  curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell
fi
eval "$(fnm env --use-on-cd --shell bash)"
# fnm 管理下に Node がまだ無ければ LTS を入れる (既にあれば再ダウンロードしない)
if fnm ls 2>/dev/null | grep -qE 'v[0-9]'; then
  echo "skip: node (already installed)"
else
  fnm install --lts
fi
# default 設定は冪等。fnm env が指す symlink を切り替えて node/npm を PATH に出す
fnm default lts-latest

# bun (PATH は .zshrc が管理するので、bash 実行中はバイナリ実体で導入済みを判定する)
if [[ -x "$HOME/.bun/bin/bun" ]] || command -v bun &>/dev/null; then
  echo "skip: bun (already installed)"
else
  curl -fsSL https://bun.sh/install | bash
fi

# pnpm (Node 同梱の corepack で有効化。standalone バイナリの libatomic 依存を避けられる)
if command -v pnpm &>/dev/null; then
  echo "skip: pnpm (already installed)"
else
  corepack enable pnpm
fi

# ni (パッケージマネージャ非依存の ni/nr/nlx エイリアス)
if command -v ni &>/dev/null; then
  echo "skip: ni (already installed)"
else
  npm i -g @antfu/ni
fi

# デフォルトシェルを zsh に変更
zsh_path="$(which zsh)"
if [[ "$(getent passwd "$USER" | cut -d: -f7)" != "$zsh_path" ]]; then
  sudo chsh -s "$zsh_path" "$USER"
fi

echo "init complete. run 'exec zsh' to start zsh."
