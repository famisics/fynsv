# FYNSV 上のサービス

この `services/` は、Proxmox VE 3 ノードクラスタ **FYNSV** 上で動かすサービス群の構築・運用文書をまとめる。

> **ゲスト (VM / LXC) のリソース定義 (vCPU / RAM / ディスク / NIC / 静的 IP) の正は [`../terraform/`](../terraform/) を参照。**
> 各サービスの内部構築・運用は各サブディレクトリの README を正とする。
> 本書は services 全体の索引と、全サービスが共有するクラスタ基盤 (ノード / Ceph / ストレージ、Terraform 管理外) を記録する。

## サービス一覧

| サービス | ディレクトリ | 役割 | ゲスト (VMID) |
| --- | --- | --- | --- |
| Misskey | [`misskey/`](./misskey/README.md) | Misskey 本体 / PostgreSQL / Redis の 3 LXC 構成 | 210 / 211 / 212 |
| misskey-mixi2-link | [`misskey-mixi2-link/`](./misskey-mixi2-link/README.md) | Misskey ⇔ mixi2 投稿ブリッジ | 216 |
| Obsidian LiveSync | [`obsidian-livesync/`](./obsidian-livesync/README.md) | CouchDB (Obsidian Self-hosted LiveSync バックエンド) | 213 |
| mysql | [`mysql/`](./mysql/README.md) | MariaDB + phpMyAdmin (共有 DB 基盤) | 214 |
| Coolify | [`coolify/`](./coolify/README.md) | コントロールプレーン / アプリ実行サーバー | 220 / 221 |
| dawarich | [`dawarich/`](./dawarich/README.md) | 位置情報トラッキング (PostGIS + Redis + Sidekiq, Docker Compose) | 224 |
| Status Page | [`status-page/`](./status-page/README.md) | サービス稼働状況・リソース使用量の収集と公開 | — |
| discord-bot | `discord-bot/` (README 未整備) | Discord bot (fun-council: リマインダー / ロール自動付与)。arona 上で Docker 常駐 | — |
| swarm-gcal-sync | [`swarm-gcal-sync/`](./swarm-gcal-sync/README.md) | Swarm チェックイン → Google カレンダー同期。arona 上で Docker 常駐 | — |

## ゲスト (VM / LXC) 一覧

本表は役割・配置の索引。リソース割り当て (vCPU / RAM / ディスク / NIC / 静的 IP / features / タグ) は **Terraform が正** ([`../terraform/`](../terraform/))。LXC は `module.lxc["<名前>"]` (`containers.tf`)、VM は `vms.tf` で管理し、IP は `terraform output` で取得する。

| VMID | 種別 | 名前                 | ノード | 用途                                            |
| ---- | ---- | -------------------- | ------ | ----------------------------------------------- |
| 100  | qemu | `arona`              | pve02  | 公開口 (Tailscale + cloudflared)、Docker ホスト |
| 101  | qemu | `prana`              | pve01  | 予備 (stopped)                                  |
| 200  | lxc  | `supabase`           | pve03  | Supabase スタック (Docker)                      |
| 201  | lxc  | `archivebox`         | pve02  | ArchiveBox (community-script 由来)              |
| 210  | lxc  | `misskey-web`        | pve03  | Misskey 本体 (Node.js)                          |
| 211  | lxc  | `misskey-db`         | pve02  | PostgreSQL                                      |
| 212  | lxc  | `misskey-redis`      | pve02  | Redis                                           |
| 213  | lxc  | `obsidian-livesync`  | pve03  | CouchDB (Docker)、Obsidian LiveSync バックエンド |
| 214  | lxc  | `mysql`              | pve01  | MariaDB + phpMyAdmin (共有 DB 基盤)             |
| 216  | lxc  | `misskey-mixi2-link` | pve02  | Misskey⇔mixi2 ブリッジ (再セットアップ待ち)     |
| 220  | lxc  | `coolify-cp`         | pve02  | Coolify コントロールプレーン                    |
| 221  | lxc  | `coolify-app`        | pve02  | Coolify アプリ実行サーバー                      |
| 222  | lxc  | `dokploy`            | pve01  | Dokploy (PaaS、詳細未整理、stopped)             |
| 223  | lxc  | `kei`                | pve03  | 開発用途                                        |
| 224  | lxc  | `dawarich`           | pve03  | dawarich (位置情報トラッキング、Docker Compose) |

各ゲスト内部の構築・運用は対応するサービス文書を正とする: [misskey](./misskey/README.md) (210/211/212) / [obsidian-livesync](./obsidian-livesync/README.md) (213) / [mysql](./mysql/README.md) (214) / [misskey-mixi2-link](./misskey-mixi2-link/README.md) (216) / [coolify](./coolify/README.md) (220/221) / [dawarich](./dawarich/README.md) (224)。

### 公開口 arona (VM 100)

Tailscale と cloudflared を載せた公開口で、各サービスの外部公開はすべて arona の cloudflared (token 方式) に Public Hostname を足して行う。同一 LAN 上のコンテナは arona が Tailscale Service / サブネットルーターとして代理公開する。

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

`pvecm status` のメンバーシップは 192.168.2.11 / .12 / .13 で表示される。`/etc/pve/corosync.conf` と各ノード `/etc/corosync/corosync.conf` の `ring0_addr` も 192.168.2.x で一致しており、`corosync-cfgtool -s` でも LINK 0 udp が 192.168.2.x にバインドされている。

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
