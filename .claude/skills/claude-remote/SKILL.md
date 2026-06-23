---
name: claude-remote
description: tmux + ssh / tio でリモート機器に共有セッション接続し、Claude が対話的にコマンドを送受信する基盤。(1) SSH ホスト (pve01〜03 / arona / prana など) — 明示指示 (「pve01 に繋いで」「ssh で prana に入って」「remote-open ssh:～」) だけでなく、対象ホスト名と一緒に「ssh で X に接続できる/入れる」「X の状態/設定/ログを見て」「X の /etc/... を確認したい」「X で〜が起きている (トラブルシュート)」等が出たら能動的に起動。(2) NEC IX2215 ルーターのシリアルコンソール — 「IX2215 に接続」「シリアルコンソール起動」「tmux ix2215」「コンソール繋いで」等で起動。逆にユーザーが「ssh は使わずに」「外から手順だけ教えて」等を明示した時は起動しない。SSH 詳細は references/ssh.md、シリアル/IX2215 詳細は references/console.md。
---

# claude-remote (tmux + ssh / tio shared session)

Claude Code が SSH 越し / シリアル越しのリモート機器を **tmux の共有セッション** で対話操作するための基盤。`scripts/` の薄いラッパー (`remote-open` / `remote-send` / `remote-capture` / `remote-close` / `remote-status`) を通して、コマンドを投入し画面を読み取る。

本 SKILL.md は **kind 非依存の共通運用ルール** に集中する。接続先固有のノウハウは必要時に読む:

- **SSH ホスト** (pve01〜03 / arona / prana 等) を操作する → `references/ssh.md`
- **シリアル / NEC IX2215** を操作する → `references/console.md`

## 思想

- **tmux + 接続コマンドの共有セッション** — Claude は `tmux send-keys` でコマンドを投入し、`tmux capture-pane` で結果を読む。セッションが残るので cwd・環境変数・`sudo -i`・`configure` モードなどの状態を跨いだ複数ステップ作業ができる。
- **ユーザーは別ターミナルで同じ tmux セッションに attach して進捗を見る** — 接続開始時に必ず `tmux attach -t claude-remote-<kind>-<name>` を別ターミナルで開いてもらう。Claude が次のコマンドを送るたびに Claude Code の permission prompt で内容を確認・承認できるので、attach 画面で出力を見ながら承認を判断する運用にする。
- **sleep で完了を待たない** — ユーザーが attach 中で承認のタイミングを握っているので、`remote-send` の直後に `remote-capture` してよい。出力が途中なら次の capture を承認する時点でユーザーが判断する。
- **認証は Mac 側に委譲** — SSH は `~/.ssh/config` ＋ 1Password Agent。スクリプトは認証情報を扱わない。
- **リモートには痕跡を残さない** — tmux はローカル (Mac) で動く。リモートからは普通の対話 SSH に見える。`TERM=xterm-256color` を強制してリモート terminfo に無い値が漏れないようにする。

## ターゲット記法

| 記法                        | 意味                                       | 例                                     |
| --------------------------- | ------------------------------------------ | -------------------------------------- |
| `ssh:<host>`                | `~/.ssh/config` の `Host` 名               | `ssh:pve01`, `ssh:prana-local`         |
| `serial:<name>`             | `targets/serial/<name>.conf` を参照        | `serial:ix2215`                        |
| `serial:/dev/cu.xxx@<baud>` | ad-hoc シリアル                            | `serial:/dev/cu.usbserial-1410@115200` |

セッション名は `claude-remote-<kind>-<name>` 固定 (例: `claude-remote-ssh-pve01`, `claude-remote-serial-ix2215`)。

ログは `~/.cache/claude-remote/<session>.log` に追記される (パスワードや秘密情報が混じる可能性あり)。

## スクリプト

すべて `.claude/skills/claude-remote/scripts/` 配下。

```sh
.claude/skills/claude-remote/scripts/remote-open    <target>           # セッション起動 (冪等)
.claude/skills/claude-remote/scripts/remote-send    <target> '<text>'  # 行送信 (末尾 Enter 自動)
.claude/skills/claude-remote/scripts/remote-capture <target>           # 画面取得 (デフォルト 200 行)
.claude/skills/claude-remote/scripts/remote-status                     # 一覧
.claude/skills/claude-remote/scripts/remote-close   <target>           # 終了
```

