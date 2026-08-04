# postgresql LXC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 汎用 PostgreSQL 17 サーバーを LXC (vm_id 214 / pve01 / 192.168.2.212) として払い出し、pgAdmin 4 + pgconsole の管理コンソールと cloudflared (`psql.uiro.dev`) 経由の外部接続、ロールベースの read-only 権限管理を整備する。

**Architecture:** Terraform で LXC を払い出し、コンテナ内は ssh (claude-remote 基盤、`ssh root@192.168.2.212` 相当。まず pve01 経由 `pct exec` でも可) でネイティブ構築。手順の正は `services/postgresql/README.md`。

**Tech Stack:** Terraform (bpg/proxmox), Debian 13, PostgreSQL 17 (PGDG), pgAdmin 4 (web), pgconsole (単一バイナリ), cloudflared

## Global Constraints

- vm_id 214 / pve01 / 192.168.2.212/24 / memory 4096 / disk 32 (spec 準拠)
- 静的 IP のためこの値以外は `container_defaults` 継承 (gateway / nameservers は defaults が効く)
- スペックの転記禁止: リソース値は `terraform/containers.tf` のみが正。services README には書かない
- パスワード等のシークレットはリポジトリにコミットしない
- `terraform plan` の差分は人間が確認してから apply (force-replace が出たら停止して報告)

---

### Task 1: Terraform で LXC 払い出し

**Files:**
- Modify: `terraform/containers.tf` (locals.containers に追加)

**Interfaces:**
- Produces: 192.168.2.212 で ssh/pct 到達可能な Debian 13 コンテナ

- [ ] **Step 1: containers.tf にエントリ追加** — `kei` ブロックの後に:

```hcl
    postgresql = {
      vm_id       = 214
      target_node = "pve01"
      memory      = 4096
      disk_size   = 32
      ip_address  = "192.168.2.212/24"
    }
```

- [ ] **Step 2: plan で差分確認**

Run: `cd terraform && terraform plan`
Expected: `module.lxc["postgresql"]` の 1 add のみ。既存リソースに変更・置換が出たら停止して人間に報告。

- [ ] **Step 3: apply**

Run: `cd terraform && terraform apply -auto-approve` (plan が add 1 件のみ確認済みの場合)
Expected: Apply complete, 1 added

- [ ] **Step 4: 到達確認**

Run: `ping -c 2 192.168.2.212`
Expected: 応答あり (provision.sh 完了まで数十秒待つ)

- [ ] **Step 5: Commit**

```bash
git add terraform/containers.tf
git commit -m "feat: postgresql LXC を追加"
```

### Task 2: PostgreSQL 17 インストールと外部接続設定

**Files:** (コンテナ内 `/etc/postgresql/17/main/`)

**Interfaces:**
- Produces: 192.168.2.212:5432 で LAN から scram-sha-256 接続可能な PostgreSQL 17。管理ロール `admin` (SUPERUSER, LOGIN)

コンテナへは pve01 経由: `ssh root@pve01 "pct exec 214 -- bash -c '<cmd>'"` または直接 ssh。

- [ ] **Step 1: PGDG リポジトリ追加とインストール**

```bash
apt-get install -y postgresql-common
/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
apt-get install -y postgresql-17
```

- [ ] **Step 2: listen_addresses と pg_hba 設定**

```bash
sed -i "s/^#listen_addresses.*/listen_addresses = '*'/" /etc/postgresql/17/main/postgresql.conf
cat >> /etc/postgresql/17/main/pg_hba.conf <<'EOF'
# LAN からの接続 (drizzle / 管理コンソール)
host    all    all    192.168.2.0/24    scram-sha-256
EOF
systemctl restart postgresql
```

- [ ] **Step 3: admin ロール作成** — パスワードは生成してユーザーに提示 (コミットしない)

```bash
PW=$(openssl rand -base64 24)
sudo -u postgres psql -c "CREATE ROLE admin LOGIN SUPERUSER PASSWORD '$PW';"
echo "admin password: $PW"
```

- [ ] **Step 4: LAN から接続検証**

Run (作業マシンから): `psql "postgres://admin:<PW>@192.168.2.212:5432/postgres" -c 'select version();'`
Expected: PostgreSQL 17.x

### Task 3: 権限管理 SQL スクリプトと services README

**Files:**
- Create: `services/postgresql/README.md`
- Create: `services/postgresql/grants/readonly-role.sql`
- Create: `services/postgresql/grants/example.sql`

**Interfaces:**
- Produces: `readonly_<db>` ロール規約。ユーザーへの GRANT で read 対象 DB を制御

- [ ] **Step 1: readonly-role.sql 作成** — DB 名を `:db` psql 変数で受ける冪等スクリプト:

```sql
-- 使い方: psql -U admin -v db=<dbname> -f readonly-role.sql
-- DB <db> への read-only ロール readonly_<db> を作成 (冪等)
SELECT format('CREATE ROLE readonly_%I NOLOGIN', :'db')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'readonly_' || :'db') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO readonly_%I', :'db', :'db') \gexec
\c :db
SELECT format('GRANT USAGE ON SCHEMA public TO readonly_%I', :'db') \gexec
SELECT format('GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_%I', :'db') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO readonly_%I', :'db') \gexec
```

- [ ] **Step 2: example.sql 作成** — ユーザー作成と付与の例:

```sql
-- ユーザー alice を作成し、appdb を read 可能にする例
-- CREATE ROLE alice LOGIN PASSWORD '...';
-- GRANT readonly_appdb TO alice;
```

- [ ] **Step 3: 動作検証** — テスト DB で確認:

