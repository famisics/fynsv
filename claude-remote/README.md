# claude-remote

Claude Code が SSH 越し / シリアル越しのリモート機器を対話的に操作するための基盤。`claude-remote-ssh` / `claude-remote-console` スキルから呼ばれる。

## 思想

- **tmux + 接続コマンドの共有セッション** — Claude は `tmux send-keys` でコマンドを投入し、`tmux capture-pane` で結果を読む。セッションが残るので cwd・環境変数・`sudo -i`・`configure` モードなどの状態を跨いだ複数ステップ作業ができる。
- **ユーザーは別ターミナルで同じ tmux セッションに attach して進捗を見る** — 接続開始時に必ず `tmux attach -t claude-remote-<kind>-<name>` を別ターミナルで開いてもらう。Claude が次のコマンドを送るたびに Claude Code の permission prompt で内容を確認・承認できるので、attach 画面で出力を見ながら承認を判断する運用にする。
- **sleep で完了を待たない** — ユーザーが attach 中で承認のタイミングを握っているので、`tmux send-keys` の直後に `capture-pane` してよい。出力が途中なら次の capture を承認する時点でユーザーが判断する。
- **認証は Mac 側に委譲** — SSH は `~/.ssh/config` ＋ 1Password Agent。スクリプトは認証情報を扱わない。
- **リモートには痕跡を残さない** — tmux はローカル (Mac) で動く。リモートからは普通の対話 SSH に見える。`TERM=xterm-256color` を強制してリモート terminfo に無い値が漏れないようにする。

## ターゲット記法

| 記法                        | 意味                                | 例                                     |
| --------------------------- | ----------------------------------- | -------------------------------------- |
| `ssh:<host>`                | `~/.ssh/config` の `Host` 名        | `ssh:pve01`, `ssh:prana-local`         |
| `serial:<name>`             | `targets/serial/<name>.conf` を参照 | `serial:ix2215`                        |
| `serial:/dev/cu.xxx@<baud>` | ad-hoc シリアル                     | `serial:/dev/cu.usbserial-1410@115200` |

セッション名は `claude-remote-<kind>-<name>` 固定。例: `claude-remote-ssh-pve01`。

## スクリプト

```sh
./claude-remote/bin/remote-open    <target>           # セッション起動 (冪等)
./claude-remote/bin/remote-send    <target> '<text>'  # 行送信 (末尾 Enter 自動)
./claude-remote/bin/remote-capture <target>           # 画面取得 (デフォルト 200 行)
./claude-remote/bin/remote-status                     # 一覧
./claude-remote/bin/remote-close   <target>           # 終了
```

ログは `~/.cache/claude-remote/<session>.log` に追記される（パスワードや秘密情報が混じる可能性あり）。

## IX2215 シリアルとの関係

NEC IX2215 のシリアル接続は `serial:ix2215` ターゲットとして本基盤上で動く。NEC IX 固有のページャ対応や `?` 補完の罠などの操作ノウハウは `claude-remote-console` スキルに集約してある。

## 既知の挙動

- `?` を含むコマンドは tmux send-keys で先頭文字が落ちることがある（NEC IX で確認）。`--no-enter` で送ってから別呼び出しで Enter を送ると安定する。
- 1Password Agent がロックされていると ssh が認証ダイアログ待ちで止まる。`remote-capture` で `Confirm in 1Password` 系のメッセージが見えれば、ユーザーにロック解除を依頼する。
- 破壊的コマンド（`rm -rf`, `apt remove`, `qm destroy`, `reload` など）は必ずユーザーの明示承認を得てから送る。
