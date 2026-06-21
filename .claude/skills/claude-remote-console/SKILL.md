---
name: claude-remote-console
description: NEC IX2215 ルーターのシリアルコンソールに tmux + tio でバックグラウンド接続し、Claude が対話的に show / configure 等を実行する。「IX2215 に接続」「シリアルコンソール起動」「tmux ix2215」「コンソール繋いで」等で使う。
---

# IX2215 Serial Console (claude-remote + tio)

NEC IX2215 のシリアルコンソールを `claude-remote/` 基盤の `serial:ix2215` ターゲットとして tmux 上で常駐させる。tmux 共有モデル・`remote-send` / `remote-capture` の使い方・ユーザー attach の挙動などの **基盤側の運用ルール** は `claude-remote/README.md` を参照。本スキルは **IX2215 / NEC IX 特有の操作ノウハウ** に集中する。

**運用モデル**: 接続開始時に必ずユーザーに `tmux attach -t claude-remote-serial-ix2215` を別ターミナルで開いてもらう。ユーザーは attach 画面でリアルタイム出力を確認しながら、Claude が送る次のコマンドを Claude Code の permission prompt で承認する。承認制で進めるので `sleep` で完了を待つ必要はなく、コマンド投入直後に `capture` してよい。

シリアルデバイスは OS が排他するため、同じデバイスに対する 2 セッションは作らない。

## 既定値

| 項目 | 値 |
| --- | --- |
| tmux session 名 | `claude-remote-serial-ix2215` |
| シリアル設定ファイル | `claude-remote/targets/serial/ix2215.conf` |
| シリアルデバイス | `/dev/cu.PL2303G-USBtoUART1410` (PL2303 USB シリアル変換) |
| ボーレート | `9600` (IX2215 工場出荷時) |
| データ/パリティ/ストップ | 8N1 |
| フロー制御 | none |
| ログファイル | `~/.cache/claude-remote/claude-remote-serial-ix2215.log` |

ボーレート変更 (`console baudrate 115200` 等) を入れた機体は `claude-remote/targets/serial/ix2215.conf` の `baud` を書き換えるか、`serial:/dev/cu.PL2303G-USBtoUART1410@115200` で ad-hoc 指定する。

---

## Step 1: 前提確認

1. `tio` の存在チェック。無ければ `brew install tio` を案内（自動実行はせず確認を取る）
2. `tmux` の存在チェック（基本入っている）
3. `ls /dev/cu.PL2303G-USBtoUART1410` でデバイスの存在を確認。無い場合はケーブル未接続なのでユーザーに通知
   - 別ケーブルを使う場合は `ls /dev/cu.PL2303* /dev/cu.usbserial-* /dev/cu.usbmodem* 2>/dev/null` で再列挙し、`tio --list` でベンダー情報を確認のうえ `claude-remote/targets/serial/ix2215.conf` の `device` を書き換える、または ad-hoc 記法を使う
4. 既存セッションは `remote-open` が自動的に検出して冪等に振る舞うので、明示的なチェックは不要

---

## Step 2: セッション起動

```bash
./claude-remote/bin/remote-open serial:ix2215
```

スクリプトが冪等にセッションを起動し、末尾に attach コマンドと初期画面 (`capture-pane -S -50`) を出力する。`tio: connected` のような行が出ていれば成功。出ていなければ Step 5（トラブルシュート）。

別ケーブル・別ボーレートを ad-hoc で使う場合:

```bash
./claude-remote/bin/remote-open 'serial:/dev/cu.usbserial-1410@115200'
```

---

**起動できたら、続けて操作する前に必ずユーザーに `tmux attach -t claude-remote-serial-ix2215` を別ターミナルで開くよう依頼する**（デタッチは `Ctrl+b` → `d`、tio の `Ctrl+t` プレフィックスは tmux 内だと干渉に注意）。以降は Claude が 1 コマンド送るたびに permission prompt が出るので、ユーザーは attach 画面で出力を確認してから承認する流れになる。ログは `~/.cache/claude-remote/claude-remote-serial-ix2215.log` に追記され続ける。

---

## Step 3: Claude による操作

### コマンド投入

```bash
./claude-remote/bin/remote-send serial:ix2215 'show version'
```

- 末尾に自動で Enter が付く
- 改行なしの `?` 補完は `--no-enter` を使う: `remote-send --no-enter serial:ix2215 '?'`
- 制御キー（`C-u` で行クリア等）は `--raw`: `remote-send --raw serial:ix2215 C-u`
- パスワード入力など、ログに残したくない入力は **避けるか、ユーザーに依頼する**

### 出力取得

```bash
# 直近 200 行をプレーンテキストで
./claude-remote/bin/remote-capture serial:ix2215
# 行数指定
./claude-remote/bin/remote-capture -n 500 serial:ix2215
```

長い出力は `show ... | include` などで絞るか、capture 結果の末尾を見て継続判断する。完了判定はプロンプト (`Router#` `Router(config)#` 等) の有無で行う。送信直後に `capture` してよい — 出力が途中ならユーザーが attach 画面で確認したうえで次の `capture` を承認するので、`sleep` で待つ必要はない。

### `--More--` の扱い

`show running-config` 等の長尺出力では `--More--` ページャが入る。**途中で `q` で打ち切らず、最後まで読み切る**こと:

- スペース送信で次ページ: `remote-send --no-enter serial:ix2215 ' '`
- `--More--` が消えてプロンプトが返るまで「remote-capture で末尾確認 → スペース送信」を繰り返す
- 1 ページ約 24 行なので、想定行数 ÷ 24 回スペースを送る目安
- 部分情報で判断すると後半に重要な設定 (例: `network-monitor` / `watch-group` ブロック) を見落として誤検出することがある
- `q` で抜けるとそこまでしか取得できないため、構成把握目的では原則使わない

