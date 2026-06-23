# ! path -------------------------------------------------------------------------------

export PATH="$HOME/.local/bin:$PATH"

# ! fnm --------------------------------------------------------------------------------

export PATH="$HOME/.local/share/fnm:$PATH"
(( ${+commands[fnm]} )) && eval "$(fnm env --use-on-cd --shell zsh)"

# ! bun --------------------------------------------------------------------------------

export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# ! pnpm -------------------------------------------------------------------------------

export PNPM_HOME="$HOME/.local/share/pnpm"
export PATH="$PNPM_HOME:$PATH"

# ! oh-my-zsh --------------------------------------------------------------------------

export ZSH="$HOME/.oh-my-zsh"
ZSH_THEME="powerlevel10k/powerlevel10k"
plugins=(git)
zstyle ':omz:update' mode disabled
[[ -d "$ZSH" ]] && source "$ZSH/oh-my-zsh.sh"

[[ -f ~/.p10k.zsh ]] && source ~/.p10k.zsh

# ! fzf --------------------------------------------------------------------------------

function fzf-select-repository() {
  local dir
  dir=$(ghq list | fzf | xargs -I{} echo "$(ghq root)/{}")
  if [[ -n "$dir" ]]; then
    cd "$dir"
  fi
  zle reset-prompt
}
zle -N fzf-select-repository
bindkey '^f' fzf-select-repository

function fzf-select-history() {
  BUFFER="$(\history -nr 1 | awk '!a[$0]++' | fzf --exact --no-sort --query "$LBUFFER" | sed 's/\\n/\n/')"
  CURSOR=$#BUFFER
  zle -R -c
}
zle -N fzf-select-history
bindkey '^r' fzf-select-history

# ! aliases ----------------------------------------------------------------------------

alias c="claude"

# ! history ----------------------------------------------------------------------------

HISTFILE=$HOME/.zsh-history
HISTSIZE=100000
SAVEHIST=1000000

setopt inc_append_history
setopt share_history
