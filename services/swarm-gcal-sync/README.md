# Swarm → Google カレンダー 同期サービス

Swarm (Foursquare) のチェックイン履歴を Google カレンダーに同期する常駐サービス。毎日 JST 0:00 に前日分を取り込み、初回はバックフィルで過去の全履歴を取り込む。

新規 LXC は払い出さず、`arona` (pve01, VMID 100) 上の Docker で常駐させる ([discord-bot](../discord-bot/) と同じ形式)。外部公開はしない (送信のみ)。

| 稼働先          | デプロイ形式                       | 配置                         |
| --------------- | ---------------------------------- | ---------------------------- |
| `arona` (VM 100) | Docker (`compose.yml`, `restart: unless-stopped`) | `~/swarm-gcal-sync` (Taskfile で転送) |

リソース割り当て (arona の cores / RAM 等) は [`../../terraform/`](../../terraform/) を正とする。

## 動作概要

- **増分 (daemon)**: 毎日 JST 0:00 に直近 25 時間のチェックインを取得して登録 (1 時間は重ねて取りこぼしを防ぐ)。
- **冪等性**: イベント ID をチェックイン ID から決定的に生成 (`swarm<checkinID>`)。既に存在すれば Calendar API が 409 を返すのでスキップする。再実行・重複取得しても重複イベントは増えない。
- **イベント形式**: チェックイン時刻 (会場のタイムゾーン) を開始に、既定 60 分の時刻付きイベント。会場名をタイトル、住所を場所、コメント・カテゴリ・Swarm リンクを説明に入れる。

## 前提

- `arona` に SSH (`ssh arona`) で入れて Docker / Docker Compose v2 が使えること。
- ローカルに Go 1.24 と [Task](https://taskfile.dev/) があること。
- Google Cloud プロジェクトで **Google Calendar API** を有効化し、種類「デスクトップアプリ」または「ウェブアプリ」の OAuth 2.0 クライアントを作成済みであること。承認済みリダイレクト URI に `http://127.0.0.1:8765/callback` を登録する。
- [Foursquare 開発者ポータル](https://foursquare.com/developers/)でアプリを作成し、Redirect URI に `http://127.0.0.1:8765/callback` を登録済みであること。

## 認証情報の取得

すべてローカルで一度だけ実行し、得た値を `.env` (`.env.example` をコピー) に書く。

### 1. 同期先カレンダーを用意

Google カレンダーで専用カレンダー (例: `Swarm`) を新規作成し、その設定 > 「カレンダーの統合」にある **カレンダー ID** (`...@group.calendar.google.com`) を控える → `GOOGLE_CALENDAR_ID`。

### 2. Google の refresh token

```sh
GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy go run . -google-auth
```

表示された URL をブラウザで開いて同意すると、ターミナルに `GOOGLE_REFRESH_TOKEN=...` が出る。`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` を `.env` に書く。

> [!NOTE]
> refresh token が表示されない場合は、Google アカウントの[アプリ連携](https://myaccount.google.com/connections)から該当アプリのアクセスを一度解除してから再実行する (`prompt=consent` を付けているが、既存の付与があると返らないことがある)。

### 3. Foursquare のユーザートークン

```sh
FOURSQUARE_CLIENT_ID=xxx FOURSQUARE_CLIENT_SECRET=yyy go run . -foursquare-auth
```

同様に同意すると `FOURSQUARE_OAUTH_TOKEN=...` が出る。これを `.env` に書く (このトークンは長期有効でチェックイン取得に使う)。

## 環境変数 (`.env`)

| 変数 | 必須 | 説明 |
| --- | --- | --- |
| `FOURSQUARE_OAUTH_TOKEN` | ○ | Foursquare のユーザートークン |
| `FOURSQUARE_API_VERSION` | | API バージョン日付 (既定 `20240101`) |
| `GOOGLE_CLIENT_ID` | ○ | OAuth クライアント ID |
| `GOOGLE_CLIENT_SECRET` | ○ | OAuth クライアントシークレット |
| `GOOGLE_REFRESH_TOKEN` | ○ | `-google-auth` で取得した refresh token |
| `GOOGLE_CALENDAR_ID` | ○ | 同期先カレンダーの ID |
| `EVENT_DURATION_MINUTES` | | イベントの長さ (分、既定 60) |

`FOURSQUARE_CLIENT_ID` / `FOURSQUARE_CLIENT_SECRET` は `-foursquare-auth` 実行時のみ必要で、常駐には不要。

## ローカルでの動作確認

```sh
go run . -once       # 直近のチェックインを 1 回だけ同期 (再実行しても重複しないことを確認)
```

専用カレンダーに時刻付きイベントが現れれば成功。

## arona へのデプロイ

```sh
task deploy          # go.mod go.sum *.go Dockerfile compose.yml .env を転送し docker compose up -d --build
```

`.env` も転送される。デプロイ後、コンテナは常駐し毎日 JST 0:00 に同期する。

### 初回バックフィル

過去の全履歴を一度だけ取り込む:

```sh
task backfill        # arona 上で docker compose run --rm sync -backfill
```

## 運用メモ

| 操作 | コマンド |
| --- | --- |
| ログ確認 | `ssh arona "cd ~/swarm-gcal-sync && docker compose logs -f"` |
| 再起動 | `ssh arona "cd ~/swarm-gcal-sync && docker compose restart"` |
| 再デプロイ | `task deploy` |
| 手動で増分同期 | `ssh arona "cd ~/swarm-gcal-sync && docker compose run --rm sync -once"` |

### 障害切り分けの第一手

| 症状 | 最初に見る場所 |
| --- | --- |
| イベントが増えない | `docker compose logs` で「増分完了: N 件取得」の件数。0 件ならトークン失効か対象期間にチェックインが無い |
| Google 401/403 | refresh token 失効。`-google-auth` で取り直して `.env` 更新 → `task deploy` |
| Foursquare がエラー | `FOURSQUARE_OAUTH_TOKEN` 失効。`-foursquare-auth` で取り直す |
| 時刻がずれる | チェックインの `timeZoneOffset` を開始時刻に使う。`EVENT_DURATION_MINUTES` で長さ調整 |
