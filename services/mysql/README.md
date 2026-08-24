# mysql

MariaDB + phpMyAdmin。VMID / IP / リソース量は `terraform/containers.tf` の `mysql` エントリが正。

旧 `postgresql` サービス (PostgreSQL + DbGate) を廃止し、同じコンテナを作り直して構築している。

## 構築

Debian 13 標準リポジトリの MariaDB をネイティブインストールしている(本家 MySQL 非互換の apt リポジトリは使わない)。

```bash
apt-get install -y docker.io docker-compose curl
systemctl enable --now docker
apt-get install -y mariadb-server
```

LAN からの接続を受け付けるため `bind-address` を変更している。

```conf
# /etc/mysql/mariadb.conf.d/50-server.cnf
bind-address            = 0.0.0.0
```

- 管理ユーザー `admin` (`ALL PRIVILEGES WITH GRANT OPTION`) を作成済み
- ホストは phpMyAdmin の Docker bridge 経由の自己接続用に `192.168.2.212`、LAN 用に `192.168.2.%` の2つを許可
- パスワードはコンテナ内 `/root/.admin_mysql_password` に保存しており、リポジトリにはコミットしない

DB ごとの発行スクリプトや readonly ロールの自動化は用意していない。

## 接続情報

- **LAN**: `mysql://admin:<PW>@192.168.2.212:3306`(`terraform/containers.tf` の IP を参照)
- **Tailscale**: `arona` がサブネットルーターとして LAN (`192.168.2.0/24`) を代理公開しているため、tailnet 上のクライアントからは同じ LAN IP でそのまま到達できる
- **外部 (cloudflared)**: `mysql.uiro.dev`。`cloudflared access tcp --hostname mysql.uiro.dev --url localhost:13306` でローカルポートに転送してから接続する (下記「cloudflared に Public Hostname を追加」参照)

`<PW>` は admin ユーザーのパスワード。運用者に確認すること。

## phpMyAdmin

Docker コンテナとして常設している。

```bash
docker compose up -d
```

`docker-compose.yml` は `phpmyadmin/phpmyadmin` イメージをポート 8080 で起動し、`PMA_HOST` / `PMA_PORT` でホスト自身の LAN IP 上の MariaDB を指す。ログインはアプリ側の認証ではなく、phpMyAdmin の画面で MariaDB の `admin` 認証情報を都度入力する方式。

- アクセス: `http://192.168.2.212:8080`

## cloudflared に Public Hostname を追加

`arona` の cloudflared は **token 方式 (remote-managed tunnel)** で動いており、ingress はすべて Cloudflare Zero Trust ダッシュボードで管理する ([misskey/README.md](../misskey/README.md) §5 と同じ。コンテナ側に cloudflared は入れない)。MySQL プロトコルは HTTP ではなく生 TCP なので、Service Type は `TCP` を選ぶ。

### 実行場所: Cloudflare Zero Trust ダッシュボード

1. **Zero Trust > Networks > Tunnels** → arona のトンネル → **Configure** > **Public Hostnames** > **Add a public hostname**
   - **Subdomain**: `mysql`
   - **Domain**: 該当の Cloudflare ドメイン
   - **Service > Type**: `TCP`
   - **Service > URL**: `192.168.2.212:3306`
2. Save。`mysql.uiro.dev` の CNAME が自動生成される。

### 動作確認 (作業マシンから)

```sh
cloudflared access tcp --hostname mysql.uiro.dev --url localhost:13306 &
mysql -h 127.0.0.1 -P 13306 -u admin -p
```
