# Obsidian Self-hosted LiveSync 構成

[README](../../cluster/README.md) で説明したクラスタ FYNSV 上に、Obsidian の [Self-hosted LiveSync](https://github.com/vrtmrz/obsidian-livesync) のバックエンド (CouchDB) を 1 LXC で構築する。fly.io は使わず、LXC 内の Docker で CouchDB を動かす。

| VMID | ホスト名            | 役割                        | TF リソース ([containers.tf](../../terraform/containers.tf)) |
| ---- | ------------------- | --------------------------- | ------------------------------------------------------------ |
| 213  | `obsidian-livesync` | CouchDB 3.3 (Docker) 同期口 | `module.lxc["obsidian-livesync"]`                             |

リソース割り当て (ノード / IP / cores / RAM / rootfs / features) は [`../../terraform/`](../../terraform/) を正とする。

公開は `arona` (pve01, VMID 100) で稼働中の `cloudflared` に Public Hostname を追加し、`obsidian-livesync.<your-domain>` → `http://192.168.2.206:5984` に向ける。Obsidian モバイル (iOS/Android) は HTTPS 必須なので、この経路が同期に必須。

## 前提

- 公開ホスト名を切るドメインを Cloudflare で管理しており、Cloudflare Zero Trust ダッシュボードで `arona` のトンネルに **Public Hostname** を追加できる。DNS の CNAME は Public Hostname 追加で自動生成されるため事前作業は不要
- `root@pve03` に SSH で入れる。LXC 内部の操作は `pct enter 213` で行う (本構成は SSH 鍵を注入していない)
- CouchDB の管理者ユーザ / パスワードは 1Password 管理 (本書では `obsidian` / `change-me-couchdb` をプレースホルダとする)

## 1. LXC (Terraform 管理)

宣言は [`../../terraform/containers.tf`](../../terraform/containers.tf) の `local.containers` にあり、`module.lxc["obsidian-livesync"]` として払い出し済み (misskey 群の import と異なり宣言的に作成)。リソース割り当ての変更は Terraform で行う ([terraform/README.md](../../terraform/README.md))。`keyctl` を `false` のままにする理由は containers.tf のコメント参照。

```sh
cd projects/fynsv/terraform
terraform plan      # 変更が module.lxc["obsidian-livesync"] の差分のみであることを確認
terraform apply
terraform output lxc_ipv4   # {"obsidian-livesync":{"eth0":"192.168.2.206"}}
```

## 2. CouchDB を Docker で構築

以降は pve03 から `pct enter 213` でコンテナ内で実行する。

### 2.1 Docker 導入

```sh
export DEBIAN_FRONTEND=noninteractive
apt-get update && apt-get -y upgrade
apt-get -y install docker.io docker-compose curl
systemctl enable --now docker
```

> [!NOTE]
> Debian 13 (trixie) には Ubuntu の `docker-compose-v2` パッケージは無い。Debian の `docker-compose` が Compose v2 (2.26.x、Go 版) を提供し、`docker compose` / `docker-compose` のどちらでも呼べる。

### 2.2 compose / 設定ファイルを配置

`/opt/obsidian-livesync/` に以下を置く。

`docker-compose.yml`:

```yaml
services:
  couchdb:
    image: couchdb:3.3
    container_name: obsidian-livesync-couchdb
    restart: unless-stopped
    env_file: .env
    ports:
      - 5984:5984
    volumes:
      - ./data:/opt/couchdb/data
      - ./config:/opt/couchdb/etc/local.d
```

`.env` (パーミッション 600。パスワードは 1Password 管理):

```sh
COUCHDB_USER=obsidian
COUCHDB_PASSWORD=change-me-couchdb
```

`config/obsidian-livesync.ini` (LiveSync 公式 [couchdb-init.sh](https://github.com/vrtmrz/obsidian-livesync/blob/main/utils/couchdb/couchdb-init.sh) 相当の設定 + single-node 化):

```ini
[chttpd]
require_valid_user = true
enable_cors = true
max_http_request_size = 4294967296

[chttpd_auth]
require_valid_user = true

[cluster]
n = 1
q = 1

[cors]
credentials = true
origins = app://obsidian.md,capacitor://localhost,http://localhost
headers = accept, authorization, content-type, origin, referer, cache-control, x-requested-with
methods = GET, PUT, POST, HEAD, DELETE, OPTIONS, PATCH
max_age = 3600

[couchdb]
single_node = true
max_document_size = 50000000
```

> [!IMPORTANT]
> `[cluster] n = 1` / `q = 1` を必ず入れる。これが無いと single-node なのに複製数 `n` が既定の 3 のままで、システム DB 作成時に `Request to create N=3 DB but only 1 node(s)` で失敗する。`config` ディレクトリは CouchDB の `local.d` にマウントしており、公式イメージの entrypoint が書く `docker.ini` (admin 情報) と並んで読まれる。

### 2.3 起動とシステム DB の作成

```sh
cd /opt/obsidian-livesync
docker compose up -d

# .env から認証情報を読み、システム DB と vault DB を作成
. ./.env
for db in _users _replicator _global_changes obsidiandb; do
  curl -sS -X PUT "http://$COUCHDB_USER:$COUCHDB_PASSWORD@127.0.0.1:5984/$db"; echo
done
```

`single_node = true` を入れて起動すると `_users` / `_replicator` は自動作成される (上記ループでは `file_exists` が返る)。`_global_changes` と vault DB (`obsidiandb`) を作成する。vault DB 名は Obsidian プラグイン側の設定と一致させる。

### 2.4 検証

```sh
. ./.env
curl -sS "http://$COUCHDB_USER:$COUCHDB_PASSWORD@127.0.0.1:5984/_up"                # {"status":"ok",...}
curl -sS "http://$COUCHDB_USER:$COUCHDB_PASSWORD@127.0.0.1:5984/_node/_local/_config/cors"   # origins に app://obsidian.md 等
curl -sS -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:5984/obsidiandb"        # 401 (require_valid_user)
curl -sS "http://$COUCHDB_USER:$COUCHDB_PASSWORD@127.0.0.1:5984/_all_dbs"           # _global_changes,_replicator,_users,obsidiandb
```

LAN からの到達性は pve03 ホスト等から `curl -o /dev/null -w "%{http_code}\n" http://192.168.2.206:5984/` で確認できる (認証なしなので **401** が返れば到達 OK)。

## 3. cloudflared に Public Hostname を追加

`arona` の cloudflared は **token 方式 (remote-managed tunnel)** で動いており、ingress はすべて Cloudflare Zero Trust ダッシュボードで管理する ([misskey/README.md](../misskey/README.md) §5 と同じ。ローカル `config.yml` は持たない)。

### 実行場所: Cloudflare Zero Trust ダッシュボード

1. **Zero Trust > Networks > Tunnels** → arona のトンネル → **Configure** > **Public Hostnames** > **Add a public hostname**
   - **Subdomain**: `obsidian-livesync` (任意)
   - **Domain**: 該当の Cloudflare ドメイン
   - **Path**: 空欄
   - **Service > Type**: `HTTP`
   - **Service > URL**: `192.168.2.206:5984`
   - **Additional application settings > TLS > No TLS Verify**: オン (LAN 内通信が HTTP のため)
2. Save。`obsidian-livesync.<your-domain>` の CNAME が自動生成される。

### 動作確認

```sh
curl -sS https://obsidian-livesync.<your-domain>/_up   # {"status":"ok"} 系 (401 ならパスを付けず認証要求)
```

> [!WARNING]
> Cloudflare 無料プランは proxied リクエストのボディ上限が **100 MB**。LiveSync はドキュメントをチャンク分割するため通常は問題ないが、巨大な添付や初回の大量同期で詰まる場合は、LiveSync のチャンクサイズを小さめにするか、初回だけ LAN (`http://192.168.2.206:5984`) で同期してから Cloudflare 経由に切り替える。

## 4. Obsidian プラグイン設定

各端末で **Self-hosted LiveSync** プラグインを導入し、Remote Type に **CouchDB** を選んで以下を設定する。

| 項目              | 値                                          |
| ----------------- | ------------------------------------------- |
| URI               | `https://obsidian-livesync.<your-domain>`   |
| Username          | `obsidian`                                  |
| Password          | 1Password の CouchDB パスワード             |
| Database name     | `obsidiandb`                                |

- `Test Database Connection` と `Check and fix database configuration` がすべて緑になることを確認する。
- End-to-End 暗号化のパスフレーズを設定すると、サーバ (CouchDB) 側にも平文を残さない。全端末で同じパスフレーズを使う。
- 最初の 1 台で初期化したら、他端末は同じ設定 + `Copy setup URI` で取り込むと早い。

## 5. 運用メモ

### バックアップ

| 対象     | 推奨頻度 | 方法                                                                              |
| -------- | -------- | --------------------------------------------------------------------------------- |
| LXC 213  | 週次     | vzdump。CouchDB データは `/opt/obsidian-livesync/data` (rootfs = `vm-pool` 16 GiB) にあり vzdump に含まれる |

`vzdump 213 --storage local --mode snapshot` を cron に置くか、Datacenter > Backup でジョブを組む。端末側にも vault の実体が残るので、CouchDB は「同期のハブ」であり唯一の正本ではない。

### 更新

```sh
cd /opt/obsidian-livesync
docker compose pull        # couchdb:3.3 の最新パッチを取得
docker compose up -d
```

CouchDB のメジャー更新時は `image: couchdb:3.x` を上げてから `docker compose up -d`。data ボリュームは保持される。

### 障害切り分けの第一手

| 症状                                   | 最初に見る場所                                                            |
| -------------------------------------- | ------------------------------------------------------------------------ |
| Obsidian が同期しない / 接続不可        | `pct enter 213` → `docker compose logs --tail 50 couchdb`                |
| 公開だけ落ちている (LAN は OK)          | arona で `journalctl -u cloudflared -n 50`、ダッシュボードの Public Hostname |
| `Check database configuration` が赤    | `config/obsidian-livesync.ini` の CORS / require_valid_user を再確認      |
| 大きいファイルだけ同期失敗              | Cloudflare 100 MB 制限。チャンクサイズ縮小か初回 LAN 同期 (§3 の警告)     |

### 既知の留意点

- features は `nesting=1` のみ (`keyctl` は API トークンで立てられない)。Docker は `overlay2` で動作する。
- アクセスは pve03 からの `pct enter 213` が基本 (SSH 鍵は未注入)。
- CouchDB の admin パスワードを変えるときは `.env` を更新して `docker compose up -d`、加えて既存 admin は `local.d/docker.ini` 経由で設定されるため、必要なら `_node/_local/_config/admins` も確認する。
