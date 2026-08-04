# CLAUDE.md

このファイルは Claude Code がこのリポジトリで作業する際のガイドを提供する。
プロジェクトの概要とセットアップは [README.md](./README.md) を参照。

## プロジェクト概要

Proxmox VE 3 ノードクラスタ (FYNSV) のインフラ管理リポジトリ。コードプロジェクトではなく、Terraform による IaC とサービス構築・運用ドキュメントの集合体。

## コマンド

### Terraform (`terraform/` 内で実行)

| コマンド | 説明 |
| --- | --- |
| `terraform init` | プロバイダ初期化 |
| `terraform plan` | 差分確認 |
| `terraform apply` | 適用 |
| `terraform output` | 出力値表示 |

## 情報の所在ルール

各ドキュメントの管轄範囲が厳密に分かれている。正でないファイルにスペックを転記しない。

| 対象 | 正となるファイル |
| --- | --- |
| ゲストのリソース定義 (VMID / vCPU / RAM / ディスク / IP) | `terraform/containers.tf`, `terraform/vms.tf` |
| ゲスト内部の構築・運用 | `services/*/README.md`, `services/connections/*/README.md` |
| クラスタ基盤 (ノード / Ceph / ストレージ) | `services/README.md` |
| ネットワーク (ルーター / WAN / LAN / IPv6) | `router/` |

## Terraform の構造

- **プロバイダ**: [bpg/proxmox](https://registry.terraform.io/providers/bpg/proxmox/latest/docs) (`~> 0.108`)
- **認証**: API トークン (`terraform@pve!provider`)。値は `terraform.tfvars` に格納 (gitignore 済み)
- **state**: ローカル (`terraform.tfstate`、gitignore 済み)
- **LXC 定義**: `containers.tf` の `local.containers` に宣言。`local.container_defaults` でデフォルト値 (Debian 13 / 2 vCPU / 2GB RAM / 16GB disk / DHCP / nesting) を補完
- **新規 LXC 払い出し**: `containers.tf` にエントリ追加 → `terraform apply`。
- **静的 IP**: IX2215 の DHCP プール (`.100`–`.200`) を避けて `.201` 以降を使用。`gateway` と `nameservers` も必須
- **プロビジョニング**: 払い出し直後に `modules/lxc/provision.sh` がベースライン (apt / ロケール / TZ) を自動投入。`provision = false` で無効化可

## 注意事項

- LXC の `vm_id` を既存コンテナに後から書くと再作成になる可能性がある。既存と同じ値であれば安全
- `terraform plan` の差分 (特に force-replace) は必ず人間が確認してから apply する
- Tailscale はコンテナ内に入れず、`arona` (VM 100) が Tailscale Service / サブネットルーターとして代理公開する方針

<!-- custom:begin -->
<!-- custom:end -->
