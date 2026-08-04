# discord-bot/uiroid

本人の Misskey アカウント (`@uiroid`) 用の Discord bot。`/misskey-link` スラッシュコマンドで設定したハッシュタグ付きの本人ノートを、設定したチャンネルに転送する。

新規 LXC は払い出さず、`arona` (pve02, VMID 100) 上の Docker で常駐させる ([fun-council](../fun-council/) / [misskey-mixi2-link](../../misskey-mixi2-link/) と同じ形式)。外部公開はしない (Discord Gateway への outbound と Misskey Streaming API への outbound のみ)。

| 稼働先           | デプロイ形式                                      | 配置                          |
| ---------------- | -------------------------------------------------- | ----------------------------- |
| `arona` (VM 100) | Docker (`compose.yml`, `restart: unless-stopped`) | `~/discord-bot/uiroid` (Taskfile で転送) |

リソース割り当て (arona の cores / RAM 等) は [`../../../terraform/`](../../../terraform/) を正とする。

## 動作仕様

- **転送条件**: 本人アカウントの公開ノートのうち、リプライ・リノート・引用でなく、CW なしで、設定したハッシュタグを含むものだけ転送する。Misskey Streaming API で検知し、停止中の投稿は起動時に `users/notes` でバックフィルする。
- **転送先**: `/misskey-link channel` で設定した Discord チャンネル。未設定の間はスキップする (バックフィル・購読自体は継続する)。
- **本文**: ノート本文 + 画像 URL (画像添付がある場合) + 元ノートの URL (`MISSKEY_PUBLIC_ORIGIN` 起点)。
- **重複防止**: 転送済みノート ID を SQLite (`DB_PATH`) に記録し、再起動・イベント再配信時の二重転送を防ぐ。カーソルは転送対象外のノートでも常に進める。

### スラッシュコマンド (`/misskey-link`、要 Manage Server 権限)

| サブコマンド | 内容 |
| --- | --- |
| `channel` | 転送先チャンネルを設定する |
| `hashtag` | 監視するハッシュタグを設定する (`#` は省略可) |
| `status` | 現在の設定 (ハッシュタグ・転送先チャンネル) を表示する |

## 前提

- `arona` に SSH (`ssh arona`) で入れて Docker / Docker Compose v2 が使えること。
- ローカルに [Task](https://taskfile.dev/) があること (デプロイ用)。ビルド・テストを手元で回す場合は Go 1.25。
- Discord Developer Portal で Bot を作成済みで、`applications.commands` / `bot` スコープと `Send Messages` 権限を付与してサーバーに招待済みであること。
- Misskey の本人アカウントで API トークンを発行できること (`read:account` のみで足りる)。
- 上記トークンはすべて 1Password 管理 (リポジトリ・ゲストには `.env` 以外に置かない)。

## 1. 設定 (`.env`)

`.env.example` をコピーして `.env` を作る。`.env` は gitignore 済み。

| 変数 | 必須 | 説明 |
| --- | --- | --- |
| `DISCORD_TOKEN` | ○ | Discord bot のトークン (Developer Portal > Bot > Reset Token) |
| `MISSKEY_ORIGIN` | ○ | Misskey の接続先 (LAN 直結ならゲストの http URL、例 `http://192.168.2.203:3000`) |
| `MISSKEY_PUBLIC_ORIGIN` | ○ | 転送メッセージに付与する元ノート URL のオリジン (公開 URL) |
| `MISSKEY_USER_ID` | ○ | 本人アカウントのスクリーンネーム (`@` なし) |
| `MISSKEY_USER_TOKEN` | ○ | 本人アカウントのトークン (`read:account`) |
| `DB_PATH` | ○ | SQLite データベースファイルのパス (docker compose では `/data/uiroid.db`) |

## 2. ローカルでの動作確認 (任意)

```sh
cd ..                        # services/arona (モジュールルート)
go build ./...               # ビルド確認
go test ./discord-bot/uiroid/...   # フィルタ / ストアのテスト
```

## 3. arona へのデプロイ

```sh
task deploy:uiroid   # services/arona で実行。ソース・Dockerfile・compose.yml・.env を転送し docker compose up -d --build
```

`.env` も転送される。デプロイ後、コンテナは常駐し起動時にスラッシュコマンドを登録・不要なコマンドを削除、Misskey のバックフィルとストリーム購読を開始する。停止時 (SIGTERM/SIGINT) にはコマンドを削除してから終了する。

## 4. 検証

1. Discord で `/misskey-link channel` → 転送先チャンネルを設定
2. Discord で `/misskey-link hashtag` → 監視するハッシュタグを設定
3. Discord で `/misskey-link status` → 設定した内容が表示される
4. Misskey に設定したハッシュタグ付きの公開ノート (本人アカウント) を投稿 → 設定したチャンネルに本文 + 元ノート URL が出る
5. リプライ / リノート / CW 付き / ハッシュタグなし → **転送されない**
6. `docker compose restart` 直後に直前のノートが**二重転送されない** (SQLite 記録)
7. サービス停止中にノートを投稿 → 起動後にバックフィルで転送される

## 運用メモ

| 操作 | コマンド |
| --- | --- |
| ログ確認 | `ssh arona "cd ~/discord-bot/uiroid && docker compose logs -f"` |
| 再起動 | `ssh arona "cd ~/discord-bot/uiroid && docker compose restart"` |
| 再デプロイ | `task deploy:uiroid` |

### 障害切り分けの第一手

| 症状 | 最初に見る場所 |
| --- | --- |
| 起動しない | `docker compose logs` の起動ログ。`missing environment variables` なら `.env` 不足 |
| 転送されない | `/misskey-link status` でハッシュタグ・転送先チャンネルが設定済みか確認。次に misskey-web (`192.168.2.203:3000`) の死活とストリーミング接続ログ |
| 同じノートが二重に出る | `DB_PATH` の SQLite ファイルが volume マウントで永続化されているか (`compose.yml` の `volumes`) |
| スラッシュコマンドが反映されない | Discord のキャッシュ反映待ち。再起動すると再登録される |
