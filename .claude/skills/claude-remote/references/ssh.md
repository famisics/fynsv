# SSH 接続 (claude-remote ssh: ターゲット)

`ssh:<host>` ターゲットの固有ノウハウ。共通運用ルール (tmux 共有モデル / send→capture ループ / 破壊的コマンドガード) は `../SKILL.md` を参照。

tmux はローカル (Mac) 側で動くので、リモート環境には特別な痕跡は残らない (`TERM=xterm-256color` 上書きのみ)。

## 既定値

| 項目 | 値 |
| --- | --- |
| セッション名 | `claude-remote-ssh-<host>` (例: `claude-remote-ssh-pve01`) |
| ログファイル | `~/.cache/claude-remote/claude-remote-ssh-<host>.log` |
| リモート TERM | `xterm-256color` (固定上書き) |
| 認証 | `~/.ssh/config` + 1Password Agent (`IdentityAgent` in `Host *`) |

## 接続可能ホスト (`dotfiles/.ssh/config`)

- `pve01` / `pve02` / `pve03` — Proxmox VE ノード (Tailscale FQDN)
- `pve01-local` / `pve02-local` / `pve03-local` — 同じく LAN IP (`192.168.1.x`)
- `arona` / `prana` — Tailscale FQDN
- `arona-local` / `prana-local` — LAN IP

Tailscale が落ちているときは `-local` 系を使う。

## 前提確認

1. `tmux` / `ssh` の存在チェック (基本入っている)
2. 対象ホストが `~/.ssh/config` に居るか: `ssh -G <host>` で hostname が書き換わるか確認 (`remote-open` 内でも検証される)
3. 1Password アプリが起動しロック解除されているか (最初の鍵使用時に確認ダイアログが出る)。`Confirm in 1Password` 系メッセージが出ているときは認証待ち。ユーザーにロック解除と承認を依頼する。

## ページャの扱い

- `less`, `more`, `man`, `systemctl status` の末尾, `journalctl` 等に入ったら:
  - スペース: 次ページ → `remote-send --no-enter ssh:<host> ' '`
  - `q`: 終了 → `remote-send --no-enter ssh:<host> 'q'`
  - `G`: 末尾 → `remote-send --no-enter ssh:<host> 'G'`
- 可能ならコマンド側で `--no-pager` / `| cat` / `journalctl -n 50 --no-pager` でページャを抑止するほうが楽。

## sudo

- `sudo` パスワード要求はログに残る。**パスワード入力はユーザーに依頼** するか、`NOPASSWD` を確認してから流す。
- `sudo -i` で root シェルに入った状態が保持されるので、複数ステップの作業に活かせる。

## 接続先別メモ

### Proxmox VE (pve01〜03)

- root ログインなのでガードを強めに。
- ページャ抑止: `pvesh get /nodes --output-format json | jq` / `qm list` / `pct list` はそのまま。長いものは `| cat` か `--noheaders` 等。
- `journalctl -u pveproxy -n 100 --no-pager` のように `--no-pager` を付ける。
- VM/CT 操作 (`qm start/stop/destroy`, `pct ...`) は破壊力高め。`qm config <vmid>` で内容を見せて確認してから。
- クラスタを跨ぐコマンドは pve01 から `pvesh` で済むことが多い。3 セッション張る前に一旦考える。

### Debian / Ubuntu (arona / prana)

- `apt` は対話プロンプトが出る場合がある。`DEBIAN_FRONTEND=noninteractive apt-get -y ...` を使うか、プロンプト時はユーザーに承認を取る。
- `systemctl status <unit>` はページャに入る → `SYSTEMD_PAGER='' systemctl status <unit>` か `--no-pager`。
- 派手なシェルプロンプトでも `capture-pane` は描画後テキストになるので通常問題ないが、行末判定するときは注意。

## トラブルシューティング

| 症状 | 対処 |
| --- | --- |
| `no explicit Host block matched` 警告 + 即死 | ホスト名が `~/.ssh/config` に無い。スペルミスか `-local` を試す |
| `Confirm in 1Password` が出続ける | 1Password アプリがロック中。Touch ID / パスワードでロック解除をユーザーに依頼 |
| `Host key verification failed` | サーバ再構築等で鍵が変わった。`ssh-keygen -R <host>` で `known_hosts` から削除 → 再 `remote-open` |
| Tailscale 経由で到達しない | `tailscale status` で確認。落ちていれば `-local` (LAN IP) を使う |
| プロンプトが出ない | Enter を 2-3 回送る: `remote-send --raw ssh:<host> Enter Enter` |
| `session not found` | セッション未起動。`remote-status` で確認 |
| 出力に ANSI エスケープが多い | `remote-capture` は描画後テキスト。生ログを読むときは `sed 's/\x1b\[[0-9;]*[a-zA-Z]//g'` で除去 |
| パスワード入力が必要 | パスワードはログに残る。ユーザーに `tmux attach` してもらって直接入力してもらうのが安全 |
