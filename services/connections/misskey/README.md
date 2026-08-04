# Misskey 構成

[services README](../../README.md) で説明したクラスタ FYNSV 上に、Misskey を以下の 3 LXC 構成で構築する。

| VMID | ホスト名        | 役割                      | TF リソース ([containers.tf](../../../terraform/containers.tf)) |
| ---- | --------------- | ------------------------- | ------------------------------------------------------------ |
| 211  | `misskey-db`    | PostgreSQL 17             | `module.lxc["misskey-db"]`                                    |
| 212  | `misskey-redis` | Redis 7                   | `module.lxc["misskey-redis"]`                                 |
| 210  | `misskey-web`   | Misskey 本体 (Node.js 22) | `module.lxc["misskey-web"]`                                   |

リソース割り当て (ノード / IP / cores / RAM / rootfs / features) は [`../../../terraform/`](../../../terraform/) を正とする。

公開は `arona` (pve02, VMID 100) で稼働中の `cloudflared` に ingress を追加し、`misskey.<your-domain>` → `http://192.168.2.203:3000` に向ける。

## 前提

- 公開ホスト名 (本書では `misskey.example.com` とする) を切るドメインを Cloudflare で管理しており、Cloudflare Zero Trust ダッシュボードで `arona` のトンネルに対して **Public Hostname** を追加できる権限がある。DNS の CNAME はダッシュボードからの Public Hostname 追加で自動生成されるため、事前作業は不要
- `root@pve02` / `root@pve03` / `arona` に SSH で入れる
- LXC への root アクセスは Proxmox ノード経由 (`pct enter <vmid>`。SSH 鍵は投入しない)

以降、コマンドは見出しの「実行場所」に従う。

## 1. LXC (Terraform 管理)

3 LXC の構成は `terraform import` 済みで、[`../../../terraform/containers.tf`](../../../terraform/containers.tf) の `local.containers` が正。リソース割り当ての変更・再作成は Terraform で行う ([terraform/README.md](../../../terraform/README.md))。

## 2. misskey-db (PostgreSQL 17) 構築

### 実行場所: misskey-db (`pct enter 211` from pve02)

```sh
apt update && apt -y upgrade
apt -y install sudo postgresql postgresql-contrib locales

# Misskey は ja_JP.UTF-8 を使う場合があるので入れておく
sed -i 's/^# *\(ja_JP.UTF-8\|en_US.UTF-8\)/\1/' /etc/locale.gen
locale-gen
```

LAN からの接続を許可するため `listen_addresses` と `pg_hba.conf` を更新する。Debian 13 のクラスタは `main` という名前で `/etc/postgresql/17/main/` 配下にある。

```sh
PG_CONF=/etc/postgresql/17/main/postgresql.conf
PG_HBA=/etc/postgresql/17/main/pg_hba.conf

sed -i "s/^#\?listen_addresses.*/listen_addresses = '192.168.2.204'/" "$PG_CONF"

cat >> "$PG_HBA" <<'EOF'

# Misskey web (LXC 210)
host    misskey    misskey    192.168.2.203/32    scram-sha-256
EOF

systemctl restart postgresql@17-main
```

ロールと DB を作成する。パスワードは安全な値に置き換える (例として `change-me-db`)。

```sh
sudo -u postgres psql <<'EOF'
CREATE ROLE misskey WITH LOGIN PASSWORD 'change-me-db';
CREATE DATABASE misskey OWNER misskey ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0;
EOF
```

`LC_COLLATE = 'C'` は Misskey が要求するソート順 (id 生成方式 `aidx` 系の安全のため)。

## 3. misskey-redis 構築

### 実行場所: misskey-redis (`pct enter 212` from pve02)

```sh
apt update && apt -y upgrade
apt -y install sudo redis-server

REDIS_CONF=/etc/redis/redis.conf
sed -i 's/^bind .*/bind 192.168.2.205 -::1/' "$REDIS_CONF"
sed -i 's/^protected-mode .*/protected-mode yes/' "$REDIS_CONF"

# requirepass を末尾に追記 (パスワードは置き換える)
echo "requirepass change-me-redis" >> "$REDIS_CONF"

systemctl restart redis-server
```

