# Status Page 構成

[services README](../README.md) で説明したクラスタ FYNSV 上のサービス稼働状況とリソース使用量を収集・公開するステータスページ。

## 構成

```
health-checker  →  Turso (libSQL)  →  web
  (Bun 常駐)        (エッジ DB)       (Next.js / Vercel)
```

- **health-checker**: クラスタ内で常駐し、各サービスへのヘルスチェックと Proxmox API からのリソース取得を行い、結果を Turso に書き込む。
- **Turso**: チェック結果とリソーススナップショットを JSON で保持する libSQL データベース (`snapshots` / `service_meta`)。ORM は Drizzle を使用。
- **web**: Turso を読み取り、稼働状況・リソース推移を表示する Next.js アプリ。Vercel にデプロイする。

監視対象サービスの一覧 (ID / 名前 / カテゴリ / チェック方法 / 対応する Proxmox ゲスト) は [`health-checker/src/config.ts`](./health-checker/src/config.ts) が正となる。

## health-checker

クラスタ内の任意のノードで Docker Compose により常駐させる。

- 60 秒間隔で全有効サービスをチェックし、結果とリソーススナップショットを Turso に書き込む
- チェック方式は HTTP / TCP / ping の 3 種類。各サービスの方式は `config.ts` で定義
- リソース統計 (CPU / メモリ / ディスク / ネットワーク) は Proxmox API (`status/current`) から取得
- 90 日より古いレコードを毎日 04:00 に削除
- `:8090/healthz` でヘルスチェックを応答

### 必要な環境変数

`.env.example` を `.env` にコピーして設定する。

| 変数 | 用途 |
| --- | --- |
| `TURSO_URL` | Turso データベース URL |
| `TURSO_AUTH_TOKEN` | Turso 認証トークン |
| `PVE_API_TOKEN` | Proxmox API トークン (`monitor@pve!checker`)。リソース取得に使用 |

### 起動

```sh
cd health-checker
sudo docker compose up -d --build
```

ローカルで直接動かす場合:

```sh
cd health-checker
bun install
bun run dev    # --watch 付き
```

## web

Next.js (App Router) アプリ。Turso を読み取り専用で参照する。Vercel へのデプロイを前提とする。

- トップページ: サービスをカテゴリ (public / internal) ごとにグループ表示。各サービスに状態インジケータ・CPU/メモリ使用率・稼働率履歴 (24h / 7d / 30d) ・リソース使用量チャートを表示し、縦スクロールのみで全サービスを閲覧できる（ページ遷移なし）。30 秒ごとに自動更新する
- 直近のチェックが 3 分以上前の場合はデータが古い旨の警告を表示する
- 時間レンジ (24h / 7d / 30d) の切替はページ全体で共有し、切替時はページ遷移せずリソース使用量チャートのみを再取得する
- `/api/status`, `/api/history`: 現在状況と全サービス分の履歴（レンジ指定 `?range=`）を返す JSON API

### 必要な環境変数

`.env.example` を `.env` にコピーして設定する。Vercel ではプロジェクトの環境変数に同じ値を設定する。

| 変数 | 用途 |
| --- | --- |
| `TURSO_URL` | Turso データベース URL |
| `TURSO_AUTH_TOKEN` | Turso 認証トークン (読み取り) |

### 開発

```sh
cd web
bun install
bun run dev
```

| コマンド | 説明 |
| --- | --- |
| `bun run dev` | 開発サーバ |
| `bun run build` | 本番ビルド |
| `bun run lint` | Biome によるチェック |
| `bun run format` | Biome によるフォーマット |

## デプロイ

### 1. Turso セットアップ

```sh
turso db create ui-dev-status
turso db tokens create ui-dev-status
turso db show ui-dev-status --url
```

テーブルは health-checker 起動時に自動作成される。

### 2. Proxmox API トークン作成 (pve01)

```sh
pveum user add monitor@pve -enable 1 --comment "Status page monitoring (read-only)"
pveum role add Monitor -privs "VM.Audit Sys.Audit"
pveum aclmod / -user monitor@pve -role Monitor
pveum user token add monitor@pve checker --privsep=0
```

### 3. health-checker デプロイ (arona)

リポジトリ全体を clone せず、`health-checker/` ディレクトリだけを arona に配置する。

