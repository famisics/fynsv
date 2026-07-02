# postgresql LXC 設計

汎用 PostgreSQL サーバーを LXC として新設し、Web 管理コンソール 2 種と外部接続経路を整備する。

## LXC 定義 (`terraform/containers.tf`)

```hcl
postgresql = {
  vm_id       = 214
  target_node = "pve01"
  memory      = 4096
  disk_size   = 32
  ip_address  = "192.168.2.212/24"
}
```

その他は `container_defaults` (Debian 13 / 2 vCPU / swap 512MB / firewall / nesting / provision) を継承。

## コンテナ内構成

構築・運用手順は `services/postgresql/README.md` が正。

### 1. PostgreSQL 17 (PGDG apt / ネイティブ)

- `listen_addresses = '*'`
- pg_hba: localhost + 192.168.2.0/24 を `scram-sha-256` で許可
- スーパーユーザーとは別に管理ロール `admin` を作成

### 2. pgAdmin 4 (web モード / apt)

- アクセス経路: Tailscale → arona サブネットルーター → 192.168.2.212
- LAN 内からも直接アクセス可

### 3. pgconsole (単一バイナリ + TOML)

- 接続定義ごとに read / write / DDL 権限を制御、監査ログあり
- MCP エンドポイントにより AI エージェントが接続文字列なしで操作可能
- アクセス経路は pgAdmin と同様

### 4. cloudflared — `psql.uiro.dev`

- Cloudflare Tunnel の任意 TCP で 5432/TCP を公開
- クライアントは `cloudflared access tcp --hostname psql.uiro.dev --url localhost:5432` でローカルポートを張って接続する (生 TCP 直結は不可)
- トンネル作成時に Cloudflare へのログイン操作が必要

### 5. 権限管理 SQL スクリプト (`services/postgresql/grants/`)

- DB ごとに `readonly_<db>` ロール (NOLOGIN) を定義: `CONNECT` + `USAGE` + `SELECT` (+ `ALTER DEFAULT PRIVILEGES`)
- ユーザー (LOGIN ロール) に `GRANT readonly_<db>` することで read できる DB を指定
- 冪等な SQL として保存し、再実行可能にする

### 6. drizzle 接続情報

README に接続文字列テンプレートを 3 経路分記載:

1. LAN 直: `postgres://<user>:<pass>@192.168.2.212:5432/<db>`
2. Tailscale 経由 (同 IP、arona サブネットルーター経由)
3. `psql.uiro.dev` 経由: `cloudflared access` で張ったローカルポートに接続

## 成功基準

- `terraform apply` で LXC が払い出される
- LAN から psql / drizzle で接続できる
- pgAdmin / pgconsole に Web アクセスできる
- `readonly_<db>` ロール経由でユーザーの read 対象 DB を制御できる
- `psql.uiro.dev` 経由で外部から接続できる