接続確認 (misskey-web から):

```sh
# misskey-web で実行する想定
redis-cli -h 192.168.2.205 -a change-me-redis ping  # PONG が返ればよい
```

## 4. misskey-web 構築

### 実行場所: misskey-web (`pct enter 210` from pve03)

#### 4.1 依存パッケージと Node.js 22 のインストール

```sh
apt update && apt -y upgrade
apt -y install \
  sudo ca-certificates curl gnupg git build-essential python3 \
  ffmpeg libvips-tools \
  postgresql-client redis-tools \
  locales

# locale を有効化 (これをやらないと adduser / pnpm / Node が perl warning を吐く)
sed -i 's/^# *\(ja_JP.UTF-8\|en_US.UTF-8\)/\1/' /etc/locale.gen
locale-gen

# Node.js 22 を NodeSource からシステム全体に入れる
# (fnm 等のユーザ単位インストールだと misskey ユーザ / systemd unit から見えないので避ける)
mkdir -p /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
  | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
  > /etc/apt/sources.list.d/nodesource.list
apt update
apt -y install nodejs

# corepack を有効化して /usr/bin/pnpm を作る
corepack enable
```

#### 4.2 Misskey 専用ユーザと clone

```sh
adduser --system --group --home /opt/misskey --shell /bin/bash misskey
sudo -u misskey -H bash -lc '
  cd /opt/misskey
  git clone --depth 1 --branch master https://github.com/misskey-dev/misskey.git .
  pnpm install --frozen-lockfile
'
```

タグを固定したい場合は `--branch master` の代わりに `--branch v2025.x.x` 等を指定する。

#### 4.3 `.config/default.yml` を作成

`misskey-web` で以下を実行する。`url`、各種パスワード、`id` の方式は環境に合わせる。

```sh
sudo -u misskey -H tee /opt/misskey/.config/default.yml >/dev/null <<'EOF'
url: https://misskey.example.com/
port: 3000

db:
  host: 192.168.2.204
  port: 5432
  db: misskey
  user: misskey
  pass: change-me-db

redis:
  host: 192.168.2.205
  port: 6379
  pass: change-me-redis

id: 'aidx'

# arona の cloudflared が前段で TLS 終端するので、Misskey 自身は http で待ち受ける
# clusterLimit / workers は LXC のコア数に合わせる
clusterLimit: 4
EOF
```

#### 4.4 ビルドと DB マイグレーション

```sh
sudo -u misskey -H bash -lc '
  cd /opt/misskey
  NODE_ENV=production pnpm run build
  NODE_ENV=production pnpm run migrate
'
```

#### 4.5 systemd unit

```sh
tee /etc/systemd/system/misskey.service >/dev/null <<'EOF'
[Unit]
Description=Misskey daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=misskey
Group=misskey
WorkingDirectory=/opt/misskey
Environment=NODE_ENV=production
ExecStart=/usr/bin/pnpm run start
Restart=always
RestartSec=5
TimeoutStopSec=60
StandardOutput=journal
StandardError=journal
SyslogIdentifier=misskey

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now misskey
journalctl -u misskey -f
```

ログに `Now listening on port 3000` が出ればローカルは動いている。LAN から `curl -I http://192.168.2.203:3000/` で 200 (もしくはセットアップ前なら 200 の HTML) が返ることを確認する。

## 5. cloudflared に Misskey の Public Hostname を追加

`arona` の cloudflared は **token 方式 (remote-managed tunnel)** で動いている。`systemctl cat cloudflared` を見ると次のように `--token ...` を渡しているだけで、ローカルに `config.yml` は持たない。

```
ExecStart=/usr/bin/cloudflared --no-autoupdate tunnel run --token eyJhIjo...
```

この方式では ingress / Public Hostname の構成はすべて **Cloudflare Zero Trust ダッシュボード側で管理される**。ローカルに yaml を置いて `cloudflared tunnel ingress validate` で検証する流れは取らない (既存の supabase / archivebox が外部公開されていないのも、ダッシュボードに Public Hostname を切っていないため。LAN 内サービスとして閉じている意図的な構成)。