```sh
# ローカルから arona へコピー
scp -r services/status-page/health-checker arona:~/health-checker
```

arona 上で:

```sh
cd ~/health-checker
cp .env.example .env
# .env を編集: TURSO_URL, TURSO_AUTH_TOKEN, PVE_API_TOKEN
sudo docker compose up -d --build
```

更新時は同じ手順で上書きコピーし `sudo docker compose up -d --build` で反映する。

### 4. Vercel デプロイ

このリポジトリを Vercel に接続する場合、Next.js アプリはリポジトリルートではなくサブディレクトリにあるため **Root Directory** の設定が必要。

**Vercel Dashboard から:**
1. プロジェクトの Settings → General → **Root Directory** を `services/status-page/web` に設定
2. Environment Variables に `TURSO_URL` と `TURSO_AUTH_TOKEN` を追加
3. デプロイ

**CLI から:**
```sh
cd services/status-page/web
vercel link
# Root Directory を聞かれたら services/status-page/web を指定
vercel env add TURSO_URL
vercel env add TURSO_AUTH_TOKEN
vercel --prod
```

## 監視対象の追加・削除

### 新しいサービスを追加する

`health-checker/src/config.ts` にサービス定義を追加する。表示名・カテゴリは health-checker 起動時に Turso の `service_meta` テーブルへ自動同期されるため、web 側の編集は不要。

```typescript
{
  id: "new-service",           // 一意の ID（ケバブケース）
  name: "New Service",         // 表示名
  category: "internal",        // "public" or "internal"
  enabled: true,
  check: { type: "http", url: "http://192.168.2.xxx:8080", timeoutMs: 5000 },
  proxmox: { node: "pve02", vmid: 300, type: "lxc" },
},
```

チェック方式は 4 種類:

| type | 必須パラメータ | 用途 |
| --- | --- | --- |
| `http` | `url`, `timeoutMs`, `okStatuses?` | HTTP エンドポイントがあるサービス。`okStatuses` 省略時は任意の HTTP レスポンスで up |
| `tcp` | `host`, `port`, `timeoutMs` | ポートの到達性だけ確認（DB, Redis, SSH 等） |
| `ping` | `host`, `timeoutMs` | inbound ポートがないサービス。ICMP でコンテナ生存のみ確認 |
| `docker` | `container`, `timeoutMs` | ポート未公開で health-checker と同じ arona ホスト上に同居する Docker コンテナ。Docker ソケット経由でコンテナの running / health 状態を確認 |

### Docker チェック型のセキュリティと命名規約

health-checker の `compose.yaml` は `/var/run/docker.sock` を `:ro` マウントして `user: "0:0"` で実行する。`:ro` はソケットファイルの書き込みのみ制限し、Docker API 経由のあらゆる操作（コンテナ生成・exec・ホスト FS bind-mount など）は制限されない — つまり `docker.sock` アクセスは arona 上のホスト root 権限と等価である。コード上は現在 GET リクエストのみ発行している。

また、監視対象の 3 コンテナ（`fun-council-bot-1`, `misskey-mixi2-link-bridge-1`, `swarm-gcal-sync-sync-1`）は Docker Compose のデフォルト命名規約（`{project}-{service}-{index}`）に従っている。サービスの compose.yaml をリネーム・再構成・複数化した場合、コンテナ名が変わり、`config.ts` の `container` フィールドも併せて更新する必要がある。更新しないと、チェックが "no such container" エラーで "down" を報告する。

### 反映

```sh
task deploy:hc
```

web 側の再デプロイは不要（service_meta は DB 経由で自動反映される）。

### 既存サービスを無効化する

`config.ts` で `enabled: false` に変更する。Turso の既存データは残るので、過去の履歴は引き続き閲覧可能。

## トラブルシューティング

| 症状 | 原因・対処 |
| --- | --- |
| "No check data available yet." | health-checker 未起動、または Turso 接続失敗。arona のログを確認 |
| "Data may be stale" 警告 | health-checker 停止 or arona ダウン。arona の状態を確認 |
| 特定サービスだけ down | コンテナが停止。`pct list` で確認 |
| リソースが取得できない | PVE_API_TOKEN の権限を確認 (`VM.Audit`, `Sys.Audit`) |
| Vercel ビルド失敗 | `TURSO_URL` / `TURSO_AUTH_TOKEN` 環境変数の設定を確認 |
