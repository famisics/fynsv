# discord-bot/fun-council

Discord bot。リマインダー登録 (`/remind`) とロール自動付与 (rolesync) の 2 機能を持つ。

配置先: `~/discord-bot/fun-council`。共通の稼働先・デプロイ形式・リソース割り当ての正・運用操作は [arona/README.md](../../README.md) を参照。

## 機能

- **`/remind` ([`features/reminder`](./features/reminder/reminder.go))**: `message` と `time` (JST、`15:00` または `06/24 09:30` 形式) を指定するとその時刻に呼び出しチャンネル (省略時) または指定した `channel` にメンション付きでメッセージを送る。指定時刻が過去なら拒否し、`HH:MM` のみの場合は当日が過ぎていれば翌日として扱う。予約はプロセス内タイマー (`time.AfterFunc`) のみで永続化しない。
- **rolesync ([`features/rolesync`](./features/rolesync/rolesync.go))**: 起動時から 15 分おきに対象ギルド (`roleSyncGuildID`) の全メンバーを走査し、`roleSyncRules` で定義したソースロール群のいずれかを持つメンバーへターゲットロールを付与する。ロール ID はコード内にハードコードしており、変更する場合はソースを編集して再デプロイする。

## 前提

共通の前提 (SSH / Docker Compose v2 / Go / Task) は [arona/README.md](../../README.md) を参照。加えて:

- Discord Developer Portal で Bot を作成済みで、Bot Token と、対象サーバーへの招待 (Manage Roles を含む権限、rolesync 対象ロールより上位に Bot ロールを配置) が済んでいること

## 環境変数 (`.env`)

`.env.example` をコピーして作成する。`.env` は gitignore 済み。

| 変数 | 必須 | 説明 |
| --- | --- | --- |
| `DISCORD_TOKEN` | ○ | Bot Token |

## ローカルでの動作確認

```sh
set -a; source .env; set +a
go run . # services/arona/discord-bot/fun-council で実行
```

起動時にスラッシュコマンド `/remind` を登録し、不要な既存コマンドは削除する。停止 (SIGINT/SIGTERM) すると `/remind` を削除してから終了する。

## arona へのデプロイ

```sh
task deploy:fun-council   # services/arona で実行。ソース・Dockerfile・compose.yml・.env を転送し docker compose up -d --build
```

## 運用メモ

ログ確認・再起動・再デプロイは [arona/README.md](../../README.md) の共通パターン (`<dir>` = `discord-bot/fun-council`, `<name>` = `fun-council`) を参照。

### 障害切り分けの第一手

| 症状 | 最初に見る場所 |
| --- | --- |
| `/remind` が反応しない | `docker compose logs` で起動時の「コマンド登録」ログとエラーの有無。Bot がオンライン (Discord 上のステータス) かも確認 |
| リマインドが届かない | コンテナが再起動していないか (再起動するとメモリ上の予約タイマーは消える) |
| ロールが付かない | Bot ロールが対象ロールより上位に無いと `GuildMemberRoleAdd` が失敗する。ログの「ロール付与に失敗しました」を確認 |
| 起動しない | `DISCORD_TOKEN` 未設定 (`.env` 反映漏れ) |

### 既知の留意点

- ロール同期の対象ギルド ID・ソースロール ID・ターゲットロール ID は [`features/rolesync/rolesync.go`](./features/rolesync/rolesync.go) にハードコードされている。別ギルドや別ロールに変更する場合はコードを直接編集する。
- リマインダーはプロセスのメモリ上にのみ保持されるため、コンテナ再起動 (デプロイ含む) で未発火の予約は失われる。
