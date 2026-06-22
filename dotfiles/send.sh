#!/bin/bash
set -euo pipefail

host="${1:?Usage: $0 <host>}"
dir="$(cd "$(dirname "$0")" && pwd)"

scp "$dir/.zshrc" "$host:~/.zshrc"
scp "$dir/.gitconfig" "$host:~/.gitconfig"
scp "$dir/init.sh" "$host:~/init.sh"
scp ~/.p10k.zsh "$host:~/.p10k.zsh"
ssh "$host" 'mkdir -p ~/.claude'
local_claude="$HOME/.claude"
scp "$local_claude/CLAUDE.md" "$host:~/.claude/CLAUDE.md"
scp "$local_claude/settings.json" "$host:~/.claude/settings.json"
scp -r "$local_claude/commands" "$host:~/.claude/"
scp -r "$local_claude/skills" "$host:~/.claude/"
scp "$local_claude/statusline.sh" "$host:~/.claude/statusline.sh"
ssh "$host" 'rm -rf ~/.oh-my-zsh'
tar -C ~ \
  --no-xattrs \
  --no-mac-metadata \
  --exclude='.git' \
  -cf - \
  .oh-my-zsh/oh-my-zsh.sh \
  .oh-my-zsh/lib \
  .oh-my-zsh/tools/check_for_upgrade.sh \
  .oh-my-zsh/plugins/git \
  .oh-my-zsh/custom/themes/powerlevel10k \
  | ssh "$host" 'tar -C ~ -xf -'

echo "sent dotfiles to $host"
