# postgresql

汎用 PostgreSQL 17 サーバー。VMID / IP / リソース量は `terraform/containers.tf` の `postgresql` エントリが正。

## Tailscale から管理画面を開く

`arona` が LAN (`192.168.2.0/24`) をサブネットルーターとして代理公開しているため、コンテナ側での追加設定は不要。tailnet に参加した端末から LAN IP に直接アクセスできる。

- pgAdmin 4: `http://192.168.2.212/pgadmin4`
- pgconsole: `http://192.168.2.212:9876`

ログイン情報は `.env`（`.env.example` を参照。リポジトリにはコミットしない）。

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
- **外部 (cloudflared)**: `psql.uiro.dev`。`cloudflared access tcp --hostname psql.uiro.dev --url localhost:15432` でローカルポートに転送してから接続する (下記「cloudflared に Public Hostname を追加」参照)

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

## 管理コンソール

### pgAdmin 4

PGDG の pgAdmin4 apt リポジトリ (`trixie`) から `pgadmin4-web` を導入し、Apache 上で web モードとして動作させている。

```bash
apt-get install -y gnupg
curl -fsS https://www.pgadmin.org/static/packages_pgadmin_org.pub | gpg --dearmor -o /usr/share/keyrings/packages-pgadmin-org.gpg
echo "deb [signed-by=/usr/share/keyrings/packages-pgadmin-org.gpg] https://ftp.postgresql.org/pub/pgadmin/pgadmin4/apt/trixie pgadmin4 main" > /etc/apt/sources.list.d/pgadmin4.list
apt-get update && apt-get install -y pgadmin4-web
PGADMIN_PLATFORM_TYPE=debian PGADMIN_SETUP_EMAIL=<email> PGADMIN_SETUP_PASSWORD=<password> /usr/pgadmin4/bin/setup-web.sh --yes
```

- アクセス: `http://192.168.2.212/pgadmin4`
- ログインメール: `dev@uiro.dev`。パスワードはコンテナ内 `/root/.pgadmin_password` に保存

### pgconsole

[pgplex/pgconsole](https://github.com/pgplex/pgconsole) は GitHub Releases の単一バイナリではなく npm パッケージ (`@pgplex/pgconsole`, Node.js 20+ 必須) として配布されている。NodeSource から Node.js を導入し、npm でグローバルインストールしている。

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
npm install -g @pgplex/pgconsole
```

設定は `/etc/pgconsole/config.toml`（TOML、`[[connections]]` に admin ロールの接続情報、`[[users]]` / `[[iam]]` でログインユーザーと権限を定義）。専用の非ログインシステムユーザー `pgconsole` が所有し、他ユーザーからは読めない。systemd unit (`/etc/systemd/system/pgconsole.service`) で `User=pgconsole` として常駐させている。

- アクセス: `http://192.168.2.212:9876`
- ログインメール: `dev@uiro.dev`。パスワードはコンテナ内 `/root/.pgconsole_password` に保存

## cloudflared に Public Hostname を追加

`arona` の cloudflared は **token 方式 (remote-managed tunnel)** で動いており、ingress はすべて Cloudflare Zero Trust ダッシュボードで管理する ([misskey/README.md](../misskey/README.md) §5 と同じ。コンテナ側に cloudflared は入れない)。PostgreSQL は HTTP ではなく生 TCP なので、Service Type は `TCP` を選ぶ。

### 実行場所: Cloudflare Zero Trust ダッシュボード

1. **Zero Trust > Networks > Tunnels** → arona のトンネル → **Configure** > **Public Hostnames** > **Add a public hostname**
   - **Subdomain**: `psql`
   - **Domain**: 該当の Cloudflare ドメイン
   - **Service > Type**: `TCP`
   - **Service > URL**: `192.168.2.212:5432`
2. Save。`psql.uiro.dev` の CNAME が自動生成される。

### 動作確認 (作業マシンから)

```sh
cloudflared access tcp --hostname psql.uiro.dev --url localhost:15432 &
psql "postgres://admin:<PW>@localhost:15432/postgres" -c 'select 1;'
```
