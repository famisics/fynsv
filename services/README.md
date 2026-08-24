# FYNSV 上のサービス

この `services/` は、Proxmox VE 3 ノードクラスタ **FYNSV** 上で動かすサービス群の構築・運用文書をまとめる。

> **ゲスト (VM / LXC) のリソース定義 (vCPU / RAM / ディスク / NIC / 静的 IP) の正は [`../terraform/`](../terraform/) を参照。**
> 各サービスの内部構築・運用は各サブディレクトリの README を正とする。
> 本書は services 全体の索引と、全サービスが共有するクラスタ基盤 (ノード / Ceph / ストレージ、Terraform 管理外) を記録する。

## サービス一覧

VMID とゲストの対応は次節「ゲスト (VM / LXC) 一覧」を参照。

| サービス | ディレクトリ | 役割 |
| --- | --- | --- |
| Misskey | [`misskey/`](./misskey/README.md) | Misskey 本体 / PostgreSQL / Redis の 3 LXC 構成 |
| misskey-mixi2-link | [`arona/misskey-mixi2-link/`](./arona/misskey-mixi2-link/README.md) | Misskey ⇔ mixi2 投稿ブリッジ。arona 上で Docker 常駐 |
| Obsidian LiveSync | [`obsidian-livesync/`](./obsidian-livesync/README.md) | CouchDB (Obsidian Self-hosted LiveSync バックエンド) |
| mysql | [`mysql/`](./mysql/README.md) | MariaDB + phpMyAdmin (共有 DB 基盤) |
| Coolify | [`coolify/`](./coolify/README.md) | コントロールプレーン / アプリ実行サーバー |
| dawarich | [`dawarich/`](./dawarich/README.md) | 位置情報トラッキング (PostGIS + Redis + Sidekiq, Docker Compose) |
| Status Page | [`status-page/`](./status-page/README.md) | サービス稼働状況・リソース使用量の収集と公開 |
| discord-bot | [`arona/discord-bot/`](./arona/discord-bot/) | Discord bot (fun-council: リマインダー / ロール自動付与、uiroid: Misskey のハッシュタグ投稿を Discord に転送)。arona 上で Docker 常駐 |
| swarm-gcal-sync | [`arona/swarm-gcal-sync/`](./arona/swarm-gcal-sync/README.md) | Swarm チェックイン → Google カレンダー同期。arona 上で Docker 常駐 |

## ゲスト (VM / LXC) 一覧

本表は役割・配置の索引。

- リソース割り当て (vCPU / RAM / ディスク / NIC / 静的 IP / features / タグ) は **Terraform が正** ([`../terraform/`](../terraform/))
- LXC は `module.lxc["<名前>"]` (`containers.tf`)、VM は `vms.tf` で管理
- IP は `terraform output` で取得する

| VMID | 種別 | 名前                 | ノード | 用途                                            |
| ---- | ---- | -------------------- | ------ | ----------------------------------------------- |
| 100  | qemu | `arona`              | pve02  | 公開口 (Tailscale + cloudflared)、Docker ホスト |
| 101  | qemu | `prana`              | pve01  | 予備 (stopped)                                  |
| 200  | lxc  | `supabase`           | pve03  | Supabase スタック (Docker)                      |
| 201  | lxc  | `archivebox`         | pve02  | ArchiveBox (community-script 由来)              |
| 210  | lxc  | `misskey-web`        | pve03  | Misskey 本体 (Node.js)                          |
| 211  | lxc  | `misskey-db`         | pve02  | PostgreSQL                                      |
| 212  | lxc  | `misskey-redis`      | pve02  | Redis                                           |
| 213  | lxc  | `obsidian-livesync`  | pve01  | CouchDB (Docker)、Obsidian LiveSync バックエンド |
| 214  | lxc  | `mysql`              | pve01  | MariaDB + phpMyAdmin (共有 DB 基盤)             |
| 220  | lxc  | `coolify-cp`         | pve02  | Coolify コントロールプレーン                    |
| 221  | lxc  | `coolify-app`        | pve02  | Coolify アプリ実行サーバー                      |
| 222  | lxc  | `dokploy`            | pve01  | Dokploy (PaaS、詳細未整理、stopped)             |
| 223  | lxc  | `kei`                | pve03  | 開発用途                                        |
| 224  | lxc  | `dawarich`           | pve03  | dawarich (位置情報トラッキング、Docker Compose) |

