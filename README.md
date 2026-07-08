# fynsv

自宅サーバー基盤の管理プロジェクト。Proxmox VE 3 ノードクラスタ **FYNSV** (pve01/02/03) と、その上のゲスト・サービス・ネットワーク機器を扱う。

## 構成

| ディレクトリ | 内容 |
| --- | --- |
| [`services/`](./services/) | クラスタ上で動かすサービスごとの構築・運用文書と、サービス索引・クラスタ基盤の仕様 (ノード / Ceph / ストレージ) |
| [`terraform/`](./terraform/) | ゲスト (VM / LXC) の IaC。**リソース定義の唯一の正** |
| [`router/`](./router/) | ネットワーク機器 (NEC IX2215 ×2) の設定・トポロジ・計画 |
| [`.claude/skills/claude-remote/`](./.claude/skills/claude-remote/SKILL.md) | Claude Code が SSH / シリアル越しにリモート機器を操作する基盤 (スキル) |
| [`archives/`](./archives/) | 廃止したリソースの記録 |

## 情報の所在ルール

- ゲストのリソース定義 (VMID / ノード / vCPU / RAM / ディスク / 静的 IP / features / tags) は **`terraform/` が唯一の正**。文書側はスペックを転記せず TF のリソースアドレスを参照する
- ゲスト内部の構築・運用 (OS 内のセットアップ、サービス設定) は `services/*/README.md`
- クラスタ基盤 (ノード / Ceph / ストレージ、TF 管理外) は `services/README.md`
- ネットワーク (ルーター / WAN / LAN / IPv6) は `router/`

## 詳細情報

実装の詳細については [CLAUDE.md](./CLAUDE.md) を参照。
