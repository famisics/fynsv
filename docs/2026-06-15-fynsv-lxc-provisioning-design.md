# FYNSV LXC 払い出し後プロビジョニングの IaC 化

## 背景と目的

`projects/fynsv/terraform` で払い出す Debian LXC は最小構成で、git / curl / ロケール等が入っていない。新規払い出しのたびに `pct enter` 後の `apt` 行脚が発生していた（手順は README に記載）。これを Terraform 側に寄せ、**払い出し直後にベースライン設定を自動投入**する。

ディストロを Ubuntu に変える案は却下した。Proxmox の `*-standard` テンプレートはどれもミニマルで Ubuntu でも未インストール状況は変わらず、移行は全コンテナ replace（データ消失リスク）を伴うため。根本解はディストロ変更ではなくプロビジョニング自動化。
w
## スコープ

### やること
- 払い出し直後に冪等なスクリプトを流し、ベースラインを揃える。
- 全コンテナ既定 ON、コンテナ単位でオプトアウト可能にする。

### ベースライン（投入内容）
- apt パッケージ: `unzip git openssh-client curl sudo ca-certificates locales`
- ja_JP.UTF-8 ロケール生成・既定化（`LANG=ja_JP.UTF-8`）
- タイムゾーン `Asia/Tokyo`

### やらないこと（YAGNI / 既存方針との整合）
- ユーザー `famisics` 作成・sudoers 設定（用途依存。README の手動手順として残す）。
- `openssh-server` 投入（「鍵を投入せずノード経由 `pct enter` で入る」既存方針と矛盾）。
- NTP / `systemd-timesyncd`（LXC はホスト時計を共有。unprivileged では設定不可で無意味）。
- `unattended-upgrades`（勝手な更新・再起動は自前運用と相性が悪い）。
- ディストロ変更・カスタムテンプレート焼き。

## 機構

`terraform_data`（TF 1.5 で利用可、外部 null provider 不要）+ `local-exec` プロビジョナで、operator のマシンから `ssh <node> 'pct exec <vmid> -- bash -s' < provision.sh` を実行する。コンテナに鍵を投入せず、既存の「ノード経由で入る」アクセスモデルにそのまま乗る。

- `ssh` のホストは `target_node`（`pve01` / `pve02` / `pve03`）で、README の SSH alias と一致する。
- vmid はリソース属性 `proxmox_virtual_environment_container.this.vm_id` を参照する（自動採番でも確定値が得られる。`var.vm_id` は null になり得るため使わない）。
- スクリプトは stdin パイプで渡す（インラインのクォート地獄を避け、本体を実ファイルに置く）。

### 検討した代替案
1. provider に SSH ブロック + `remote-exec` でコンテナへ直接 → コンテナへ鍵投入が前提になり方針と矛盾。却下。
2. カスタムテンプレートを焼く → 別ワークフローで重く、漸進的な IaC 化から外れる。却下。

## 配線（変更ファイル）

`modules/lxc` 内に閉じる。新しいツマミは `provision` 1 つだけ。

| ファイル | 変更 |
| --- | --- |
| `modules/lxc/provision.sh` | 新規。冪等な投入スクリプト本体 |
| `modules/lxc/main.tf` | `terraform_data` を追加（`count = var.provision ? 1 : 0`、`triggers_replace = [proxmox_virtual_environment_container.this.vm_id]`、`local-exec`） |
| `modules/lxc/variables.tf` | `variable "provision"`（bool, 既定 `true`）を追加 |
| `containers.tf` | `container_defaults` に `provision = true`、module 呼び出しに `provision = each.value.provision` を追加 |
| `terraform/README.md` | 「Debian へのツール導入」「日本語ロケール」を自動投入される旨に書き換え |

### provision.sh（冪等・非対話）

```sh
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
for i in $(seq 1 10); do apt-get update -qq && break; sleep 3; done   # 起動直後の network 待ち
apt-get install -y unzip git openssh-client curl sudo ca-certificates locales
sed -i 's/^# *ja_JP.UTF-8 UTF-8/ja_JP.UTF-8 UTF-8/' /etc/locale.gen
locale-gen && update-locale LANG=ja_JP.UTF-8
ln -sf /usr/share/zoneinfo/Asia/Tokyo /etc/localtime && echo 'Asia/Tokyo' > /etc/timezone
```

## トリガと適用挙動

- `triggers_replace = [vm_id]`: 作成 / 再作成時に一度だけ実行。以降の apply では走らない。
- 既存コンテナ（supabase / archivebox / misskey 等）: この変更後の初回 apply で `terraform_data` が新規作成され、スクリプトが一度だけ無害に流れる（冪等なのでロケール / TZ がベースラインに揃うだけ）。以降は触れない。
- 失敗時: `terraform_data` が tainted になり、次 apply で再実行される。

## 前提・制約

- `terraform apply` を回すマシンが `ssh pve01/02/03` 可能であること（operator の Mac 前提）。鍵なし CI 等では provisioner が落ちる → その環境では当該コンテナを `provision = false` にする。
- `local-exec` はステート管理されず「作成時に一度走るだけ」。投入物の継続的な収束は保証しない（冪等スクリプトの一回流しにとどまる）。

## 検証

- `terraform plan` で `terraform_data` の追加が想定どおり（既存コンテナ本体に destroy/replace が出ないこと）を確認。
- 新規テスト用 LXC を1台払い出し、apply 後に `pct enter` して `git --version` / `locale` / `date`（JST）でベースラインを確認。
- `provision = false` のコンテナで provisioner が走らないことを確認。
