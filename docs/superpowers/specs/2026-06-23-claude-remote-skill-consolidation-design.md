# claude-remote スキル統合 設計書

## 背景と目的

Claude Code が SSH / シリアル越しにリモート機器を対話操作するための基盤 `claude-remote` は、現在ファイルが 2 か所に分散している。

- `claude-remote/`（リポジトリ直下）: 共有基盤。`README.md`、`bin/`（`remote-open`/`send`/`capture`/`close`/`status`/`attach-info` と `lib/common.sh`・`lib/parse-target.sh`）、`targets/serial/ix2215.conf`。ssh と serial の両方を 1 セットのスクリプトで扱う。
- `.claude/skills/claude-remote-ssh/SKILL.md`: SSH 固有ノウハウ。
- `.claude/skills/claude-remote-console/SKILL.md`: IX2215 固有ノウハウ。

スキルは `./claude-remote/bin/...` を参照する構造で、管理対象が 2 か所にまたがって見通しが悪い。

**目的**: 全ファイルを 1 つのスキルディレクトリ配下に集約し、管理を 1 か所にまとめる。スクリプトは ssh/serial 共通なので複製は発生させず、kind 固有のノウハウだけを参照ドキュメントに分離する。

## 方針

- **1 スキルに統合**する。`claude-remote-ssh` と `claude-remote-console` を廃し、`.claude/skills/claude-remote/` に一本化する。
- `bin/` スクリプトは ssh・serial 両対応の 1 セットをそのまま `scripts/` に移設する（複製しない）。
- kind 固有の深いノウハウは `references/ssh.md`・`references/console.md` に分離し、必要時に読む。
- 旧 `claude-remote/README.md` の内容は新 `SKILL.md` に吸収し、独立 README は廃止する（情報の二重管理を避ける）。

## 最終ディレクトリ構成

```
.claude/skills/claude-remote/
├── SKILL.md                    # 統合エントリ（kind 非依存の共通部分）
├── scripts/                    # 旧 bin/ をそのまま移設（ssh・serial 両対応の1セット）
│   ├── remote-open
│   ├── remote-send
│   ├── remote-capture
│   ├── remote-close
│   ├── remote-status
│   ├── remote-attach-info
│   └── lib/
│       ├── common.sh
│       └── parse-target.sh
├── references/
│   ├── ssh.md                  # 接続ホスト一覧 / Proxmox・Debian 別メモ / ssh トラブルシュート
│   └── console.md              # IX2215 既定値 / NEC IX コマンド体系 / --More-- / ? 補完の罠 / serial トラブルシュート
└── targets/
    └── serial/ix2215.conf
```

スクリプト本体は無改修で移設する。`scripts/*` は `$_BIN_DIR`（`BASH_SOURCE` から算出）を、`lib/parse-target.sh` は `CLAUDE_REMOTE_ROOT`（同じく `BASH_SOURCE` から `../..`）を使うため、`bin/`→`scripts/` 改名後も `targets/serial/*.conf` への相対参照は維持される。

## コンテンツの振り分け

3 ファイル（旧 README + 旧 ssh SKILL + 旧 console SKILL）の内容を、新 `SKILL.md` と 2 つの `references/` に再配置する。

### SKILL.md（kind 非依存の共通部分。読み込み時に必ず効く）

- frontmatter `description`: ssh と console 両方のトリガーを統合する。
  - IX2215 / シリアル系の語（「IX2215 に接続」「シリアルコンソール起動」「tmux ix2215」「コンソール繋いで」等）
  - SSH ホスト名（pve01〜03 / arona / prana）＋能動起動の条件（「ssh で X に接続できる/入れる」「X の状態/設定/ログを見て」「X の /etc/... を確認したい」「X で〜が起きている」等）
  - 抑止条件（「ssh は使わずに」「外から手順だけ教えて」等）
- 運用モデル: tmux 共有セッション / ユーザーは別ターミナルで attach / 承認制 / `sleep` で待たない / 認証は Mac 側に委譲 / リモートに痕跡を残さない（`TERM=xterm-256color` 上書き）。
- ターゲット記法表（`ssh:<host>` / `serial:<name>` / `serial:/dev/cu.xxx@<baud>`）とセッション名規約 `claude-remote-<kind>-<name>`。
- `scripts/` の使い方: `remote-open`/`send`/`capture`/`close`/`status`、フラグ（`--no-enter` / `--raw` / `-n`）、ログの所在（`~/.cache/claude-remote/<session>.log`）。
- send→capture 同期ループの基本指針（1 コマンド → capture → 確認 → 次）。
- 破壊的コマンドガード（共通ルール: `rm -rf` / パッケージ削除 / サービス停止・再起動 / `qm`・`pct` destroy / `reload`・`erase startup-config` 等は必ずユーザー承認）。
- references への振り分け案内: ssh 作業時は `references/ssh.md`、IX2215/シリアル時は `references/console.md` を読む。

