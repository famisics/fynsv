# postgresql → MySQL(MariaDB) + phpMyAdmin 移行設計

汎用 PostgreSQL 17 + DbGate サービス (`services/postgresql`) を廃止し、同じコンテナ (VMID 214 / `pve01` / `192.168.2.212`) を MariaDB + phpMyAdmin に置き換える。既存 DB にデータはなく破棄してよい。

## コンテナの扱い

`terraform/containers.tf` の `local.containers` にある `postgresql` エントリを削除し、同じ `vm_id` / `target_node` / `memory` / `disk_size` / `ip_address` で `mysql` エントリを新規追加する。エントリのキー名 (map のインデックス) を変えるため、Terraform 上は `module.lxc["postgresql"]` の destroy と `module.lxc["mysql"]` の create になる。同一 apply 内で両方を扱うと同じ VMID (214) の生成・削除が並行実行されうるため、**destroy のみの apply → create のみの apply の2段階**に分けて実行する。

## コンテナ内構成

### 1. Docker

`services/obsidian-livesync` と同じ手順 (`docker.io` + `docker-compose` パッケージ = Compose v2) で導入する。

### 2. MariaDB (Debian 13 標準リポジトリ)

- Debian 13 には本家 MySQL の apt パッケージが無く、`mysql-server` 相当は MariaDB へのエイリアスであるため、素直に `mariadb-server` を使う
- `bind-address = 0.0.0.0` で LAN からの接続を許可
- 管理ユーザー `admin` を作成し、`192.168.2.212` (phpMyAdmin の Docker bridge 経由の自己接続) と `192.168.2.%` (LAN) の両方から `ALL PRIVILEGES` を許可
- パスワードはコンテナ内 `/root/.admin_mysql_password` に保存し、リポジトリにはコミットしない
- DB ごとの発行スクリプトや readonly ロールの自動化は今回は用意しない

### 3. phpMyAdmin (Docker Compose)

- `phpmyadmin/phpmyadmin` イメージをポート `8080:80` で公開 (DbGate が使っていた `3000` は使わず紛らわしさを避ける)
- `PMA_HOST=192.168.2.212`, `PMA_PORT=3306` を環境変数で指定し、bridge ネットワークからホスト自身の LAN IP 経由で MariaDB に到達する
- ログインは phpMyAdmin 自身の画面で MariaDB の `admin` 認証情報を都度入力する方式とし、DbGate にあったアプリ側ログイン (`.env` の `DBGATE_LOGIN`/`DBGATE_PASSWORD`) は廃止する

### 4. cloudflared — `mysql.uiro.dev`

- `arona` の cloudflared は token 方式 (remote-managed tunnel) で稼働しており、コンテナ側に cloudflared を追加導入する必要はない
- Cloudflare Zero Trust ダッシュボードで Public Hostname (`mysql.uiro.dev`, Service Type `TCP`, URL `192.168.2.212:3306`) を追加する
- クライアントは `cloudflared access tcp --hostname mysql.uiro.dev --url localhost:<port>` でローカルポートに転送してから接続する

## リポジトリ側の変更

- `services/postgresql/` (README.md, docker-compose.yml, .env, .env.example, .gitignore, grants/, scripts/) を削除する
- `services/mysql/README.md` + `services/mysql/docker-compose.yml` を新規作成する
- `services/README.md` の索引は元々 postgresql サービスを記載していなかったため変更不要
- 過去の `docs/superpowers/specs/2026-07-02-postgresql-lxc-design.md` / `docs/superpowers/plans/2026-07-02-postgresql-lxc.md` は履歴として残し、削除・書き換えしない

## 成功基準

- `terraform apply` 完了後、コンテナ 214 が Debian 13 ベースラインで起動している
- LAN から `mysql -h 192.168.2.212 -u admin -p` で接続できる
- `http://192.168.2.212:8080` で phpMyAdmin にアクセスし、`admin` 認証情報でログインできる
- `mysql.uiro.dev` 経由で外部から接続できる
- `services/postgresql` が repo から削除され、`services/mysql/README.md` が実態と一致している