### 連続操作の指針

- 1 コマンド → capture → 結果確認 → 次コマンド の **同期的ループ** を基本とする（各ステップごとにユーザーが attach 画面を見て permission prompt で承認する）
- `configure` モードに入ったらユーザーに一声かけてから設定変更する（事故防止）
- `write memory` / `copy running-config startup-config` 相当の保存系は **ユーザーの明示承認を得てから** 実行する

---

## NEC IX コマンド体系メモ (Cisco IOS との差分)

NEC IX (10.x) は Cisco IOS 風プロンプトだが、コマンド可否のモード境界が異なる。実機で確認できた事項:

### モード遷移

- `Router#` (ユーザーモード) と `Router(config)#` (config モード) の 2 段。Cisco の privileged EXEC 相当の中間段は無い
- ユーザーモードから `enable` (または `enable-config`) で **直接 config モードに入る**

### ユーザーモードでは弾かれる主なコマンド

`% Invalid command.` で拒否される。すべて config モードで実行する必要がある:

- `show running-config`
- `write` 系 (`write memory` 含む)
- `copy` 系 (`copy running-config startup-config` 等は存在しない)
- `terminal length 0` 等の terminal 制御

ユーザーモードで使えるのは `show ip route` / `show interfaces` 等の運用系のみ。

### startup-config への保存

- 保存コマンドは config モードで `write memory` のみ
- 実行中に次の警告が出るが、プロンプトが返れば成功:
  ```
  Building configuration...
  % Warning: do NOT enter CNTL/Z while saving to avoid config corruption.
  ```

### running-config / 経路の確認

- `show running-config`: config モードのみ。長尺なので `--More--` ページャ対応必須 (上記参照)
- `show ip route`: ユーザーモード可。`default` サブキーワードは無い (`show ip route` 全体表示か `show ip static-routes`)
- フローティング default など非アクティブ経路は `show ip route` の "hidden" カウントに入り直接見えない。`show ip static-routes` で valid/best フラグ込みで確認できる

### `tmux send-keys` の文字落ち

`'event ?'` のように送ると先頭文字が落ちて `'vent ?'` となることがある。再現性は低いが、`?` を含む補完確認では `'<word> ?'` を送ったあと **Enter は別呼び出し** に分けると安定する:

```bash
./claude-remote/bin/remote-send --no-enter serial:ix2215 'event ?'
./claude-remote/bin/remote-send --raw serial:ix2215 Enter
```

### `?` 補完の後に Enter を送らない

NEC IX の `?` ヘルプは表示後に **同じ入力行を残したまま** プロンプトに戻る。そのまま Enter を送ると **そこまでの入力が確定**してしまう (補完候補に `<cr>` が含まれていれば valid command として実行される)。

具体例: `event 1 ip reach-host 8.8.8.8 ?` を送った直後に Enter を送ると、interface 引数なしの `event 1 ip reach-host 8.8.8.8` が登録される (本来は `GigaEthernet1.1` まで指定が必要だった)。

対策:

- `?` を送ったあとは **Enter を送らずに、一度 remote-capture で help を確認** → 入力行を `Ctrl-U` で消去 (`remote-send --raw serial:ix2215 C-u`)、または必要な完全コマンドを上書き入力する
- 同じ seq 番号で再投入すれば前のエントリは上書きされるので、誤投入時はリカバリ可能 (probe / event / action 系)

---

## Step 4: セッション終了

通常はセッションを **残したまま** にしてよい（ログも継続）。明示的に閉じる場合:

```bash
./claude-remote/bin/remote-close serial:ix2215
# 強制終了
./claude-remote/bin/remote-close --force serial:ix2215
```

`remote-close` は tio の終了シーケンス (`Ctrl-t q`) を投入してから、残っていれば `tmux kill-session` で落とす。

シリアルケーブルを抜く前に必ず tmux セッションを落とす（デバイスの掴みっぱなしを防ぐ）。

---

## Step 5: トラブルシューティング

| 症状 | 対処 |
| --- | --- |
| `tio: Could not open device` | ケーブル未接続、または他プロセスが掴んでいる。`ls /dev/cu.PL2303G-USBtoUART1410` と `lsof /dev/cu.PL2303G-USBtoUART1410` で確認 |
| `session died immediately after launch` | `remote-open` がデバイスを開けずに即死。ログ末尾が表示されるのでそれを見る。多くはケーブル未接続 |
| 文字化け | ボーレートが違う。`claude-remote/targets/serial/ix2215.conf` を `9600` → `115200` に変えるか ad-hoc 記法で上書き |
| プロンプトが出ない | Enter を 2-3 回送る (`remote-send --raw serial:ix2215 Enter Enter`)。コンソールがスリープしている場合がある |
| `remote-send` が「session not found」 | セッション未起動。`./claude-remote/bin/remote-status` で確認、無ければ `remote-open serial:ix2215` |
| ログに ANSI エスケープが混じって読みにくい | `remote-capture` で取得すれば描画後のテキストになる。生ログ (`~/.cache/claude-remote/claude-remote-serial-ix2215.log`) を直読みするときは `sed 's/\x1b\[[0-9;]*[a-zA-Z]//g'` で除去 |

---

## 重要な注意事項

- `reload` / `erase startup-config` 等の **破壊的コマンドは必ずユーザー承認** を取ってから送る
- ログファイルにはパスワード・コミュニティ名等が平文で残る可能性がある。共有・コミット時は注意
- このスキルが扱うのは **ローカルのシリアル接続のみ**。SSH ホスト経由の操作は `claude-remote-ssh` スキル、リモートからの共有が必要なら ser2net 構成を別途検討する