### references/ssh.md

- 接続可能ホスト一覧（pve01〜03 / `-local` / arona / prana / `-local`）と Tailscale 落ち時の `-local` 利用。
- 前提確認（`ssh -G <host>` での Host ブロック確認、1Password ロック解除）。
- Proxmox VE 別メモ（root ログイン、ページャ抑止、`--no-pager`、VM/CT 操作の注意、`pvesh` でクラスタ横断）。
- Debian / Ubuntu 別メモ（`DEBIAN_FRONTEND=noninteractive`、`SYSTEMD_PAGER=''`、派手なプロンプト）。
- ssh 固有トラブルシュート表（Host block 未マッチ / `Confirm in 1Password` / Host key verification failed / Tailscale 到達不可 / プロンプト無 / session not found / ANSI エスケープ / パスワード入力）。

### references/console.md

- IX2215 既定値表（tmux session 名 / conf パス / デバイス `/dev/cu.PL2303G-USBtoUART1410` / ボーレート 9600 / 8N1 / フロー none / ログパス）。
- 前提確認（`tio` の存在、デバイス存在確認、別ケーブル列挙、ad-hoc 記法）。
- NEC IX コマンド体系メモ（Cisco IOS との差分）:
  - モード遷移（`Router#` ↔ `Router(config)#`、`enable` で直接 config）。
  - ユーザーモードで弾かれるコマンド（`show running-config` / `write` / `copy` / terminal 制御）。
  - startup-config への保存（config モードで `write memory`、保存中の警告）。
  - running-config / 経路確認（`show ip static-routes` 等）。
  - `--More--` ページャの扱い（途中で `q` せず読み切る、スペース送信ループ）。
  - `tmux send-keys` の文字落ち（`?` を含むコマンドで先頭が落ちる、Enter を別呼び出しに分ける）。
  - `?` 補完の後に Enter を送らない罠（入力行が確定してしまう、`C-u` で消去）。
- serial 固有トラブルシュート表（`Could not open device` / `session died immediately` / 文字化け / プロンプト無 / session not found / ANSI エスケープ）。

## 参照更新

集約に伴い、外部からの参照を新パスへ更新する。

1. `.claude/settings.json`: 許可エントリ 3 件のパスを更新する。
   ```
   Bash(.claude/skills/claude-remote/scripts/remote-capture:*)
   Bash(.claude/skills/claude-remote/scripts/remote-open:*)
   Bash(.claude/skills/claude-remote/scripts/remote-send:*)
   ```
   `remote-close` / `remote-status` / `remote-attach-info` は現状未許可のまま据え置く（挙動を変えない）。
2. `README.md:12`: `claude-remote/` の表エントリを `.claude/skills/claude-remote/`（スキル）へ書き換え、リンク先を新 SKILL.md にする。
3. SKILL.md・references 内のスクリプト呼び出し表記を、すべて `.claude/skills/claude-remote/scripts/remote-*` に統一する。

## 移行メカニクス

- `git mv` でスクリプト群・conf を移設する（履歴維持）。`bin/`→`scripts/` 改名も `git mv`。
- 旧 2 スキルディレクトリ（`claude-remote-ssh` / `claude-remote-console`）と旧 `claude-remote/README.md` は内容吸収後に削除する。
- 旧 `claude-remote/` ディレクトリは空になるので除去する。
- スクリプト本体は無改修。移設後に `remote-status` 等で動作確認する。

## 留意点

- 呼び出しパスが `./claude-remote/bin/...` → `.claude/skills/claude-remote/scripts/...` と長くなる。`settings.json` 更新で permission prompt は従来どおり抑止される。
- 既存の起動中 tmux セッション（あれば）はパス変更の影響を受けない（セッション名は不変）。

## 成功条件

- `.claude/skills/claude-remote/` 配下にスクリプト・参照・conf が集約され、リポジトリ直下の `claude-remote/` が無くなっている。
- `.claude/skills/claude-remote/scripts/remote-status` が動作し、`remote-open serial:ix2215` / `remote-open ssh:<host>` が従来どおり起動できる。
- 旧 2 スキルが新スキル 1 つに統合され、description が ssh・console 両方のトリガーを網羅している。
- `.claude/settings.json` と `README.md` の参照が新パスに更新されている。
- 旧パス `./claude-remote/bin/...` への参照がリポジトリ内に残っていない。
