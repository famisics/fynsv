# Coolify — コントロールプレーンとアプリ実行サーバーを分ける構成

Coolify は「コントロールプレーン（Coolify 本体が動くサーバー）」と「アプリ実行サーバー（デプロイ対象のワークロードが動くサーバー）」を分離して運用できる。コントロールプレーンは SSH 経由でリモートサーバーを操作し、Docker コンテナのデプロイ・管理を行う。

参考: <https://coolify.io/docs/get-started/installation#manual-installation>

## 構成概要

```
   管理者                              インターネット
     │                                   │
     │ Tailscale                         │ https://XXX.on.example.com
     ▼                                   ▼
┌─────────────────────────┐       ┌──────────────────┐
│  コントロールプレーン        │       │ Cloudflare Edge   │
│  (Coolify 本体)           │       └────────┬─────────┘
│  - Web UI / API           │                │ Cloudflare Tunnel
│  - PostgreSQL / Redis     │   SSH (22)     ▼
│  - Traefik (proxy)        │ ──────────▶ ┌─────────────────────────┐
│  - tailscaled             │ ──────────▶ │  アプリ実行サーバー          │
└─────────────────────────┘             │  (Docker)                 │
                                         │  - アプリコンテナ            │
                                         │  - cloudflared (tunnel)    │
                                         └─────────────────────────┘
```

- **コントロールプレーン**: Coolify のスタック一式（UI、DB、Redis、Realtime、proxy）を動かす。原則アプリは載せない。Web UI は **Tailscale 経由のみ**でアクセスし、ポートはインターネットに公開しない。
- **アプリ実行サーバー**: Docker Engine だけがあればよい。Coolify が SSH で接続し、コンテナを起動する。公開アプリは **Cloudflare Tunnel** で `XXX.on.example.com` を割り当て、80/443 をインターネットに直接開けない。

## 前提・要件

### 共通

- OS: Debian 系（Ubuntu 等）/ RHEL 系 / SUSE / Arch / Alpine / Raspberry Pi OS 64bit
- アーキテクチャ: AMD64 または ARM64
- Docker Engine 24 以降（snap 版は非対応）
- SSH 有効、`curl` インストール済み

### コントロールプレーン最小スペック

- CPU: 2 コア
- RAM: 2 GB
- ストレージ: 30 GB 以上の空き

### アプリ実行サーバー

- Docker Engine 24 以降がインストール済みであること
- 載せるワークロードに応じた CPU / RAM / ストレージ（Coolify 本体の要件は不要）

## ポート要件

| ポート | 用途 | 開放範囲 |
| --- | --- | --- |
| 8000 | Coolify Web UI | **Tailscale ネットワーク内のみ**。インターネットには公開しない |
| 6001 | Realtime（WebSocket） | Tailscale ネットワーク内のみ |
| 6002 | ターミナル（WebSocket） | Tailscale ネットワーク内のみ |
| 22 | SSH（コントロールプレーン → 各サーバーを操作） | アプリ実行サーバー側で、コントロールプレーンからの接続のみ許可（Tailscale 経由が望ましい） |
| 80 / 443 | アプリ公開 | **インターネットには開けない**。Cloudflare Tunnel が外向き接続でトラフィックを引き込む |

> - 管理系ポート（8000/6001/6002）はファイアウォールでインターネットから遮断し、Tailscale インターフェイス（`tailscale0`）からのみ到達できるようにする。
> - 公開アプリは Cloudflare Tunnel（`cloudflared`）が Cloudflare へ outbound 接続するため、インバウンドポートの開放は不要。
> - コントロールプレーン ↔ アプリ実行サーバー間の SSH も両者を Tailscale に参加させ、Tailscale IP で接続すると 22 番をインターネットに晒さずに済む。

## 1. コントロールプレーンの構築（手動インストール）

アプリを載せないなら、ワンライナー（`curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash`）でも構築できる。ここでは手動インストール手順を示す。すべて root 相当の権限で実行する。

### 1-1. ディレクトリ作成

```bash
mkdir -p /data/coolify/{source,ssh,applications,databases,backups,services,proxy,webhooks-during-maintenance}
mkdir -p /data/coolify/ssh/{keys,mux}
mkdir -p /data/coolify/proxy/dynamic
```

### 1-2. SSH 鍵の生成（自分自身を操作するための鍵）