各ゲスト内部の構築・運用は対応するサービス文書を正とする。

- [misskey](./misskey/README.md) (210/211/212)
- [obsidian-livesync](./obsidian-livesync/README.md) (213)
- [mysql](./mysql/README.md) (214)
- [coolify](./coolify/README.md) (220/221)
- [dawarich](./dawarich/README.md) (224)
- misskey-mixi2-link / swarm-gcal-sync / discord-bot / Status Page (health-checker) は arona (VM 100) 上で Docker 常駐し、個別 VMID を持たない。misskey-mixi2-link / swarm-gcal-sync / discord-bot は [arona/README.md](./arona/README.md)、Status Page は [status-page/README.md](./status-page/README.md) を正とする

### 公開口 arona (VM 100)

- Tailscale と cloudflared を載せた公開口
- 各サービスの外部公開は arona の cloudflared (token 方式) に Public Hostname を足して行う
- 同一 LAN 上のコンテナは arona が Tailscale Service / サブネットルーターとして代理公開する

## 新規ゲストの共通セットアップ Tips

払い出し直後の Debian LXC/VM に対して、サービスを問わず繰り返し行う手動セットアップ手順。`terraform/modules/lxc/provision.sh` による自動投入 (git/curl 等・ロケール・タイムゾーン) の対象外。

### コンテナを Tailscale に載せる

- 既定方針: コンテナ内で tailscale を動かさず、`arona` (192.168.2.100) が Tailscale Service (`svc:...`) / サブネットルーターとして同一 LAN 上のコンテナを代理公開する
- tailnet 側の顔は arona で、コンテナへは LAN 経由で届く
- コンテナに tailscaled を入れないので TUN も要らず、非特権 LXC のまま済む (例: archivebox は CT 内に tailscale を持たず arona が `svc:archivebox` を広告)
- 新しいサービスを tailnet に出すときはこの方式を選ぶ

#### 特定のローカル IP を service に紐付ける

tailnet ポリシーで `svc:<name>` を定義したら、arona から `tailscale serve` でローカル IP:ポートを HTTPS:443 にプロキシし、同時にサービスホストとして広告する。これがそのまま admin への接続申請になる。

```sh
# arona 上 (sudo が要る)
sudo tailscale serve --service=svc:dokploy --bg --https=443 http://192.168.2.210:3000
```

- `--service=svc:<name>`: ポリシーで定義済みのサービス名
- `http://<lan-ip>:<port>`: 紐付けるコンテナの LAN IP と待受ポート (例: dokploy は 222 番 CT = `192.168.2.210:3000`)
- `--bg`: バックグラウンド常駐 (再起動後も維持)。`--https=443` で TLS 終端
- `tailscale serve` での初期化なら advertise も自動で行われるため、別途 `tailscale serve advertise` は不要

実行すると `approval from an admin is required` と出て、tailnet の `AdvertiseServices` に追加される。**Tailscale 管理コンソールで arona を当該サービスのホストとして承認**すると `https://<name>.<tailnet>.ts.net/` で到達できる。

確認・取り消し:

```sh
sudo tailscale serve status --json          # 現在の service → proxy 対応を確認
tailscale debug prefs | grep -A5 AdvertiseServices   # 広告中のサービス一覧
sudo tailscale serve --service=svc:dokploy --https=443 off   # プロキシを無効化
tailscale serve clear svc:dokploy           # 申請ごと設定を削除
```

待受ポートが不明なときは arona から `curl -s -o /dev/null -w "%{http_code}\n" http://<lan-ip>:<port>/` で探る (UI が返れば `200`/`307` 等)。

#### コンテナ内で直接 Tailscale を動かす (TUN 設定)

arona 代理ではなくコンテナ自身で tailscaled を動かす場合、非特権 LXC には TUN デバイスが無いため手動で追加する。Proxmox ホスト側でコンテナの設定ファイルに 2 行追加し、コンテナを再起動する:

