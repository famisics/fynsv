# misskey-mixi2-link 構成 (Misskey ⇔ mixi2 投稿ブリッジ)

see also [../../README.md](../../README.md) / [../misskey/README.md](../misskey/README.md)

[services README](../../README.md) で説明したクラスタ FYNSV 上の Misskey ([../misskey/README.md](../misskey/README.md)) と
[mixi2](https://mixi.social) の間で投稿を相互コピーするブリッジ。本体は Go 製でこのディレクトリに同梱する。

新規 LXC は払い出さず、`arona` (pve02, VMID 100) 上の Docker で常駐させる ([swarm-gcal-sync](../swarm-gcal-sync/) / [discord-bot](../discord-bot/) と同じ形式)。外部公開はしない (送信のみ)。

| 稼働先           | デプロイ形式                                      | 配置                                  |
| ---------------- | ------------------------------------------------- | ------------------------------------- |
| `arona` (VM 100) | Docker (`compose.yml`, `restart: unless-stopped`) | `~/misskey-mixi2-link` (Taskfile で転送) |

リソース割り当て (arona の cores / RAM 等) は [`../../../terraform/`](../../../terraform/) を正とする。

## 動作仕様

- **Misskey → mixi2**: 本人アカウントの公開ノートのうち bot (例: `@uiroid`) をメンションしたものだけ、メンションを除去して mixi2 の bot アカウントが自動転載する。Misskey Streaming API で検知し、停止中の投稿は起動時に `users/notes` でバックフィルする。
- **mixi2 → Misskey**: mixi2 で投稿に bot をメンションしたものだけ、メンションを除去して Misskey の専用 bot アカウントに転載する。mixi2 公式 Application API の gRPC ストリーミング (POST_MENTIONED イベント) で受信する。
  (mixi2 公式 Application API にはユーザーの投稿一覧取得がなく、イベントも bot 宛てのみのため、規約準拠で実現できるのはメンション方式)

| 条件 | 扱い |
| --- | --- |
| リプライ / リノート・引用 | 転送しない |
| 公開範囲が public 以外 / CW 付き | 転送しない |
| 149 文字超 (mixi2 上限) | 切り詰めて元ノートの URL を付与 |
| 画像 | 転送する (最大 4 枚、超過分は切り捨て / ダウンロード → 再アップロード)。動画は対象外 |

ループ防止は構造的に成立する: Misskey 側は本人のノートのうち bot メンション付きのものだけ拾い、転載先は別の bot アカウント。mixi2 側は bot へのメンションのみ拾い、転載は bot 自身の投稿 (メンションを含まない)。加えて [Turso](https://turso.tech) (libSQL) の処理済み記録が再起動・イベント再配信時の二重転送を防ぐ。

## アーキテクチャ

```
                FYNSV LAN (192.168.2.0/24)
┌────────────────────────┐      ┌───────────────────────────────────┐
│ misskey-web            │◀─WS──│ arona (VM 100) Docker             │
│ Misskey :3000 (http)   │◀REST─│  bridge (Go コンテナ)             │
└────────────────────────┘      │   ├ misskey watcher (streaming)   │──▶ mixi2 Application API
                                │   ├ mixi2 watcher (gRPC stream)   │    (gRPC, outbound のみ)
                                │   ├ 変換 / フィルタ                │
                                │   └ Turso (処理済み ID 記録)       │──▶ Turso (libSQL, outbound)
                                └───────────────────────────────────┘
```

全接続がアウトバウンド (Misskey へは LAN 内 WebSocket/REST、mixi2 へは gRPC ストリーミング、Turso へは HTTPS)。
**inbound ポート開放も cloudflared も不要**で、公開面はゼロ。

## 前提

- `arona` に SSH (`ssh arona`) で入れて Docker / Docker Compose v2 が使えること。
- ローカルに [Task](https://taskfile.dev/) があること (デプロイ用)。ビルド・テストを手元で回す場合は Go 1.25。
- Misskey に転載先の **bot アカウント**を作成済みで、API トークンを 2 本発行できること
  - 本人アカウント: ストリーミング購読・ノート読み取り用
  - bot アカウント: `write:notes` / `write:drive`
- [mixi2 Developer Platform](https://developer.mixi.social/) の利用申請が済み、bot の `client_id` / `client_secret` を取得済みであること
- [Turso](https://turso.tech) でデータベースを作成し、接続 URL と認証トークンを取得済みであること
- 上記トークン・クレデンシャルはすべて 1Password 管理 (リポジトリ・ゲストには `.env` 以外に置かない)

## 1. アカウントとトークンの準備

### 実行場所: Misskey Web UI

1. bot 用アカウントを作成し、プロフィールで「Bot として設定」を有効にする。
2. **設定 > API > アクセストークンの発行**で 2 本発行し、1Password に保存する。
   - 本人アカウント: 既定の読み取り権限のみ
   - bot アカウント: `ノートを作成・削除する` / `ドライブを操作する`
3. 本人アカウントのスクリーンネーム (`@` なし) と、bot のスクリーンネームを控える。

### 実行場所: mixi2 Developer Platform

1. bot アプリケーションの `client_id` / `client_secret` を 1Password に保存する。
2. bot のスクリーンネームと本人のスクリーンネーム (どちらも `@` なし) を控える。

### 実行場所: Turso

```sh
turso db show <db-name> --url     # → TURSO_DATABASE_URL
turso db tokens create <db-name>  # → TURSO_AUTH_TOKEN
```

## 2. 設定 (`.env`)

`.env.example` をコピーして `.env` を作る。`.env` は gitignore 済み。`DRY_RUN=1` で実投稿せず変換結果のログだけ出す。

| 変数 | 必須 | 説明 |
| --- | --- | --- |
| `MISSKEY_ORIGIN` | ○ | Misskey の接続先 (LAN 直結ならゲストの http URL、例 `http://192.168.2.203:3000`) |
| `MISSKEY_PUBLIC_ORIGIN` | ○ | 切り詰め時に付与する元ノート URL のオリジン (公開 URL) |
| `MISSKEY_USER_ID` | ○ | 本人アカウントのスクリーンネーム (`@` なし) |
| `MISSKEY_USER_TOKEN` | ○ | 本人アカウントのトークン (`read:account`) |
| `MISSKEY_BOT_ID` | ○ | Misskey bot のスクリーンネーム (`@` なし / これをメンションした本人ノートだけ転送する) |
| `MISSKEY_BOT_TOKEN` | ○ | bot アカウントのトークン (`write:notes` / `write:drive`) |
| `MIXI2_CLIENT_ID` | ○ | mixi2 bot アプリの Client ID |
| `MIXI2_CLIENT_SECRET` | ○ | mixi2 bot アプリの Client Secret |
| `MIXI2_BOT_ID` | ○ | mixi2 bot のスクリーンネーム (`@` なし / これをメンションした投稿だけ転送する) |
| `MIXI2_USER_ID` | ○ | 本人のスクリーンネーム (`@` なし / メンション元の検証用) |
| `TURSO_DATABASE_URL` | ○ | Turso の接続 URL (`file:` のローカル DB も可) |
| `TURSO_AUTH_TOKEN` | △ | Turso の認証トークン (`file:` のローカル DB では不要) |
| `DRY_RUN` | | `1` で実投稿せず変換結果のログだけ出す |

## 3. ローカルでの動作確認 (任意)

```sh
cd ..                                  # services/arona (モジュールルート)
go build ./...                         # ビルド確認
go test ./misskey-mixi2-link/...       # フィルタ / 変換 / ストアのテスト
DRY_RUN=1 go run ./misskey-mixi2-link  # 実投稿せず変換結果のログだけ確認
```

## 4. arona へのデプロイ

```sh
task deploy:misskey-mixi2-link   # services/arona で実行。ソース・Dockerfile・compose.yml・.env を転送し docker compose up -d --build
```

`.env` も転送される。デプロイ後、コンテナは常駐し両方向のブリッジを継続する。

## 5. 検証

1. Misskey に bot メンション付きのテキストノートを公開で投稿 → mixi2 の bot アカウントに同文 (メンション除去済み) が出る
2. 150 文字超のノート → 切り詰め + 元ノート URL 付きで出る
3. 画像付きノート → 画像ごと (最大 4 枚) 転載される
4. リプライ / リノート / フォロワー限定 / CW 付き → **転載されない**
5. mixi2 で bot をメンションして投稿 (テキスト / 画像) → Misskey の bot アカウントにメンション除去済みで出る
6. `docker compose restart` 直後に直前の投稿が**二重転載されない** (Turso 記録)
7. サービス停止中に Misskey へ投稿 → 起動後にバックフィルで転載される

## 運用メモ

| 操作 | コマンド |
| --- | --- |
| ログ確認 | `ssh arona "cd ~/misskey-mixi2-link && docker compose logs -f"` |
| 再起動 | `ssh arona "cd ~/misskey-mixi2-link && docker compose restart"` |
| 再デプロイ | `task deploy:misskey-mixi2-link` |

### 障害切り分けの第一手

| 症状 | 最初に見る場所 |
| --- | --- |
| どちらの方向も転載されない | `docker compose logs` の起動ログ。`missing environment variables` なら `.env` 不足 |
| Misskey → mixi2 だけ止まる | misskey-web (`192.168.2.203:3000`) の死活、mixi2 API 障害 (トークン取得エラーのログ) |
| mixi2 → Misskey だけ止まる | gRPC ストリーム再接続ログ、Misskey bot トークンの失効 |
| 同じ投稿が二重に出る | Turso のレコード消失。仕様上 at-least-once のため稀に発生しうる |
