---
name: claude-remote-ssh
description: Mac の ~/.ssh/config と 1Password Agent を使って Ubuntu / Debian / Proxmox などの SSH ホストに tmux + ssh で接続し、Claude が対話的にコマンドを送受信する。明示指示 (「pve01 に繋いで」「ssh で prana に入って」「remote-open ssh:～」) だけでなく、暗黙の接続示唆があれば能動的に起動する。具体的には対象ホスト名 (pve01〜03 / arona / prana など) と一緒に以下のような文言が出てきたら起動する: 「ssh で X に接続できる/入れる」「X の状態/設定/ログを見て」「X の /etc/... を確認したい」「X で〜が起きている (トラブルシュート文脈)」。逆にユーザーが「ssh は使わずに」「外から手順だけ教えて」等を明示した時は起動しない。対象ホスト: pve01〜03 (Proxmox), arona / prana (Debian/Ubuntu)。
---

# claude-remote-ssh (tmux + ssh shared session)

`claude-remote/bin/` の薄いラッパーを通して SSH ホストに tmux セッションで接続し、`remote-send` でコマンドを投入、`remote-capture` で画面を読み取って対話作業を行うスキル。tmux はローカル (Mac) 側で動くので、リモート環境には特別な痕跡は残らない（`TERM=xterm-256color` 上書きのみ）。

**運用モデル**: 接続開始時に必ずユーザーに `tmux attach -t claude-remote-ssh-<host>` を別ターミナルで開いてもらう。ユーザーは attach 画面でリアルタイム出力を見ながら、Claude が送る次のコマンドを Claude Code の permission prompt で承認する。承認制で進めるので `sleep` で完了を待つ必要はなく、コマンド投入直後に `capture` してよい。

## 既定値

| 項目 | 値 |
| --- | --- |
| セッション名 | `claude-remote-ssh-<host>` (例: `claude-remote-ssh-pve01`) |
| ログファイル | `~/.cache/claude-remote/claude-remote-ssh-<host>.log` |
| リモート TERM | `xterm-256color` (固定上書き) |
| 認証 | `~/.ssh/config` + 1Password Agent (`IdentityAgent` in `Host *`) |

## 接続可能ホスト（`dotfiles/.ssh/config`）

- `pve01` / `pve02` / `pve03` — Proxmox VE ノード (Tailscale FQDN)
- `pve01-local` / `pve02-local` / `pve03-local` — 同じく LAN IP (`192.168.1.x`)
- `arona` / `prana` — Tailscale FQDN
- `arona-local` / `prana-local` — LAN IP

Tailscale が落ちているときは `-local` 系を使う。

---

## Step 1: 前提確認

1. `tmux` / `ssh` の存在チェック（基本入っている）
2. 対象ホストが `~/.ssh/config` に居るか: `ssh -G <host>` で hostname が書き換わるか確認（`remote-open` 内でも検証される）
3. 1Password アプリが起動しロック解除されているか（最初の鍵使用時に確認ダイアログが出る）

---

## Step 2: セッション起動

```bash
./claude-remote/bin/remote-open ssh:<host>
```

スクリプトが冪等にセッションを起動し、末尾に attach コマンドと初期画面 (`capture-pane -S -50`) を出力する。プロンプト (`root@pve01:~#` など) が見えていれば成功。

**起動できたら、続けて操作する前に必ずユーザーに `tmux attach -t claude-remote-ssh-<host>` を別ターミナルで開くよう依頼する**。以降は Claude が 1 コマンド送るたびに permission prompt が出るので、ユーザーは attach 画面で出力を確認してから承認する流れになる。

`Confirm in 1Password` 系メッセージが出ているときは認証待ち。ユーザーにロック解除と承認を依頼する。

---

## Step 3: Claude による操作

### コマンド投入

```bash
./claude-remote/bin/remote-send ssh:<host> 'uname -a'
```

- 末尾に自動で Enter が付く
- 改行を付けたくない場合: `remote-send --no-enter ssh:<host> '<text>'`
- 制御キーを送る場合: `remote-send --raw ssh:<host> C-c` / `C-u` / `Escape` など

### 出力取得

```bash
./claude-remote/bin/remote-capture ssh:<host>        # 直近 200 行
./claude-remote/bin/remote-capture -n 500 ssh:<host>
```

完了判定はプロンプト (`#`, `$`, `root@host:~#` 等) の有無で行う。送信直後に `capture` してよい — 出力が途中ならユーザーが attach 画面で確認したうえで次の `capture` を承認するので、`sleep` で待つ必要はない。

