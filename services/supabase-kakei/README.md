# supabase-kakei 構成

[services README](../README.md) で説明したクラスタ FYNSV 上に、[ui-dev-kakei](https://github.com/famisics/ui-dev-kakei) 用のセルフホスト Supabase スタックを 1 LXC で構築する。Supabase Free プランはプロジェクトが 7 日間非アクティブだと一時停止するため、それを避ける目的で自宅環境に建てる。既存の `supabase` (VMID 200) は用途未確定のため触らず、この LXC を新規に切り出す。

| VMID | ホスト名          | 役割                                   | TF リソース ([containers.tf](../../terraform/containers.tf)) |
| ---- | ----------------- | -------------------------------------- | ---------------------------------------------------------------- |
| 225  | `supabase-kakei`  | Supabase セルフホストスタック (Docker) | `module.lxc["supabase-kakei"]`                                    |

リソース割り当て (ノード / IP / cores / RAM / rootfs / features) は [`../../terraform/`](../../terraform/) を正とする。

公開は `arona` で稼働中の `cloudflared` に Public Hostname を追加し、`kakei-supabase.uiro.dev` → `http://192.168.2.214:8000` (Gateway) に向ける。マイグレーション適用など Postgres への直接接続が必要な場合は、TCP の Public Hostname を別途 `5432` (session mode) 向けに追加する ([mysql/README.md](../mysql/README.md) の TCP 公開と同じ手順)。

## 前提

- `kakei-supabase.uiro.dev` を Cloudflare Zero Trust ダッシュボードで `arona` のトンネルに追加できる
- `root@pve01` に SSH で入れる。LXC 内部の操作は `pct enter 225` で行う
- 各種秘密鍵・パスワードは 1Password 管理 (本書では `change-me` をプレースホルダとする)

## 1. LXC (Terraform 管理)

宣言は [`../../terraform/containers.tf`](../../terraform/containers.tf) の `local.containers` にあり、`module.lxc["supabase-kakei"]` として払い出す。リソースは 4 vCPU 相当ではなく `container_defaults` の cores(2) のまま開始し、Supabase 公式が推奨する 4GB RAM / 32GB disk のみ上書きしている。不足すれば `containers.tf` を編集して `terraform apply` で拡張する。

```sh
cd terraform
terraform plan      # 変更が module.lxc["supabase-kakei"] の新規作成のみであることを確認
terraform apply
terraform output lxc_ipv4   # {"supabase-kakei":{"eth0":"192.168.2.214"}}
```

> [!NOTE]
> Supabase 公式の推奨要件は 2 vCPU / 4GB RAM (最小)、4 vCPU+ / 8GB+ RAM (推奨)。書き込み量が増えて重くなる場合は `cores` / `memory` を `containers.tf` で上書きする。

## 2. Supabase を Docker Compose で構築

以降は pve01 から `pct enter 225` でコンテナ内で実行する。

### 2.1 Docker 導入

```sh
export DEBIAN_FRONTEND=noninteractive
apt-get update && apt-get -y upgrade
apt-get -y install docker.io docker-compose git curl openssl
systemctl enable --now docker
```

### 2.2 リポジトリ取得と鍵生成

公式の自動セットアップスクリプトではなく、手動手順で `/opt/supabase-kakei/` に構築する (自動スクリプトは対話式 URL プロンプトがあり非対話運用に向かないため)。

```sh
git clone --depth 1 --branch self-hosted/v0.8.0 https://github.com/supabase/supabase /opt/supabase-src
mkdir -p /opt/supabase-kakei
cp -rf /opt/supabase-src/docker/. /opt/supabase-kakei
cd /opt/supabase-kakei
cp .env.example .env

# JWT_SECRET / ANON_KEY / SERVICE_ROLE_KEY を生成し .env に反映
sh utils/generate-keys.sh
sh utils/add-new-auth-keys.sh
```

`.env` に以下を追記・上書きする (パーミッション 600。パスワード類は 1Password 管理):

```sh
POSTGRES_PASSWORD=change-me
DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=change-me

SECRET_KEY_BASE=change-me   # openssl rand -base64 48
REALTIME_DB_ENC_KEY=change-me   # openssl rand -hex 8
VAULT_ENC_KEY=change-me   # openssl rand -hex 16

SUPABASE_PUBLIC_URL=https://kakei-supabase.uiro.dev
API_EXTERNAL_URL=https://kakei-supabase.uiro.dev/auth/v1
SITE_URL=http://192.168.2.214:8000
```

`API_EXTERNAL_URL` は `self-hosted/v0.8.0` の `.env.example` で `/auth/v1` パス付きがデフォルトになっている (Auth の OAuth コールバック / SAML / メールリンク組み立てに使われる)。

`SUPABASE_PUBLIC_URL` / `API_EXTERNAL_URL` は Cloudflare 経由の公開ホスト名を先に決めてから書く (§3 のトンネル設定と一致させる)。`SITE_URL` は Auth のデフォルトリダイレクト先で、後で ui-dev-kakei 本体の URL に変更する。

### 2.3 起動

```sh
cd /opt/supabase-kakei
sh run.sh start
docker compose ps   # 全サービスが healthy になるまで待つ
```

### 2.4 検証

```sh
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8000   # Studio (Basic 認証で 401 が返れば到達 OK)
```

LAN からの到達性は `curl -o /dev/null -w "%{http_code}\n" http://192.168.2.214:8000` で確認する。

## 3. cloudflared に Public Hostname を追加

`arona` の cloudflared は **token 方式 (remote-managed tunnel)** で動いており、ingress はすべて Cloudflare Zero Trust ダッシュボードで管理する ([mysql/README.md](../mysql/README.md) §「cloudflared に Public Hostname を追加」と同じ)。

### 実行場所: Cloudflare Zero Trust ダッシュボード

1. **Zero Trust > Networks > Tunnels** → arona のトンネル → **Configure** > **Public Hostnames** > **Add a public hostname**
   - **Subdomain**: `kakei-supabase`
   - **Domain**: `uiro.dev`
   - **Service > Type**: `HTTP`
   - **Service > URL**: `192.168.2.214:8000`
2. Postgres へ直接接続してマイグレーションを流す場合は、もう1つ Public Hostname を追加する。
   - **Subdomain**: `kakei-supabase-db`
   - **Service > Type**: `TCP`
   - **Service > URL**: `192.168.2.214:5432` (session mode。プールを使う場合は `6543`)

### 動作確認

```sh
curl -sS -o /dev/null -w "%{http_code}\n" https://kakei-supabase.uiro.dev
cloudflared access tcp --hostname kakei-supabase-db.uiro.dev --url localhost:15432 &
psql "postgresql://postgres:<POSTGRES_PASSWORD>@127.0.0.1:15432/postgres"
```

## 4. ui-dev-kakei からの利用

ui-dev-kakei 側 (別リポジトリ) で必要になる値は以下。値の反映やコード側の変更はこの構成の範囲外なので、ui-dev-kakei のリポジトリ側で行う。

| 用途                             | 値の取得元                                                    |
| -------------------------------- | -------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`       | `https://kakei-supabase.uiro.dev`                              |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`  | `/opt/supabase-kakei/.env` の `ANON_KEY`                        |
| `SUPABASE_SERVICE_ROLE_KEY`      | `/opt/supabase-kakei/.env` の `SERVICE_ROLE_KEY` (サーバー限定) |
| `supabase link` / `db:migrate`   | セルフホストは cloud project ref を持たないため、CLI からは `--db-url postgresql://postgres:<PW>@kakei-supabase-db.uiro.dev:5432/postgres` を直接指定する運用に変える必要がある |

既存の Supabase (cloud) プロジェクトからのデータ移行は、`supabase db dump` (cloud 側) → `psql` でこの Postgres にリストアする。スキーマ (`supabase/migrations/`) は ui-dev-kakei リポジトリのものをそのまま `supabase db push --db-url ...` で適用できる。

## 5. 運用メモ

### バックアップ

| 対象    | 推奨頻度 | 方法                                                                                                 |
| ------- | -------- | ------------------------------------------------------------------------------------------------------ |
| LXC 225 | 週次     | vzdump。Postgres データは Docker named volume として rootfs (`vm-pool`) 上にあり vzdump に含まれる |

`vzdump 225 --storage local --mode snapshot` を cron に置くか、Datacenter > Backup でジョブを組む。加えて `docker compose exec db pg_dump -U postgres postgres > backup.sql` の論理バックアップも定期的に取る (vzdump はディスクスナップショットのみで、単体テーブル復旧には向かない)。

### 更新

```sh
cd /opt/supabase-kakei
docker compose pull
sh run.sh start
```

マイグレーション (auth/storage/realtime の内部スキーマ) は起動時に各サービスが自動適用する。破壊的変更の有無は [self-hosted リリースノート](https://github.com/supabase/supabase/releases) を確認する。

### 障害切り分けの第一手

| 症状                              | 最初に見る場所                                             |
| --------------------------------- | ------------------------------------------------------------ |
| Studio / API にアクセスできない  | `pct enter 225` → `cd /opt/supabase-kakei && docker compose ps` |
| Auth / API だけ失敗する           | `docker compose logs --tail 50 auth` / `rest` / `api-gw` (ゲートウェイのサービス名。`self-hosted/v0.8.0` では Envoy ベースで `api-gw`。`kong` ではない) |
| 公開だけ落ちている (LAN は OK)    | arona で `journalctl -u cloudflared -n 50`、ダッシュボードの Public Hostname |
| DB 接続エラー                     | `docker compose logs --tail 50 db`、`.env` の `POSTGRES_PASSWORD` を確認 |

### 既知の留意点

- features は `nesting=1` のみ (`keyctl` は API トークンでは設定不可)。Docker は `overlay2` で動作する。
- `self-hosted/v0.8.0` ブランチはゲートウェイに Envoy を使い、旧来の Kong ベース構成とはサービス構成 (`docker compose.yml` のサービス名) が異なる。docs のバージョンが変わっている場合は `https://supabase.com/docs/guides/self-hosting/docker.md` を必ず再確認する。
- Studio は `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` の Basic 認証のみで保護される。Cloudflare 側でも Zero Trust Access ポリシーを追加し、二重に保護することを検討する。
