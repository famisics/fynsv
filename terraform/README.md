# FYNSV Proxmox Terraform

Proxmox クラスタ **FYNSV** (pve01/02/03) を [bpg/proxmox](https://registry.terraform.io/providers/bpg/proxmox/latest/docs) プロバイダで IaC 管理する。クラスタ構成の正は [`../services/README.md`](../services/README.md)。

- **認証**: API トークン (`terraform@pve!provider`)
- **state**: ローカル (`terraform.tfstate`、`.gitignore` 済み)
- **対象**: LXC の払い出し・既存ゲスト (VM/LXC) の import・ユーザー/トークン/ACL
- **対象外**: storage.cfg の rbd 定義・Ceph pool (`vm-pool`)・corosync・vmbr0 → data source 参照のみ

## ファイル構成

| ファイル | 役割 |
| --- | --- |
| `containers.tf` | **LXC 全台の宣言 (`local.containers`)。日常の編集面はここだけ** |
| `vms.tf` | import 済み VM (100/101) の構成 |
| `base.tf` | `modules/base` の呼び出し |
| `versions.tf` | terraform / provider バージョン制約 |
| `provider.tf` | provider 設定 (endpoint/api_token/insecure) |
| `variables.tf` | 入力変数 |
| `outputs.tf` | バージョン/ノード/IP/トークン出力 |
| `modules/base/` | 基盤: OS テンプレート配布 (Debian 13)・クラスタ参照・ユーザー/トークン/ACL (Phase 2・既定無効) |
| `modules/lxc/` | LXC 払い出し用モジュール |
| `terraform.tfvars.example` | 変数のサンプル (実値は `terraform.tfvars` に。機密のみ — ゲスト宣言は書かない) |

## 払い出し直後のベースライン投入 (自動)

最小構成の Debian LXC には git / curl 等が入らず `LANG=C`・UTC のままになる。払い出し直後に `modules/lxc/provision.sh` が `ssh <node>` 経由の `pct exec` で自動投入する:

- apt: `unzip git openssh-client curl ca-certificates locales`
- ja_JP.UTF-8 ロケール生成・既定化 (`LANG=ja_JP.UTF-8`)
- タイムゾーン `Asia/Tokyo`

- 冪等: コンテナの作成/再作成時に一度だけ走る (`terraform_data.provision` の `triggers_replace = [vm_id]`)
- 前提: apply を回すマシンが `ssh pve01/02/03` 可能であること
- 無効化: 特定コンテナで止めたい場合は `containers.tf` で `provision = false` を指定
- ロケールの反映には再ログイン (`pct enter` し直し) が要る

`provision = false` のコンテナや追加ツールを入れる場合は `pct enter` 後に手動で `apt -y install <pkg>` する (初回は `apt update`)。

ゲスト内部の共通セットアップ Tips (Tailscale 代理・sudo ユーザー追加・systemd 自動起動・Docker 導入) は [`../services/README.md`](../services/README.md) を参照。

## 初期設定

### Phase 0: ブートストラップ (Proxmox 上で一度だけ・手動)

provider が使う「親トークン」を発行する。`ssh pve01` 等で root 実行:

```sh
# 専用ユーザー
pveum user add terraform@pve --comment "Terraform/OpenTofu (managed by IaC)"

# 専用ロール (最小寄り。permission denied が出たら個別追加する)
pveum role add Terraform -privs "VM.Allocate VM.Clone VM.Config.CDROM VM.Config.CPU VM.Config.Cloudinit VM.Config.Disk VM.Config.HWType VM.Config.Memory VM.Config.Network VM.Config.Options VM.Audit VM.Console VM.Migrate VM.PowerMgmt VM.GuestAgent.Audit VM.GuestAgent.Unrestricted Datastore.Allocate Datastore.AllocateSpace Datastore.AllocateTemplate Datastore.Audit Pool.Allocate Pool.Audit Sys.Audit Sys.Console Sys.Modify SDN.Use"

# / に割当 (propagate)
pveum aclmod / -user terraform@pve -role Terraform

# API トークン発行 (privsep=0 = ユーザー権限を継承)
pveum user token add terraform@pve provider --privsep=0
#   → 出力された value (UUID) は再表示されない。1Password に保存する。
#   → full token id は  terraform@pve!provider=<value>
```

発行した値を `terraform.tfvars` に転記する:

```sh
cp terraform.tfvars.example terraform.tfvars
# pve_api_token = "terraform@pve!provider=<value>" を記入
```

### Phase 1: 基盤 init / 疎通確認

```sh
terraform init
terraform plan
```

既存ゲストは import 済みなので `terraform plan` は "No changes" になる。
認証エラー (401 等) が出たら token / endpoint を見直す。`terraform output pve_version` でも疎通確認できる。

### Phase 2: クラスタ設定 (任意)

ユーザー/トークン/ACL を宣言管理する場合。まず親ロールに権限を追加:

```sh
# pve01 で root 実行: 既存 Terraform ロールにユーザー管理権限を追加
pveum role modify Terraform -privs "<Phase 0 の privs> User.Modify Permissions.Modify Realm.AllocateUser"
```

`terraform.tfvars` で有効化して apply:

```hcl
manage_cluster_users = true
```

```sh
terraform apply
terraform output -raw app_token   # 払い出されたアプリ用トークン値 (1Password へ)
```

> `proxmox_user_token.value` は**作成時のみ**取得可能・import 不可。値は tfstate に平文で残るため、`terraform.tfstate` のファイル権限に注意 (ローカル + `.gitignore` 前提)。

### Phase 3: 既存ゲストの import

VM 100/101 は `vms.tf`、LXC (200/201/210/211/212 ほか) は `containers.tf` に取り込み済み。追加で取り込む手順:

**LXC**: module 配下への config 生成はできないため、先に `containers.tf` の `local.containers` へエントリを書いてから import する:

```sh
# 1. エントリを宣言してから import ブロックを一時ファイルに書く
cat > _import.tf <<'EOF'
import {
  to = module.lxc["example"].proxmox_virtual_environment_container.this
  id = "pve02/220"   # ノード名/VMID
}
EOF

# 2. plan を確認 (import + 無害な in-place 更新のみで destroy/replace が無いこと)
terraform plan

# 3. 差分を人間が確認してから確定 → import ブロックは削除
terraform apply
rm _import.tf
```

state の `vm_id` 属性が null で取り込まれた場合、宣言に `vm_id` を書くと再作成になるので書かない。

**VM**: import ブロック (`to = proxmox_virtual_environment_vm.example`) を書き、`terraform plan -generate-config-out=generated.tf` で HCL を生成して `vms.tf` へ整形して取り込む。bpg の生成は `cpu.units = 0` を吐くが apply で弾かれるので該当行を削除する。

> 稼働中ゲストの import は読み取りのみで安全。ただし apply 前に `terraform plan` の差分 (特に force-replace) を必ず人間が確認すること。
> 取り消したいときは `terraform state rm <addr>` で実機に触れず管理解除できる。

### Phase 4: 新規 LXC の払い出し

`containers.tf` の `local.containers` に宣言してコミット → apply。`target_node` だけ書けばデフォルト (Debian 13 / 2 vCPU / 2 GB RAM / 16 GB disk / DHCP / nesting) で立つ。テンプレートは `modules/base` が各ノードに自動ダウンロードするので事前準備は不要。

```hcl
locals {
  containers = {
    mybox = { target_node = "pve01" }
  }
}
```

```sh
terraform apply
terraform output lxc_ipv4           # 払い出した LXC の IP
```

コンテナへは Proxmox ノード経由で入る (SSH 鍵は投入しない):

```sh
ssh pve01            # コンテナのいるノードへ
pct enter <vmid>     # root シェルに入る
```

デフォルトを上書きする場合はフィールドを追加する (static IP のときは `gateway` と `nameservers` も指定)。
静的 IP は IX2215 の DHCP プール (`.100`–`.200`) を避けて `.201` 以降を順に割り当てる:

```hcl
mybox = { target_node = "pve01", cores = 4, memory = 4096, ip_address = "192.168.2.220/24", gateway = "192.168.2.1", nameservers = ["8.8.8.8", "8.8.4.4"] }
```

Debian 13 以外にしたい場合は `template_file_id` と `os_type` を上書きする (テンプレートは `local:vztmpl/...` を手動 `pveam download`)。
