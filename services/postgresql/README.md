# postgresql

汎用 PostgreSQL 17 サーバー。VMID / IP / リソース量は `terraform/containers.tf` の `postgresql` エントリが正。

## 構築

PGDG リポジトリから PostgreSQL 17 を導入している。

```bash
apt-get install -y postgresql-common
/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
apt-get install -y postgresql-17
```

LAN からの接続を受け付けるため `postgresql.conf` / `pg_hba.conf` を以下のように設定している。

```conf
# postgresql.conf
listen_addresses = '*'
```

```conf
# pg_hba.conf
host    all    all    192.168.2.0/24    scram-sha-256
```

管理ロール `admin`（LOGIN SUPERUSER）を作成済み。パスワードはコンテナ内 `/root/.admin_pg_password` に保存しており、リポジトリにはコミットしない。

## 接続情報

drizzle 等のクライアントからは以下の経路で接続できる。

- **LAN**: `postgres://admin:<PW>@192.168.2.212:5432/postgres`（`terraform/containers.tf` の IP を参照）
- **Tailscale**: `arona` がサブネットルーターとして LAN (`192.168.2.0/24`) を代理公開しているため、tailnet 上のクライアントからは同じ LAN IP でそのまま到達できる

`<PW>` は admin ロールのパスワード。運用者に確認すること。

## 権限管理

DB ごとに read-only ロールを発行し、ユーザーへの GRANT で read 対象 DB を制御する運用。

- `grants/readonly-role.sql`: 指定 DB に対する `readonly_<db>` ロールを作成する冪等スクリプト
  ```bash
  psql -U admin -h 192.168.2.212 -v db=<dbname> -f grants/readonly-role.sql postgres
  ```
- `grants/example.sql`: ユーザー作成と `readonly_<db>` ロール付与の例

新しいユーザーに特定 DB の read 権限だけを与える場合:

```sql
CREATE ROLE alice LOGIN PASSWORD '...';
GRANT readonly_appdb TO alice;
```