### コマンド投入

```bash
.claude/skills/claude-remote/scripts/remote-send ssh:pve01 'uname -a'
```

- 末尾に自動で Enter が付く
- 改行を付けたくない場合 (`?` 補完等): `remote-send --no-enter <target> '<text>'`
- 制御キーを送る場合: `remote-send --raw <target> C-c` / `C-u` / `Escape` / `Enter` など

### 出力取得

```bash
.claude/skills/claude-remote/scripts/remote-capture <target>        # 直近 200 行
.claude/skills/claude-remote/scripts/remote-capture -n 500 <target>
```

`remote-capture` は描画後のプレーンテキストを返す。完了判定はプロンプト (`#`, `$`, `root@host:~#`, `Router#`, `Router(config)#` 等) の有無で行う。送信直後に capture してよい — 出力が途中ならユーザーが attach 画面で確認したうえで次の capture を承認するので、`sleep` で待つ必要はない。

## 運用フロー

### Step 1: 起動

```bash
.claude/skills/claude-remote/scripts/remote-open <target>
```

冪等にセッションを起動し、末尾に attach コマンドと初期画面 (`capture-pane -S -50`) を出力する。プロンプトが見えていれば成功。

**起動できたら、続けて操作する前に必ずユーザーに `tmux attach -t claude-remote-<kind>-<name>` を別ターミナルで開くよう依頼する**。以降は Claude が 1 コマンド送るたびに permission prompt が出るので、ユーザーは attach 画面で出力を確認してから承認する流れになる。

前提確認・起動時の固有の注意 (1Password / シリアルデバイス確認など) は各 references を参照。

### Step 2: 同期的ループ

- **1 コマンド → capture → 結果確認 → 次コマンド** の同期的ループを基本とする (各ステップごとにユーザーが attach 画面を見て permission prompt で承認する)。
- ページャに入ったら kind に応じて対処する (ssh の `less`/`journalctl`、IX の `--More--` など)。詳細は references。可能ならコマンド側でページャを抑止する (`--no-pager` / `| cat` 等)。
- パスワード入力はログに残る。**ユーザーに attach 画面で直接入力してもらう** か、`NOPASSWD` を確認してから流す。

### Step 3: 終了

通常はセッションを **残したまま** にしてよい (再接続時に再利用、ログも継続)。明示的に閉じる場合:

```bash
.claude/skills/claude-remote/scripts/remote-close <target>
.claude/skills/claude-remote/scripts/remote-close --force <target>   # 強制終了
```

`remote-close` は ssh ならリモートシェルを `exit`、serial なら tio の終了シーケンス (`C-t q`) を投入してから、残っていれば `tmux kill-session` で落とす。

## 破壊的コマンドのガード

以下は **必ずユーザーの明示承認** を得てから送る:

- ファイル系: `rm -rf`, `mkfs.*`, `dd of=/dev/...`, `> /important/file`
- パッケージ: `apt remove`, `apt purge`, `dnf remove`, `pacman -R`
- サービス: `systemctl stop`, `systemctl disable`, `systemctl mask`, `shutdown`, `reboot`, `poweroff`
- Proxmox: `qm destroy`, `pct destroy`, `pvecm delnode`, `zpool destroy`
- ネットワーク機器: `reload`, `erase startup-config`, `write memory` などの保存・再起動系

## 共通トラブルシューティング

| 症状 | 対処 |
| --- | --- |
| プロンプトが出ない | Enter を 2-3 回送る (`remote-send --raw <target> Enter Enter`) |
| `session not found` | セッション未起動。`remote-status` で確認、無ければ `remote-open <target>` |
| 出力に ANSI エスケープが多い | `remote-capture` は描画後テキスト。生ログ (`~/.cache/claude-remote/*.log`) を読むときは `sed 's/\x1b\[[0-9;]*[a-zA-Z]//g'` で除去 |

kind 固有の症状 (1Password ロック / Host key / シリアルデバイス未検出 / 文字化け 等) は references を参照。

## 重要な注意事項

- 破壊的コマンドは必ずユーザー承認を取ってから送る (上記リスト参照)。
- ログファイルにはパスワード・コミュニティ名等が平文で残る可能性がある。共有・コミット時は注意。