### 連続操作の指針

- **1 コマンド → capture → 結果確認 → 次コマンド** の同期的ループを基本とする（各ステップごとにユーザーが attach 画面を見て permission prompt で承認する）
- ページャに入ったら（`less`, `more`, `man`, `systemctl status` の末尾, `journalctl` 等）:
  - スペース: 次ページ → `remote-send --no-enter ssh:<host> ' '`
  - `q`: 終了 → `remote-send --no-enter ssh:<host> 'q'`
  - `G`: 末尾 → `remote-send --no-enter ssh:<host> 'G'`
- 可能ならコマンド側で `--no-pager` / `| cat` / `journalctl -n 50 --no-pager` でページャを抑止するほうが楽
- `sudo` パスワード要求はログに残る。**パスワード入力はユーザーに依頼**するか、`NOPASSWD` を確認してから流す
- `sudo -i` で root シェルに入った状態が保持されるので、複数ステップの作業に活かせる

### 破壊的コマンドのガード

以下は **必ずユーザーの明示承認** を得てから送る:

- ファイル系: `rm -rf`, `mkfs.*`, `dd of=/dev/...`, `> /important/file`
- パッケージ: `apt remove`, `apt purge`, `dnf remove`, `pacman -R`
- サービス: `systemctl stop`, `systemctl disable`, `systemctl mask`, `shutdown`, `reboot`, `poweroff`
- Proxmox: `qm destroy`, `pct destroy`, `pvecm delnode`, `zpool destroy`

---

## 接続先別メモ

### Proxmox VE (pve01〜03)

- root ログインなのでガードを強めに
- ページャ抑止: `pvesh get /nodes --output-format json | jq` / `qm list` / `pct list` はそのまま。長いものは `| cat` か `--noheaders` 等
- `journalctl -u pveproxy -n 100 --no-pager` のように `--no-pager` を付ける
- VM/CT 操作 (`qm start/stop/destroy`, `pct ...`) は破壊力高め。`qm config <vmid>` で内容を見せて確認してから
- クラスタを跨ぐコマンドは pve01 から `pvesh` で済むことが多い。3 セッション張る前に一旦考える

### Debian / Ubuntu (arona / prana)

- `apt` は対話プロンプトが出る場合がある。`DEBIAN_FRONTEND=noninteractive apt-get -y ...` を使うか、プロンプト時はユーザーに承認を取る
- `systemctl status <unit>` はページャに入る → `SYSTEMD_PAGER='' systemctl status <unit>` か `--no-pager`
- 派手なシェルプロンプトでも `capture-pane` は描画後テキストになるので通常問題ないが、行末判定するときは注意

---

## Step 4: セッション終了

通常はセッションを **残したまま** にしてよい（再接続時に再利用、ログも継続）。明示的に閉じる場合:

```bash
./claude-remote/bin/remote-close ssh:<host>
./claude-remote/bin/remote-close --force ssh:<host>   # 強制終了
```

---

## Step 5: トラブルシューティング

| 症状 | 対処 |
| --- | --- |
| `no explicit Host block matched` 警告 + 即死 | ホスト名が `~/.ssh/config` に無い。スペルミスか `-local` を試す |
| `Confirm in 1Password` が出続ける | 1Password アプリがロック中。Touch ID / パスワードでロック解除をユーザーに依頼 |
| `Host key verification failed` | サーバ再構築等で鍵が変わった。`ssh-keygen -R <host>` で `known_hosts` から削除 → 再 `remote-open` |
| Tailscale 経由で到達しない | `tailscale status` で確認。落ちていれば `-local` (LAN IP) を使う |
| プロンプトが出ない | Enter を 2-3 回送る: `remote-send --raw ssh:<host> Enter Enter` |
| `session not found` | セッション未起動。`./claude-remote/bin/remote-status` で確認 |
| 出力に ANSI エスケープが多い | `remote-capture` は描画後テキスト。生ログ (`~/.cache/claude-remote/*.log`) を読むときは `sed 's/\x1b\[[0-9;]*[a-zA-Z]//g'` で除去 |
| パスワード入力が必要 | パスワードはログに残る。ユーザーに `tmux attach` してもらって直接入力してもらうのが安全 |

---

## 重要な注意事項

- 破壊的コマンドは **必ずユーザー承認** を取ってから送る（上記リスト参照）
- ログファイルにはパスワード・秘密情報が平文で残る可能性がある。共有・コミット時は注意
- このスキルが扱うのは **ssh 接続のみ**。シリアル（NEC IX2215 等）は `claude-remote-console` スキルへ
