# dawarich 構成

[services README](../README.md) で説明したクラスタ FYNSV 上に、位置情報トラッキング・分析プラットフォーム [dawarich](https://dawarich.app) を構築する。

- 1 LXC + Docker Compose ([obsidian-livesync](../obsidian-livesync/README.md) と同じ構成)
- dawarich 公式配布の Compose 構成 (`dawarich_db` / `dawarich_redis` / `dawarich_app` / `dawarich_sidekiq` の4コンテナ) をそのまま使用

VMID / ノード / IP / リソース割り当ては [`../../terraform/containers.tf`](../../terraform/containers.tf) の `module.lxc["dawarich"]` エントリが正。

公開は `arona` で稼働中の `cloudflared` に Public Hostname を追加し、`dawarich.uiro.dev` → `http://192.168.2.213:3000` に向ける。スマホアプリ (Overland / GPSLogger 等) から位置情報を送信する用途が主目的のため、LAN 外からの到達性が必須。

## 前提

- `dawarich.uiro.dev` の Cloudflare Zero Trust ダッシュボードで `arona` のトンネルに **Public Hostname** を追加できる ([mysql/README.md](../mysql/README.md) §「cloudflared に Public Hostname を追加」と同じ手順)
- `root@pve03` に SSH で入れる。LXC 内部の操作は `pct enter 224` で行う
- DB パスワード / `SECRET_KEY_BASE` は 1Password 管理 (本書では `change-me` をプレースホルダとする)

## 1. LXC (Terraform 管理)

宣言は [`../../terraform/containers.tf`](../../terraform/containers.tf) の `local.containers` にあり、`module.lxc["dawarich"]` として払い出す。リソースは `container_defaults` のまま (2 vCPU / 2GB RAM / 16GB disk) で開始し、不足すれば `containers.tf` に上書き値を足して `terraform apply` で拡張する。

```sh
cd terraform
terraform plan      # 変更が module.lxc["dawarich"] の新規作成のみであることを確認
terraform apply
terraform output lxc_ipv4   # {"dawarich":{"eth0":"192.168.2.213"}}
```

## 2. dawarich を Docker Compose で構築

以降は pve03 から `pct enter 224` でコンテナ内で実行する。

### 2.1 Docker 導入

```sh
export DEBIAN_FRONTEND=noninteractive
apt-get update && apt-get -y upgrade
apt-get -y install docker.io docker-compose curl
systemctl enable --now docker
```

### 2.2 compose / .env を配置

`~/dawarich/` に以下を置く。`docker-compose.yml` は dawarich 公式リポジトリの [`docker/docker-compose.yml`](https://github.com/Freika/dawarich/blob/master/docker/docker-compose.yml) をそのまま使う。

`docker-compose.yml`:

```yaml
networks:
  dawarich:

services:
  dawarich_redis:
    image: redis:7.4-alpine
    container_name: dawarich_redis
    command: >
      redis-server
      --save 900 1
      --save 300 10
      --appendonly no
    networks:
      - dawarich
    volumes:
      - dawarich_shared:/data
    restart: always
    healthcheck:
      test: [ "CMD", "redis-cli", "--raw", "incr", "ping" ]
      interval: 10s
      retries: 5
      start_period: 30s
      timeout: 10s

  dawarich_db:
    image: postgis/postgis:17-3.5-alpine
    shm_size: 1G
    container_name: dawarich_db
    volumes:
      - dawarich_db_data:/var/lib/postgresql/data
      - dawarich_shared:/var/shared
    networks:
      - dawarich
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-password}
      POSTGRES_DB: ${POSTGRES_DB:-dawarich_development}
    restart: always
    healthcheck:
      test: [ "CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-postgres} -d ${POSTGRES_DB:-dawarich_development}" ]
      interval: 10s
      retries: 5
      start_period: 30s
      timeout: 10s

  dawarich_app:
    image: freikin/dawarich:latest
    container_name: dawarich_app
    volumes:
      - dawarich_public:/var/app/public
      - dawarich_watched:/var/app/tmp/imports/watched
      - dawarich_storage:/var/app/storage
      - dawarich_db_data:/dawarich_db_data
    networks:
      - dawarich
    ports:
      - "${DAWARICH_APP_PORT:-3000}:3000"
    stdin_open: true
    tty: true
    entrypoint: web-entrypoint.sh
    command: ['bin/rails', 'server', '-p', '3000', '-b', '::']
    restart: on-failure
    environment:
      RAILS_ENV: ${RAILS_ENV:-production}
      REDIS_URL: ${REDIS_URL:-redis://dawarich_redis:6379}
      DATABASE_HOST: ${DATABASE_HOST:-dawarich_db}
      DATABASE_PORT: ${DATABASE_PORT:-5432}
      DATABASE_USERNAME: ${DATABASE_USERNAME:-postgres}
      DATABASE_PASSWORD: ${DATABASE_PASSWORD:-password}
      DATABASE_NAME: ${DATABASE_NAME:-dawarich_development}
      APPLICATION_HOSTS: ${APPLICATION_HOSTS:-localhost,::1,127.0.0.1}
      TIME_ZONE: ${TIME_ZONE:-Europe/London}
      APPLICATION_PROTOCOL: ${APPLICATION_PROTOCOL:-http}
      PROMETHEUS_EXPORTER_ENABLED: ${PROMETHEUS_EXPORTER_ENABLED:-false}
      SECRET_KEY_BASE: ${SECRET_KEY_BASE:-"CHANGE_ME"}
      RAILS_LOG_TO_STDOUT: ${RAILS_LOG_TO_STDOUT:-true}
      SELF_HOSTED: ${SELF_HOSTED:-true}
      STORE_GEODATA: ${STORE_GEODATA:-true}
    logging:
      driver: "json-file"
      options:
        max-size: ${LOG_MAX_SIZE:-100m}
        max-file: ${LOG_MAX_FILE:-5}
    healthcheck:
      test: [ "CMD-SHELL", "wget -qO - http://127.0.0.1:3000/api/v1/health | grep -q '\"status\"\\s*:\\s*\"ok\"'" ]
      interval: 10s
      retries: 30
      start_period: 30s
      timeout: 10s
    depends_on:
      dawarich_db:
        condition: service_healthy
        restart: true
      dawarich_redis:
        condition: service_healthy
        restart: true
    deploy:
      resources:
        limits:
          cpus: ${APP_CPU_LIMIT:-0.50}
          memory: ${APP_MEMORY_LIMIT:-4G}

  dawarich_sidekiq:
    image: freikin/dawarich:latest
    container_name: dawarich_sidekiq
    volumes:
      - dawarich_public:/var/app/public
      - dawarich_watched:/var/app/tmp/imports/watched
      - dawarich_storage:/var/app/storage
    networks:
      - dawarich
    stdin_open: true
    tty: true
    entrypoint: sidekiq-entrypoint.sh
    command: ['sidekiq']
    restart: on-failure
    environment:
      RAILS_ENV: ${RAILS_ENV:-production}
      REDIS_URL: ${REDIS_URL:-redis://dawarich_redis:6379}
      DATABASE_HOST: ${DATABASE_HOST:-dawarich_db}
      DATABASE_PORT: ${DATABASE_PORT:-5432}
      DATABASE_USERNAME: ${DATABASE_USERNAME:-postgres}
      DATABASE_PASSWORD: ${DATABASE_PASSWORD:-password}
      DATABASE_NAME: ${DATABASE_NAME:-dawarich_development}
      APPLICATION_HOSTS: ${APPLICATION_HOSTS:-localhost,::1,127.0.0.1}
      BACKGROUND_PROCESSING_CONCURRENCY: ${BACKGROUND_PROCESSING_CONCURRENCY:-5}
      APPLICATION_PROTOCOL: ${APPLICATION_PROTOCOL:-http}
      PROMETHEUS_EXPORTER_ENABLED: ${PROMETHEUS_EXPORTER_ENABLED:-false}
      SECRET_KEY_BASE: ${SECRET_KEY_BASE:-"CHANGE_ME"}
      RAILS_LOG_TO_STDOUT: ${RAILS_LOG_TO_STDOUT:-true}
      SELF_HOSTED: ${SELF_HOSTED:-true}
      STORE_GEODATA: ${STORE_GEODATA:-true}
    logging:
      driver: "json-file"
      options:
        max-size: ${LOG_MAX_SIZE:-100m}
        max-file: ${LOG_MAX_FILE:-5}
    healthcheck:
      test: [ "CMD-SHELL", "pgrep -f sidekiq" ]
      interval: 10s
      retries: 30
      start_period: 30s
      timeout: 10s
    depends_on:
      dawarich_db:
        condition: service_healthy
        restart: true
      dawarich_redis:
        condition: service_healthy
        restart: true
      dawarich_app:
        condition: service_healthy
        restart: true

volumes:
  dawarich_db_data:
  dawarich_shared:
  dawarich_public:
  dawarich_watched:
  dawarich_storage:
```

`.env` (パーミッション 600。パスワードは 1Password 管理):

```sh
POSTGRES_PASSWORD=change-me
POSTGRES_DB=dawarich_production
DATABASE_PASSWORD=change-me
DATABASE_NAME=dawarich_production
SECRET_KEY_BASE=change-me   # openssl rand -hex 64 で生成
APPLICATION_HOSTS=192.168.2.213,dawarich.uiro.dev
APPLICATION_PROTOCOL=https
TIME_ZONE=Asia/Tokyo
RAILS_ENV=production
SELF_HOSTED=true
STORE_GEODATA=true
```

- `POSTGRES_PASSWORD` = `DATABASE_PASSWORD` (同じ値にする): 前者は `dawarich_db` の初期化用、後者は `dawarich_app`/`dawarich_sidekiq` の接続用
- `DATABASE_HOST` / `DATABASE_USERNAME` / `DATABASE_PORT` / `REDIS_URL` は compose 側のデフォルト (`dawarich_db` / `postgres` / `5432` / `redis://dawarich_redis:6379`) で足りるため `.env` では上書きしない
- 環境変数の全リストは [Environment Variables](https://dawarich.app/docs/self-hosting/environment-variables) を参照

### 2.3 起動と初回セットアップ

```sh
cd ~/dawarich
docker compose up -d
docker compose ps   # 4サービスすべて healthy になるまで待つ (db/redis → app → sidekiq の順)
```

ブラウザで `http://192.168.2.213:3000` を開き、サインアップ画面から最初のユーザーを作成する。

### 2.4 検証

```sh
curl -sS http://192.168.2.213:3000/api/v1/health   # {"status":"ok",...}
```

## 3. cloudflared に Public Hostname を追加

`arona` の cloudflared は **token 方式 (remote-managed tunnel)** で動いており、ingress はすべて Cloudflare Zero Trust ダッシュボードで管理する ([mysql/README.md](../mysql/README.md) §「cloudflared に Public Hostname を追加」と同じ)。

### 実行場所: Cloudflare Zero Trust ダッシュボード

1. **Zero Trust > Networks > Tunnels** → arona のトンネル → **Configure** > **Public Hostnames** > **Add a public hostname**
   - **Subdomain**: `dawarich`
   - **Domain**: `uiro.dev`
   - **Path**: 空欄
   - **Service > Type**: `HTTP`
   - **Service > URL**: `192.168.2.213:3000`
2. Save。`dawarich.uiro.dev` の CNAME が自動生成される。

### 動作確認

```sh
curl -sS https://dawarich.uiro.dev/api/v1/health
```

> [!NOTE]
> Cloudflare 無料プランは proxied リクエストのボディ上限が **100 MB**。写真統合機能などで大きいファイルをアップロードする場合は上限に注意する。

## 4. 運用メモ

### バックアップ

| 対象    | 推奨頻度 | 方法                                                                                       |
| ------- | -------- | ------------------------------------------------------------------------------------------ |
| LXC 224 | 週次     | vzdump。named volume (`dawarich_db_data` 等) は `/var/lib/docker/volumes/` (rootfs) 上にあり vzdump に含まれる |

`vzdump 224 --storage local --mode snapshot` を cron に置くか、Datacenter > Backup でジョブを組む。

### 更新

```sh
cd ~/dawarich
docker compose pull
docker compose up -d
```

マイグレーションは `dawarich_app` の起動時に自動実行される。破壊的変更の有無は [Updating Guide](https://dawarich.app/docs/self-hosting/updating/) を確認する。

### 障害切り分けの第一手

| 症状                              | 最初に見る場所                                             |
| --------------------------------- | ------------------------------------------------------------ |
| アプリにアクセスできない          | `pct enter 224` → `docker compose logs --tail 50 dawarich_app` |
| インポートやジオコーディングが進まない | `docker compose logs --tail 50 dawarich_sidekiq`            |
| 公開だけ落ちている (LAN は OK)    | arona で `journalctl -u cloudflared -n 50`、ダッシュボードの Public Hostname |
| DB 接続エラー                     | `docker compose logs --tail 50 dawarich_db`、`.env` の `POSTGRES_PASSWORD`/`DATABASE_PASSWORD` 一致を確認 |

### 既知の留意点

- PostGIS 拡張は `postgis/postgis` イメージに内蔵済みで追加作業不要。ARM ノードの場合は `imresamu/postgis:17-3.5-alpine` に差し替える (compose ファイルにコメントあり)。
- `freikin/dawarich:latest` は pin せず latest 追従。更新時に予期しない挙動変化が出た場合は [CHANGELOG](https://github.com/Freika/dawarich/blob/master/CHANGELOG.md) を確認する。
- features は `nesting=1` のみ (`keyctl` は API トークンでは設定不可)。Docker は `overlay2` で動作する。