```sh
# Proxmox ホスト (pve0X) で実行
cat >> /etc/pve/lxc/<vmid>.conf <<'EOF'
lxc.cgroup2.devices.allow: c 10:200 rwm
lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file
EOF

pct reboot <vmid>
```

再起動後、コンテナ内で `/dev/net/tun` が見えることを確認してから Tailscale をインストールする:

```sh
# コンテナ内
ls -l /dev/net/tun              # crw-rw-rw- ... 10, 200 が出ればOK
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up                    # 認証 URL が表示される
```

### ユーザー famisics の追加と sudo 有効化

最小構成の Debian には `sudo` が入っておらず、運用は root のみになっている。一般ユーザー `famisics` を作り、sudo グループ経由で `sudo` を使えるようにする。`pct enter` で root シェルに入ってから実行する:

```sh
apt -y install sudo
adduser famisics                 # 対話でパスワード等を設定
usermod -aG sudo famisics        # sudo グループに追加
```

`su - famisics` で切り替えて `sudo -v` が通れば有効。パスワード入力を省きたい場合は sudoers ドロップインを置く (`/etc/sudoers.d/` 配下・`0440` 権限):

```sh
echo 'famisics ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/famisics
chmod 0440 /etc/sudoers.d/famisics
visudo -cf /etc/sudoers.d/famisics   # 構文チェック (壊すと sudo 全体が使えなくなる)
```

### 起動時にサーバーを自動起動する (systemd)

`bun run start` のサーバーをコンテナの起動と同時に立ち上げ、落ちても復帰させる。Debian は systemd なので service unit を作る。systemd は shell の PATH を引き継がないため、`bun` は**絶対パス**で書く (`which bun` で確認。root 運用なら通常 `/root/.bun/bin/bun`)。

`myapp` (サービス名)・`/root/myapp` (プロジェクトの clone 先)・`bun` のパスは実環境に合わせて差し替える:

```sh
cat > /etc/systemd/system/myapp.service <<'EOF'
[Unit]
Description=myapp (bun run start)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/root/myapp
ExecStart=/root/.bun/bin/bun run start
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
```

`enable --now` で「次回起動時に自動起動」+「今すぐ起動」を一度に行う:

```sh
systemctl daemon-reload
systemctl enable --now myapp.service
```

状態とログを確認する:

```sh
systemctl status myapp.service
journalctl -u myapp.service -f
```

### Docker をインストールする

```sh
# Remove previous versions of docker:
sudo apt remove $(dpkg --get-selections docker.io docker-compose docker-doc podman-docker containerd runc | cut -f1)

# Add Docker's official GPG key:
sudo apt update
sudo apt install ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# Add the repository to Apt sources:
sudo tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: $(. /etc/os-release && echo "$VERSION_CODENAME")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

# Update and install:
sudo apt update
sudo apt install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin -y

# Velify:
docker run hello-world
```

sudo なしで `docker` を使えるようにするには、対象ユーザーを `docker` グループに追加する:

```sh
sudo usermod -aG docker "$USER"
```

グループの変更は再ログイン (または `newgrp docker`) で反映される。反映後は `sudo` なしで動作確認できる:

```sh
docker run hello-world
```

## クラスタ基盤

全サービスが乗る Proxmox クラスタ **FYNSV** の物理基盤。Terraform 管理外 (`data` source で参照のみ)。

### クラスタ概要

| 項目                   | 値                                   |
| ---------------------- | ------------------------------------ |
| クラスタ名             | `FYNSV`                              |
| Cluster Config Version | 5                                    |
| Transport              | knet (secauth on, link_mode passive) |
| Proxmox VE             | pve-manager/9.1.16                   |
| Kernel                 | 6.17.9-1-pve                         |
| ホスト OS              | Debian GNU/Linux 13 (trixie) 13.5    |
| ノード数               | 3                                    |
| Quorum                 | 3/3 (Quorate, expected 3)            |

### ノード

