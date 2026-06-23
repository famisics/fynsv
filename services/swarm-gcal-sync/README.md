# Swarm → Google カレンダー 同期サービス

Swarm (Foursquare) のチェックイン履歴を Google カレンダーに同期する常駐サービス。毎日 JST 0:00 に前日分を取り込み、初回はバックフィルで過去の全履歴を取り込む。

新規 LXC は払い出さず、`arona` (pve01, VMID 100) 上の Docker で常駐させる ([discord-bot](../discord-bot/) と同じ形式)。外部公開はしない (送信のみ)。

| 稼働先          | デプロイ形式                       | 配置                         |
| --------------- | ---------------------------------- | ---------------------------- |
| `arona` (VM 100) | Docker (`compose.yml`, `restart: unless-stopped`) | `~/swarm-gcal-sync` (Taskfile で転送) |

リソース割り当て (arona の cores / RAM 等) は [`../../terraform/`](../../terraform/) を正とする。

## 動作概要

- **増分 (daemon)**: 毎日 JST 0:00 に直近 25 時間のチェックインを取得して登録 (1 時間は重ねて取りこぼしを防ぐ)。
- **冪等性 (upsert)**: イベント ID をチェックイン ID から決定的に生成 (`fsq<checkinID>`)。新規は作成、既存 (409) は Update で内容を反映する。再実行・重複取得しても重複は増えず、長さなどの変更は再同期で反映される。Google は削除済みイベントの ID を保持するため、削除した予定も同期範囲内なら復活する点に注意。
- **イベント形式**: チェックイン時刻 (会場のタイムゾーン) を開始に、既定 15 分の時刻付きイベント。会場名をタイトル、住所を場所、コメント・カテゴリ・Swarm リンクを説明に入れる。

## 前提

- `arona` に SSH (`ssh arona`) で入れて Docker / Docker Compose v2 が使えること。
- ローカルに Go 1.24 と [Task](https://taskfile.dev/) があること。
- Google Cloud プロジェクトで **Google Calendar API** を有効化し、**サービスアカウント**を作成して JSON 鍵をダウンロード済みであること (無人運用のため OAuth ではなく SA を使う。トークン失効が無い)。
- [Foursquare 開発者ポータル](https://foursquare.com/developers/)でアプリを作成し、Redirect URI に `http://127.0.0.1:8765/callback` を登録済みであること。

## 認証情報の取得

設定値は `.env` (`.env.example` をコピー) に、秘密ファイルはこのディレクトリの `secrets/` に置く。`.env` と `secrets/` は gitignore 済み。秘密ファイルのパスは `.env` で**相対パス** (`secrets/...`) を使うため、ローカル実行とコンテナ (`/app/secrets` にマウント) で同じ値が通る。

### 1. 同期先カレンダーを用意し SA に共有

1. Google カレンダーで専用カレンダー (例: `Swarm`) を新規作成する。
2. そのカレンダーの設定 > 「特定のユーザーやグループと共有」で、**サービスアカウントのメールアドレス** (`...@<project>.iam.gserviceaccount.com`) を「**予定の変更権限**」で追加する。
3. 同じ設定の「カレンダーの統合」にある **カレンダー ID** (`...@group.calendar.google.com`) を控える → `GOOGLE_CALENDAR_ID`。

### 2. サービスアカウント鍵を配置

ダウンロードした JSON 鍵を `secrets/credentials.json` として置く。

### 3. Foursquare のユーザートークン

`.env` に `FOURSQUARE_CLIENT_ID` / `FOURSQUARE_CLIENT_SECRET` を設定したうえで、`.env` を読み込んで認証フローを実行する。アプリが OAuth フローを行い、得たトークンを **`secrets/foursquare-token.json` に保存する** (手動コピー不要・`secrets/` は自動作成)。

```sh
set -a; source .env; set +a   # .env を環境変数として読み込む
go run . -foursquare-auth
```

ブラウザで同意すると `secrets/foursquare-token.json` が作られる。このトークンは長期有効で、チェックイン取得に使う。`secrets/` ごと deploy 時に arona へ転送される。

## 環境変数 (`.env`)

| 変数 | 必須 | 説明 |
| --- | --- | --- |
| `FOURSQUARE_CLIENT_ID` | △ | Foursquare アプリの Client ID (`-foursquare-auth` 時のみ必要) |
| `FOURSQUARE_CLIENT_SECRET` | △ | Foursquare アプリの Client Secret (`-foursquare-auth` 時のみ必要) |
| `FOURSQUARE_TOKEN_FILE` | | トークン保存先 (既定 `secrets/foursquare-token.json`) |
| `FOURSQUARE_API_VERSION` | | API バージョン日付 (既定 `20240101`) |
| `GOOGLE_CREDENTIALS_FILE` | | SA 鍵のパス (既定 `secrets/credentials.json`) |
| `GOOGLE_CALENDAR_ID` | ○ | 同期先カレンダーの ID |
| `EVENT_DURATION_MINUTES` | | イベントの長さ (分、既定 15) |

Foursquare トークンと Google SA 鍵はいずれも `secrets/` 内のファイルで持つため、`.env` に生のトークン・秘密鍵は置かない。

## ローカルでの動作確認

```sh
set -a; source .env; set +a
go run . -once       # 直近のチェックインを 1 回だけ同期 (再実行しても重複しないことを確認)
```

`.env` のパスは相対 (`secrets/...`) なので、ローカルでもパスの上書きは不要。専用カレンダーに時刻付きイベントが現れれば成功。

## arona へのデプロイ

```sh
task deploy          # ソース・Dockerfile・compose.yml・.env・secrets/ を転送し docker compose up -d --build
```

`.env` と `secrets/` (SA 鍵・Foursquare トークン) も転送される。デプロイ後、コンテナは常駐し毎日 JST 0:00 に同期する。

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
| Google 401/403/404 | カレンダーが SA に共有されているか (「予定の変更権限」)、`GOOGLE_CALENDAR_ID` と `credentials.json` が正しいかを確認 |
| Foursquare がエラー | トークン失効。`-foursquare-auth` で取り直して `task deploy` |
| 時刻がずれる | チェックインの `timeZoneOffset` を開始時刻に使う。`EVENT_DURATION_MINUTES` で長さ調整 |
