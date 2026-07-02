# postgresql

汎用 PostgreSQL 17 サーバー。VMID / IP / リソース量は `terraform/containers.tf` の `postgresql` エントリが正。

## Tailscale から管理画面を開く

- DbGate: `http://192.168.2.212:3000`（`arona` が LAN (`192.168.2.0/24`) をサブネットルーターとして代理公開しているため、コンテナ側の追加設定なしで tailnet 端末から LAN IP に直接アクセスできる）

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

## DB を作る

`scripts/create-db.sh` に DB 名を渡すと、専用の LOGIN ロール (ランダムパスワード) と DB を作成し、`grants/readonly-role.sql` で対応する `readonly_<db>` ロールも合わせて用意したうえで、接続文字列を標準出力に返す。LAN/Tailscale 経由で `admin` ロールに接続するだけなので SSH は不要。

```bash
PGPASSWORD=<ADMIN_PG_PASSWORD> ./scripts/create-db.sh myapp
# => postgres://myapp:<生成されたパスワード>@192.168.2.212:5432/myapp
```

同名の DB が既に存在する場合はエラーで中断する（上書き事故防止）。

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

### DbGate

テーブル一覧の閲覧・検索・1 行単位の編集など phpMyAdmin 相当の操作を Web UI から行える。Docker コンテナとして常設している。

```bash
docker compose up -d
```

`docker-compose.yml` は `dbgate/dbgate` イメージをポート 3000 で起動し、`.env` の `DBGATE_LOGIN` / `DBGATE_PASSWORD` でログイン認証をかける。初回起動後、UI から `admin` ロールで PostgreSQL への接続を1つ登録する（host は同一コンテナ内なので `127.0.0.1` または `192.168.2.212`）。

- アクセス: `http://192.168.2.212:3000`
- ログイン情報は `.env` の `DBGATE_LOGIN` / `DBGATE_PASSWORD`

### テーブルをもっと快適に触りたい場合

drizzle を使っているプロジェクトなら、手元の PC から接続文字列付きで Drizzle Studio をローカル起動する方法もある。サーバー側には何もインストールしない（公式に VPS 等でのリモート常設運用は非対応と明記されているため、常設サービスの代替にはしていない）。

```bash
DATABASE_URL="postgres://..." npx drizzle-kit studio
```

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