| ノード | Node ID | CPU コア | RAM (maxmem) | OS ディスク (maxdisk) | vmbr0 (LAN)     | Tailscale                                | corosync `ring0_addr` |
| ------ | ------- | -------- | ------------ | --------------------- | --------------- | ---------------------------------------- | --------------------- |
| pve01  | 1       | 4        | 16.5 GB      | 41.5 GB               | 192.168.2.11/24 | (収集時取得せず)                         | 192.168.2.11          |
| pve02  | 2       | 12       | 13.3 GB      | 41.5 GB               | 192.168.2.12/24 | 100.121.15.92, fd7a:115c:a1e0::c93a:f5c  | 192.168.2.12          |
| pve03  | 3       | 12       | 13.3 GB      | 41.5 GB               | 192.168.2.13/24 | 100.94.19.105, fd7a:115c:a1e0::653a:1369 | 192.168.2.13          |

各ノードの `/etc/network/interfaces` は次の構成。

- `lo`, `nic0` (manual + WoL `ethtool -s nic0 wol g`)
- `vmbr0` (static, bridge-ports `nic0`, gateway 192.168.2.1, `bridge-stp off`, `bridge-fd 0`, `ethtool -K vmbr0 rx-udp-gro-forwarding on`)
- `nic1` (manual, 未使用)
- pve02 / pve03 のみ `nic2` (manual, 未使用) と `wlp4s0` (DOWN) が存在

- `pvecm status` のメンバーシップは 192.168.2.11 / .12 / .13
- `/etc/pve/corosync.conf` と各ノード `/etc/corosync/corosync.conf` の `ring0_addr` も 192.168.2.x で一致
- `corosync-cfgtool -s` でも LINK 0 udp が 192.168.2.x にバインドされている

### Ceph

Terraform 管理外。`vm-pool` は全 VM/LXC の生命線のため TF では触らない。

| 項目                | 値                                                          |
| ------------------- | ----------------------------------------------------------- |
| Cluster ID          | `3315f95e-a759-447b-ba41-3a68442db924`                      |
| Health              | HEALTH_OK                                                   |
| Monitors            | 3 (pve01 / pve02 / pve03)                                   |
| Manager             | pve01 (active)                                              |
| MDS                 | 1/1 up                                                      |
| OSD                 | 3 up / 3 in (各ノード 1 個)                                 |
| OSD クラス / サイズ | ssd / 各 0.93149 TiB (合計 2.79 TiB)                        |
| Mon Map             | v2:192.168.2.{11,12,13}:3300 / v1:192.168.2.{11,12,13}:6789 |
| Pool 数             | 4                                                           |
| PG 数               | 97 (active+clean)                                           |
| Raw 使用率          | 171 GiB / 2.8 TiB (5.98%)                                   |

Pool 一覧 (`ceph df`)。

| Pool              | ID  | PGs | Stored  | Objects | Used    | %Used | Max Avail |
| ----------------- | --- | --- | ------- | ------- | ------- | ----- | --------- |
| `.mgr`            | 1   | 1   | 5.9 MiB | 3       | 18 MiB  | 0%    | 849 GiB   |
| `vm-pool`         | 3   | 32  | 56 GiB  | 15.04k  | 168 GiB | 6.18% | 849 GiB   |
| `cephfs_metadata` | 4   | 32  | 3.9 MiB | 23      | 12 MiB  | 0%    | 849 GiB   |
| `cephfs_data`     | 5   | 32  | 0 B     | 0       | 0 B     | 0%    | 849 GiB   |

CephFS は `cephfs` という名前で存在 (metadata pool: `cephfs_metadata`, data pools: `cephfs_data`)。`/etc/pve/storage.cfg` には登録されていない。

### ストレージ (`/etc/pve/storage.cfg`, `pvesm status`)

Terraform 管理外 (`data "proxmox_datastores"` で参照のみ)。

| Storage     | Type                                | Scope      | Content                     | 容量     | 用途                               |
| ----------- | ----------------------------------- | ---------- | --------------------------- | -------- | ---------------------------------- |
| `local`     | dir (`/var/lib/vz`)                 | node-local | iso, import, backup, vztmpl | 40.5 GiB | ISO / バックアップ / vzdump 置き場 |
| `local-lvm` | lvmthin (vg `pve`, thinpool `data`) | node-local | rootdir, images             | 56.5 GiB | 未使用 (使用 0)                    |
| `vm-pool`   | rbd (pool `vm-pool`, `krbd 0`)      | shared     | rootdir, images             | 949 GiB  | 全 VM / LXC のディスクが配置       |