```bash
ssh-keygen -f /data/coolify/ssh/keys/id.root@host.docker.internal -t ed25519 -N '' -C root@coolify
cat /data/coolify/ssh/keys/id.root@host.docker.internal.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

### 1-3. 構成ファイルの取得

```bash
curl -fsSL https://cdn.coollabs.io/coolify/docker-compose.yml      -o /data/coolify/source/docker-compose.yml
curl -fsSL https://cdn.coollabs.io/coolify/docker-compose.prod.yml -o /data/coolify/source/docker-compose.prod.yml
curl -fsSL https://cdn.coollabs.io/coolify/.env.production         -o /data/coolify/source/.env
curl -fsSL https://cdn.coollabs.io/coolify/upgrade.sh             -o /data/coolify/source/upgrade.sh
```

### 1-4. 権限設定

```bash
chown -R 9999:root /data/coolify
chmod -R 700 /data/coolify
```

### 1-5. シークレット値の生成

`.env` のシークレットを生成・置換する。**初回インストール時のみ実行する**（後から変更すると壊れる）。

```bash
sed -i "s|APP_ID=.*|APP_ID=$(openssl rand -hex 16)|g"                       /data/coolify/source/.env
sed -i "s|APP_KEY=.*|APP_KEY=base64:$(openssl rand -base64 32)|g"           /data/coolify/source/.env
sed -i "s|DB_PASSWORD=.*|DB_PASSWORD=$(openssl rand -base64 32)|g"          /data/coolify/source/.env
sed -i "s|REDIS_PASSWORD=.*|REDIS_PASSWORD=$(openssl rand -base64 32)|g"    /data/coolify/source/.env
sed -i "s|PUSHER_APP_ID=.*|PUSHER_APP_ID=$(openssl rand -hex 32)|g"         /data/coolify/source/.env
sed -i "s|PUSHER_APP_KEY=.*|PUSHER_APP_KEY=$(openssl rand -hex 32)|g"       /data/coolify/source/.env
sed -i "s|PUSHER_APP_SECRET=.*|PUSHER_APP_SECRET=$(openssl rand -hex 32)|g" /data/coolify/source/.env
```

### 1-6. Docker ネットワーク作成

```bash
docker network create --attachable coolify
```

### 1-7. 起動

```bash
docker compose \
  --env-file /data/coolify/source/.env \
  -f /data/coolify/source/docker-compose.yml \
  -f /data/coolify/source/docker-compose.prod.yml \
  up -d --pull always --remove-orphans --force-recreate
```

### 1-8. 初期セットアップ

`http://<コントロールプレーンの IP>:8000` にアクセスし、管理者アカウントを作成する。Tailscale をまだ入れていない場合はこの段階のみ一時的に IP 直アクセスしてよいが、後述の Tailscale 設定後は Tailscale IP / MagicDNS 名でアクセスし、8000 番のインターネット公開は閉じる。

## 2. アプリ実行サーバーの追加（リモートサーバー）

コントロールプレーン上の Coolify から SSH 経由でリモートサーバーを登録し、そこにアプリをデプロイする。

### 2-1. アプリ実行サーバー側の準備

Docker Engine 24 以降をインストールしておく。SSH 設定 `/etc/ssh/sshd_config` で以下を確認する。

```
PubkeyAuthentication yes
PermitRootLogin prohibit-password
```

変更したら SSH を再起動する（ディストリビューションに応じて `systemctl restart sshd` 等）。

> SSH 鍵はパスフレーズなし・対象ユーザーは 2FA 無効であること。Coolify はパスフレーズ付き鍵・2FA を扱えない。

### 2-2. SSH 鍵の用意

コントロールプレーンの Coolify ダッシュボードで使う鍵ペアを用意する。Coolify の UI（Keys & Tokens）で新規生成するか、既存の Ed25519 鍵を使う。

```bash
ssh-keygen -t ed25519 -a 100 -N '' -f ./coolify-remote
```

生成した**公開鍵**をアプリ実行サーバーの接続ユーザー（例: `root`）に登録する。

```bash
# アプリ実行サーバー側で実行
mkdir -p ~/.ssh
cat /path/to/coolify-remote.pub >> ~/.ssh/authorized_keys
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```

### 2-3. Coolify への登録

1. Coolify ダッシュボード → **Keys & Tokens → Private Keys** で、上記鍵ペアの**秘密鍵**を登録する。
2. **Servers → + Add** で新規サーバーを追加する。
   - IP アドレス / ポート（既定 22）
   - 接続ユーザー（`root` 推奨）
   - 使用する Private Key
3. **Validate Server** で疎通を確認する。Coolify が SSH 接続し、必要なら Docker のセットアップを行う。