### 実行場所: Cloudflare Zero Trust ダッシュボード

1. **Zero Trust > Networks > Tunnels** を開く
2. arona で稼働中のトンネル (systemd unit のトークンに紐づくもの。ダッシュボード上の名前で照合) を選び、**Configure** > **Public Hostnames**
3. **Add a public hostname** をクリック:
   - **Subdomain**: `misskey`
   - **Domain**: (該当の Cloudflare ドメインを選択)
   - **Path**: 空欄
   - **Service > Type**: `HTTP`
   - **Service > URL**: `192.168.2.203:3000`
   - **Additional application settings > TLS > No TLS Verify**: オン (LAN 内通信が HTTP のため)
   - WebSocket は cloudflared が自動透過するので追加設定なし
4. Save。`misskey.<your-domain>` の CNAME (`<tunnel-id>.cfargotunnel.com` への向き先) が自動で生成される

### arona 側

特に作業なし。token 方式の cloudflared は Public Hostname の追加・変更をリアルタイムに反映するため、`systemctl reload cloudflared` も不要。

### 動作確認

```sh
# LAN 内から直接 (misskey-web)
curl -I http://192.168.2.203:3000/

# Cloudflare 経由
curl -I https://misskey.<your-domain>/
```

cloudflared 側のログは arona で `journalctl -u cloudflared -n 50 -f` で見られる。

## 6. 初回セットアップ確認

ブラウザで `https://misskey.example.com/` にアクセスし、Misskey のインスタンス初期セットアップ画面 (管理者ユーザ作成) が表示されればここまでで一区切り。WebSocket がうまく抜けない場合は cloudflared 側の `originRequest` を見直す。

## 7. メディアを Cloudflare R2 に逃がす (任意)

Misskey は標準ではアップロードされたメディアを `/opt/misskey/files/` に置くが、これだと:

- LXC 210 の rootfs を消費する (rootfs は Ceph RBD 上で 32 GiB しかない)
- バックアップに含まれて vzdump が重くなる
- 配信が常に Cloudflare Tunnel 経由 = misskey-web の帯域を食う

ので、Misskey の `objectStorage` を **Cloudflare R2** に向けて Cloudflare CDN から直接配信させる。R2 は 10 GB/月 のストレージと帯域無料枠があり、homelab のメディア用途には十分。

### 7.1 Cloudflare ダッシュボード側の準備

1. **R2 Object Storage** > **Create bucket**
   - Bucket name: `misskey-usercontent`
   - Location: `Asia-Pacific (APAC)` 推奨
2. 作成した bucket > **Settings** > **Public Access** > **Connect Domain**
   - 配信用ホスト名として `misskeyusercontent.uiro.dev` を接続する (Cloudflare 管理ドメインなので CNAME は自動で刺さる)
   - `r2.dev` の Public URL は使わないので有効化不要
3. R2 トップ > **Manage R2 API Tokens** > **Create API Token**
   - Permissions: **Object Read & Write**
   - Specify bucket: 上の bucket のみ (最小権限)
   - TTL: Forever
   - 表示される **Access Key ID** / **Secret Access Key** / **Endpoint** を控える (再表示不可)
4. R2 のサイドバー最下部に常時表示されている **Account ID** を控える

### 7.2 Misskey 管理画面でオブジェクトストレージを設定

**重要**: Misskey は `default.yml` の `objectStorage` セクションを **使わない**。設定は **DB の `meta` テーブル** に保存され、`DriveService` は `this.meta.useObjectStorage` を見て分岐するため、admin API (= 管理画面) 経由でないと有効化できない。

ブラウザで `https://ms.<your-domain>/admin/object-storage` を開き、以下を入力:

| ラベル                        | 値                                                      |
| ----------------------------- | ------------------------------------------------------- |
| 使用する (Use Object Storage) | **ON**                                                  |
| Base URL                      | `https://misskeyusercontent.uiro.dev`                   |
| Bucket                        | `misskey-usercontent`                                   |
| Prefix                        | `files`                                                 |
| Endpoint                      | `<ACCOUNT_ID>.r2.cloudflarestorage.com` (https:// なし) |
| Region                        | `auto`                                                  |
| Access Key ID                 | A-3 で発行したもの                                      |
| Secret Access Key             | A-3 で発行したもの                                      |
| SSL を使用                    | **ON**                                                  |
| プロキシを使用                | **OFF**                                                 |
| Path Style を使用             | **ON** ← R2 は path-style 必須                          |
| ACL に public-read を設定     | **OFF** ← R2 は ACL `public-read` を 400 で弾く         |

**保存** で完了。設定は即座に反映される (Misskey の restart 不要、DB の meta が更新されるだけ)。

R2 固有の落とし穴 3 つ:
- 「ACL に public-read を設定」を必ず OFF。ON のままだと PUT が 400 で失敗する
- 「Path Style を使用」必ず ON。R2 は virtual-hosted style 非対応
- Endpoint は `https://` を含めず `<ACCOUNT_ID>.r2.cloudflarestorage.com` のみ

`default.yml` の `objectStorage` セクションは混乱の元なので書かないこと。

### 7.3 動作確認

1. Misskey にログインして任意の画像 (プロフィール画像など) をアップロード
2. ブラウザの開発者ツール > Network で `<img>` の URL が `https://misskeyusercontent.uiro.dev/files/<UUID>` を指していれば成功
3. R2 のダッシュボードで bucket を開き、`files/` 配下にオブジェクトが追加されているか確認

### 7.4 既存ローカルファイルの扱い

`objectStorage` を有効にすると **以降のアップロード分** のみ R2 に置かれる。`/opt/misskey/files/` に残っている既存ファイルは Misskey が自動で移行はしない。

- ファイル数が少なければ Misskey 上で再アップロードする方が簡単
- 数が多い場合は `rclone` で `/opt/misskey/files/` を R2 の `files/` prefix にミラーする (Misskey の DB が持つ accessKey と R2 のオブジェクトキーが一致する必要があるので、prefix と階層に注意)

```sh
# 参考: rclone でのコピー (R2 remote 名 r2 を設定済み前提)
rclone copy /opt/misskey/files/ r2:misskey-usercontent/files/ --progress
```

### 7.5 rclone の R2 remote 設定 (参考)

上記の `r2` remote は `rclone.conf` (`~/.config/rclone/rclone.conf`) に以下のように定義する。R2 は path-style 必須・Region は `auto` (Section 7.2 の Misskey 側設定と同じ制約)。

```ini
[r2]
type = s3
provider = Cloudflare
access_key_id = <Access Key ID>
secret_access_key = <Secret Access Key>
endpoint = <ACCOUNT_ID>.r2.cloudflarestorage.com
acl = private
```

認証情報を含むため `chmod 600 ~/.config/rclone/rclone.conf` で保護する。DB バックアップ用の remote (Section 8) も同じ形式で、バケットとトークンを分けて追加する。

## 8. 運用メモ

### バックアップ単位

| 対象            | 推奨頻度 | 方法                                                                                                                      |
| --------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| LXC 211 (db)    | 日次     | 一次データ (投稿・ユーザー等) を保持する唯一のゲスト。`pg_dump` → Cloudflare R2 へアップロード (下記参照) + 週次 vzdump   |
| LXC 212 (redis) | 不要     | キャッシュ + ジョブキューのみで一次データを持たない。壊れても空の Redis として作り直せば復旧する                          |
| LXC 210 (web)   | 不要     | アプリケーションコードは git clone + 本 README の手順で再現可能。`/opt/misskey/files` は R2 移行済みなら空 (Section 7 参照) |
| R2 (メディア)   | 不要     | Cloudflare 側で冗長化済み                                                                                                  |

vzdump の保存先 `local` は node-local ストレージのため、ゲストが乗るノード自体が壊れると同じノード上の vzdump も道連れで失われる (詳細は [`../../README.md`](../../README.md) のストレージ構成参照)。misskey-db は一次データを持つ唯一のゲストなので、この穴を避けるためオフサイト (クラスタ外) の R2 にもバックアップする。

vzdump は Datacenter > Backup でジョブを組むか、各ノードで `vzdump 211 --storage <backup-storage> --mode snapshot` を cron に置く。

#### misskey-db の R2 バックアップ

1. Cloudflare ダッシュボードで専用バケット (例 `misskey-db-backup`。メディア用 `misskey-usercontent` とは別にする) を作成し、Object Read & Write 権限を当該バケットのみに絞った API Token を発行する (手順は Section 7.1 と同様)。Public Access は設定しない
2. バケットの **Object Lifecycle Rules** で一定日数 (例 30日) 超のオブジェクトを自動削除する設定にし、世代管理を R2 側に任せる
3. misskey-db (`pct enter 211`) に `rclone` を導入し、`rclone.conf` に専用 remote (例 `r2-db-backup`) を Section 7.5 の形式で追加する
4. `/usr/local/bin/misskey-db-backup.sh` を作成し `/etc/cron.d/misskey-db-backup` で日次実行する:

   ```sh
   #!/bin/sh
   set -eu
   DUMP=/var/backups/misskey-$(date +%F).dump
   # root からの peer 認証は misskey ロールと一致しないため、superuser の postgres 経由でダンプする
   sudo -u postgres pg_dump -Fc misskey > "$DUMP"
   rclone copy "$DUMP" r2-db-backup:misskey-db-backup/
   rm -f "$DUMP"
   find /var/backups -name 'misskey-*.dump' -mtime +3 -delete
   ```

   ローカルの dump は数日分のみ保持し (rootfs 圧迫回避)、実体の保持期間は R2 側の Lifecycle Rule に委ねる。

### 更新手順

- Misskey 本体: [`update-misskey.sh`](./update-misskey.sh) を misskey-web (`pct enter 210`) に root で転送・実行する。

  ```sh
  ./update-misskey.sh <new-tag>   # 例: ./update-misskey.sh 2026.6.0
  ```

  中身は以下の手順を自動化したもの (misskey ユーザで fetch/checkout/build/migrate → root で systemctl restart):

  ```sh
  cd /opt/misskey
  git fetch --tags
  git checkout <new-tag>
  ni --frozen-lockfile
  NODE_ENV=production nr build
  NODE_ENV=production nr migrate
  sudo systemctl restart misskey
  ```

- PostgreSQL メジャー更新 (misskey-db):

  ```sh
  apt -y install postgresql-<new-major>
  pg_upgradecluster 17 main
  pg_dropcluster --stop 17 main   # 動作確認後
  ```

- Redis: `apt -y upgrade && systemctl restart redis-server` のみ

### 障害切り分けの第一手

| 症状                          | 最初に見る場所                                                              |
| ----------------------------- | --------------------------------------------------------------------------- |
| Misskey が 502 / タイムアウト | `journalctl -u misskey -n 200` (misskey-web)                                |
| ログインや投稿が遅い          | misskey-db で `pg_stat_activity`、misskey-redis で `redis-cli info clients` |
| 添付メディアが消える / 出ない | `/opt/misskey/files` の容量と権限 (rootfs 32 GiB の使用率)                  |
| 公開だけ落ちている            | arona で `systemctl status cloudflared` と `cloudflared tunnel info`        |
| ノードごと落ちた                            | 生存ノードへ手動で移して起動する (HA 未導入) |

### 既知の留意点

- `id: 'aidx'` を後から変えると既存 ID と非互換になるため、初回セットアップで決めたら原則変えない
- Misskey は更新頻度が高い (月数回)。`misskey-web` の rootfs が `git` と `node_modules` で膨らむので、半年に一度 `pnpm store prune` (= `na store prune`) を回す
- `default.yml` の `objectStorage` セクションは Misskey 13 系では使われない (DB の `meta.useObjectStorage` を見るため)。R2 等への切り替えは Section 7 の通り `/admin/object-storage` で行う
- **サーバマシン統計 (CPU/Mem/Net/Disk I/O グラフ) は `enableServerMachineStats` を ON にした後、Misskey の restart が必要**。`ServerStatsService.start()` は起動時にフラグをチェックして tick の `setInterval` をセットする造りなので、起動中にトグルしても tick が始まらない