```bash
psql -U admin -h 192.168.2.212 postgres -c 'CREATE DATABASE testdb;'
psql -U admin -h 192.168.2.212 -v db=testdb -f services/postgresql/grants/readonly-role.sql postgres
psql -U admin -h 192.168.2.212 postgres -c "CREATE ROLE tester LOGIN PASSWORD 'test'; GRANT readonly_testdb TO tester;"
psql "postgres://tester:test@192.168.2.212:5432/testdb" -c 'CREATE TABLE should_fail(i int);'
```
Expected: 最後の CREATE TABLE が permission denied で失敗 (SELECT は可)。検証後 `DROP DATABASE testdb; DROP ROLE tester; DROP ROLE readonly_testdb;`

- [ ] **Step 4: README 作成** — 構築手順 (Task 2/4/5/6 の内容)、権限管理の運用 (grants の使い方)、drizzle 接続文字列 3 経路 (LAN / Tailscale / psql.uiro.dev + `cloudflared access tcp`) を記載。リソース値は書かない。

- [ ] **Step 5: Commit**

```bash
git add services/postgresql
git commit -m "docs: postgresql サービスの構築手順と権限管理スクリプトを追加"
```

### Task 4: pgAdmin 4 (web モード)

**Interfaces:**
- Produces: `http://192.168.2.212/pgadmin4` (Tailscale/LAN からアクセス)

- [ ] **Step 1: インストール** (コンテナ内)

```bash
curl -fsS https://www.pgadmin.org/static/packages_pgadmin_org.pub | gpg --dearmor -o /usr/share/keyrings/packages-pgadmin-org.gpg
echo "deb [signed-by=/usr/share/keyrings/packages-pgadmin-org.gpg] https://ftp.postgresql.org/pub/pgadmin/pgadmin4/apt/$(lsb_release -cs) pgadmin4 main" > /etc/apt/sources.list.d/pgadmin4.list
apt-get update && apt-get install -y pgadmin4-web
/usr/pgadmin4/bin/setup-web.sh --yes
```

注: Debian 13 (trixie) 向けパッケージが無い場合は `bookworm` を指定するか、`pip install pgadmin4` にフォールバック。初期ログインメールアドレスはユーザーに確認 (yamazaki.takumi@craftx.net を既定候補)。

- [ ] **Step 2: 検証**

Run: `curl -sI http://192.168.2.212/pgadmin4/login | head -1`
Expected: HTTP 200 または 302

### Task 5: pgconsole

**Interfaces:**
- Produces: `http://192.168.2.212:8080` の pgconsole (read/write 権限を接続定義で制御、MCP エンドポイント付き)

- [ ] **Step 1: バイナリ取得** — https://docs.pgconsole.com の手順に従い GitHub releases (pgplex/pgconsole) から linux/amd64 バイナリを `/usr/local/bin/pgconsole` に配置

- [ ] **Step 2: TOML 設定** — `/etc/pgconsole/config.toml` にサーバーポート、PostgreSQL 接続 (localhost)、アクセスルール (read-only 接続と admin 接続の 2 定義) を docs に従い記述。認証情報はコンテナ内のみ。

- [ ] **Step 3: systemd unit 作成・起動**

```ini
[Unit]
Description=pgconsole
After=network.target postgresql.service
[Service]
ExecStart=/usr/local/bin/pgconsole --config /etc/pgconsole/config.toml
Restart=on-failure
DynamicUser=yes
[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable --now pgconsole
```

- [ ] **Step 4: 検証**

Run: `curl -sI http://192.168.2.212:8080 | head -1`
Expected: HTTP 200 (ブラウザからログイン確認もユーザーに依頼)

- [ ] **Step 5: README に pgconsole 節を追記して Commit**

```bash
git add services/postgresql/README.md
git commit -m "docs: pgconsole の構築手順を追記"
```

### Task 6: cloudflared — psql.uiro.dev

**Interfaces:**
- Produces: `psql.uiro.dev` → 192.168.2.212:5432 (`arona` の既存 cloudflared 経由。クライアントは `cloudflared access tcp` で接続)

`arona` の cloudflared は token 方式 (remote-managed tunnel) で稼働しており、コンテナ側に cloudflared を入れる必要はない ([misskey/README.md](../../../services/misskey/README.md) §5、[obsidian-livesync/README.md](../../../services/obsidian-livesync/README.md) §3 と同じ方式)。ingress は Cloudflare Zero Trust ダッシュボードで管理する。

- [ ] **Step 1: Public Hostname を追加** — 実行場所: Cloudflare Zero Trust ダッシュボード
  - **Zero Trust > Networks > Tunnels** → arona のトンネル → **Configure** > **Public Hostnames** > **Add a public hostname**
  - Subdomain: `psql` / Domain: 該当ドメイン / Service > Type: `TCP` / Service > URL: `192.168.2.212:5432`
  - Save すると `psql.uiro.dev` の CNAME が自動生成される

- [ ] **Step 2: 検証** (作業マシンから)

```bash
cloudflared access tcp --hostname psql.uiro.dev --url localhost:15432 &
psql "postgres://admin:<PW>@localhost:15432/postgres" -c 'select 1;'
```
Expected: `1`

- [ ] **Step 3: README に cloudflared 節を追記して Commit**

```bash
git add services/postgresql/README.md
git commit -m "docs: cloudflared (psql.uiro.dev) の構築手順を追記"
```

### Task 7: 最終検証

- [ ] LAN: `psql postgres://...@192.168.2.212:5432` で接続できる
- [ ] pgAdmin / pgconsole に Web アクセスできる (ユーザー確認)
- [ ] readonly ロールで write が拒否される (Task 3 で検証済みなら省略可)
- [ ] `psql.uiro.dev` 経由で接続できる
- [ ] README の接続情報 (drizzle 3 経路) が実態と一致している
- [ ] admin / 各種パスワードをユーザーに引き渡し (チャット上で提示、リポジトリ非コミット)