### 2-4. デプロイ先として指定

アプリケーション / サービスを作成する際、Destination（または Server）に追加したアプリ実行サーバーを選ぶ。これでコントロールプレーンとは別のサーバー上にコンテナがデプロイされる。

## 3. 管理画面を Tailscale で保護

Coolify の Web UI（8000）と関連ポートをインターネットに晒さず、Tailscale 経由のみでアクセスする。

### 3-1. Tailscale インストール（コントロールプレーン）

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

表示される URL を開いて認証し、ノードを tailnet に参加させる。MagicDNS を有効にしておくと `coolify.<tailnet>.ts.net` のような名前でアクセスできる。

### 3-2. 管理系ポートをインターネットから遮断

8000 / 6001 / 6002 を tailnet 内からのみ到達させる。ufw の例:

```bash
sudo ufw default deny incoming
sudo ufw allow in on tailscale0          # Tailscale 経由は許可
sudo ufw allow 22/tcp                    # SSH（Tailscale に寄せるなら on tailscale0 のみに絞る）
sudo ufw enable
```

`tailscale0` インターフェイスからの着信のみ許可することで、8000 等を個別に開けなくても tailnet 内からはアクセスでき、インターネットからは遮断される。

### 3-3. アクセス

管理者は Tailscale クライアントを入れた端末から `http://coolify.<tailnet>.ts.net:8000`（または Tailscale IP）でアクセスする。Coolify の `APP_URL` も Tailscale 上の名前に合わせておくと WebSocket（Realtime / Terminal）が正しく動く。

## 4. 公開アプリを Cloudflare Tunnel で割り当て

公開アプリには `XXX.on.example.com` を Cloudflare Tunnel 経由で割り当てる。アプリ実行サーバーで `cloudflared` を動かし、Cloudflare へ outbound 接続することで 80/443 をインターネットに開けずに公開する。

### 4-1. 前提

- `example.com`（および `on.example.com`）が Cloudflare で管理されていること。
- `on.example.com` をワイルドカードで使うなら、`*.on.example.com` を Tunnel に向ける（後述）。

### 4-2. Cloudflare Tunnel の作成

Cloudflare Zero Trust ダッシュボード（Networks → Tunnels）でトンネルを作成し、アプリ実行サーバーで `cloudflared` を起動する。トークン方式が手軽:

```bash
# アプリ実行サーバー側
docker run -d --name cloudflared --restart unless-stopped \
  --network coolify \
  cloudflare/cloudflared:latest tunnel --no-autoupdate run --token <TUNNEL_TOKEN>
```

> `--network coolify` で Coolify のネットワークに参加させると、コンテナ名でアプリへ到達できる。

### 4-3. Public Hostname の割り当て

トンネルの **Public Hostname** に、公開したいアプリごとにサブドメインとオリジンを設定する。

| Subdomain | Domain | Service（オリジン） |
| --- | --- | --- |
| `XXX` | `on.example.com` | `http://<アプリのコンテナ名 or サーバー内ポート>` |

- アプリを Coolify の proxy（Traefik）配下に置く場合は Service を Traefik 宛（例 `http://coolify-proxy:80`）にし、Host ヘッダーで振り分ける。
- アプリを個別ポートで公開している場合は `http://localhost:<port>` を指定する。

Public Hostname を追加すると、Cloudflare が `XXX.on.example.com` の DNS（CNAME → トンネル）を自動作成する。

### 4-4. Coolify 側のドメイン設定

Coolify のアプリ設定で **Domains** に `https://XXX.on.example.com` を登録する。これで Traefik が該当ホストのリクエストを当該アプリへルーティングする。TLS は Cloudflare Edge が終端するため、オリジン側は HTTP のままでよい（Cloudflare の SSL/TLS モードは Flexible か、オリジン証明書を入れて Full）。

## 運用メモ

- コントロールプレーンには原則アプリを載せない。負荷やセキュリティをアプリ実行サーバーへ分離するのが本構成の目的。
- 管理系ポート（8000/6001/6002）はインターネットに公開せず、Tailscale 経由のみ。
- 公開アプリは Cloudflare Tunnel（outbound）で割り当てるため、アプリ実行サーバーの 80/443 をインターネットに開けない。
- アプリ実行サーバーの 22 番はコントロールプレーン（できれば Tailscale IP）からのみ許可する。
- バックアップ対象は `/data/coolify`（コントロールプレーン）と、各アプリ実行サーバー上の永続ボリューム。
