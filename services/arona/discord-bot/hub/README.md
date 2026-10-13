# discord-bot/hub

複数のサーバーに招待でき、サーバー管理者が Web 管理画面から機能を設定できる Discord bot。bot と管理画面は 1 つのプロセス (Bun) で動く。

配置先: `~/discord-bot/hub`。共通の稼働先・リソース割り当ての正・運用操作は [arona/README.md](../../README.md) を参照。

## 機能

設定はすべてサーバーごとに持ち、管理画面から編集する。

| 機能 | 内容 |
| --- | --- |
| リマインダー | `/remind` で予約した通知。SQLite に保存するので再起動しても残る。管理画面で一覧・取り消し・機能の無効化ができる |
| ロール自動付与 | 「ソースロールのいずれかを持つメンバーに、ターゲットロールを付与する」ルールを複数持てる。15 分ごとに全メンバーを走査する |
| 参加・退出メッセージ | メンバーの参加・退出を指定チャンネルに知らせる。`{user}` (参加時はメンション、退出時はユーザー名) と `{server}` を使える。空のメッセージの側は送らない |
| Misskey 転送 | 運営アカウント (`MISSKEY_USER_ID`) の公開ノートのうち、リプライ・リノート・CW でなく、設定したハッシュタグを含むものを転送する。Streaming で検知し、停止中の投稿は起動時にバックフィルする。初回起動時は過去分を転送しない |
| bot の見た目 | サーバーごとにニックネーム・アイコン・バナー・自己紹介を変える (`PATCH /guilds/{id}/members/@me`)。アプリ名そのもの (スラッシュコマンド一覧の表示) は変わらない |

### スラッシュコマンド

| コマンド | 内容 |
| --- | --- |
| `/remind message time [channel]` | 日本時間の `HH:MM` または `MM/DD HH:MM` に通知する。過去の時刻は、`HH:MM` なら翌日、`MM/DD HH:MM` なら翌年になる。1 人 25 件まで |

### 認証・認可

- 管理画面は Discord OAuth2 (`identify guilds`) でログインする。ログイン後、サーバー管理 (Manage Server) 権限を持つサーバーだけ一覧に出る
- 設定の読み書きは API ごとに、bot から見たそのメンバーの権限をその場で確認する。権限を外された管理者はすぐ操作できなくなる
- ロール自動付与のターゲットに設定できるのは、設定する本人が付与できるロール (ロール管理権限があり、本人の最上位ロールより下で、本人が持つ権限の範囲内) に限る。bot の権限を使った権限昇格を防ぐため
- セッションは SQLite に保存し、Cookie にはランダムな ID だけを持たせる (7 日間)

## 前提

- Discord Developer Portal でアプリを作成済みであること
  - Bot > Privileged Gateway Intents の **Server Members Intent** を有効にする (ロール自動付与と参加・退出メッセージに必要)
  - OAuth2 > Redirects に `<PUBLIC_URL>/auth/callback` を登録する
  - OAuth2 > Client Secret を発行する
- 管理画面を公開する Public Hostname を、arona の cloudflared に追加すること (`hub.<domain>` → `http://localhost:8091`)。設定は Cloudflare Zero Trust ダッシュボードで行う ([misskey の README](../../../misskey/README.md) と同じ方式)
- Misskey の本人アカウントで API トークンを発行できること (`read:account` のみで足りる)
- トークン類は 1Password 管理 (リポジトリ・ゲストには `.env` 以外に置かない)

## 1. 設定 (`.env`)

`.env.example` をコピーして `.env` を作る。`.env` は gitignore 済み。

| 変数 | 必須 | 説明 |
| --- | --- | --- |
| `DISCORD_TOKEN` | ○ | bot のトークン |
| `DISCORD_CLIENT_ID` | ○ | アプリケーション ID |
| `DISCORD_CLIENT_SECRET` | ○ | OAuth2 のクライアントシークレット |
| `PUBLIC_URL` | ○ | 管理画面の公開 URL (末尾スラッシュなし)。`https://` なら Cookie に Secure を付ける |
| `PORT` | | 待ち受けポート (既定 `8091`。`compose.yml` の `ports` と揃える) |
| `DB_PATH` | ○ | SQLite のパス (docker compose では `/data/hub.db`) |
| `MISSKEY_ORIGIN` | ○ | Misskey の接続先 (LAN 直結ならゲストの http URL) |
| `MISSKEY_USER_ID` | ○ | 運営アカウントのスクリーンネーム (`@` なし) |
| `MISSKEY_USER_TOKEN` | ○ | 運営アカウントのトークン (`read:account`) |

## 2. ローカルでの開発

[ni](https://github.com/antfu-collective/ni) と [Bun](https://bun.sh/) が必要。

```bash
ni                  # 依存のインストール
nr dev              # bot + API (http://localhost:8091)
nr dev:web          # 管理画面 (http://localhost:5173。/api と /auth は 8091 に中継)
nr typecheck        # 型チェック (出力なし)
nr test             # テスト
```

ローカルでは `.env` の `PUBLIC_URL` を `http://localhost:5173` にし、Redirects に `http://localhost:5173/auth/callback` を足す。

## 3. デプロイ

```bash
cd services/arona/discord-bot/hub
task deploy
```

`nr build` で管理画面をビルドし、ソース・Dockerfile・compose.yml・`.env` を arona の `~/discord-bot/hub` に転送して `docker compose up -d --build` を実行する。DB は配置先の `./data` に置かれる。

起動時に、グローバルのスラッシュコマンドを一括で登録し直す。

## 4. 障害切り分け

| 症状 | 確認 |
| --- | --- |
| 管理画面にログインできない | Redirects に `<PUBLIC_URL>/auth/callback` が登録されているか。`PUBLIC_URL` が実際のアクセス先と一致しているか |
| サーバー一覧に自分のサーバーが出ない | そのサーバーでサーバー管理権限を持っているか。権限を付与した直後は、いったんログアウトして入り直す |
| 「bot を招待」を押しても「設定」に変わらない | 招待を完了したか。画面を再読み込みする |
| ロール自動付与が動かない | Server Members Intent が有効か。bot のロールがターゲットロールより上にあるか。`docker compose logs` に「ロール付与に失敗」が出ていないか |
| 参加・退出メッセージが出ない | 機能が有効か、チャンネルとメッセージを設定したか。bot がそのチャンネルに送信できるか |
| bot の見た目の保存に失敗する | 画面に Discord のエラーが出る。短時間に何度も変更するとレート制限にかかる |
| Misskey の転送が止まる | ログの `misskey stream disconnected` を確認する。切断されても 3 秒後に自動で再接続する |
