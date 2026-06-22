# FYNSV Proxmox Terraform

Proxmox クラスタ **FYNSV** (pve01/02/03) を [bpg/proxmox](https://registry.terraform.io/providers/bpg/proxmox/latest/docs) プロバイダで IaC 管理する。クラスタ構成の正は [`../cluster/README.md`](../cluster/README.md)。

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

## ガイド

### 払い出し直後のベースライン投入 (自動)

最小構成の Debian LXC には git / curl 等が入らず `LANG=C`・UTC のままになる。払い出し直後に `modules/lxc/provision.sh` が `ssh <node>` 経由の `pct exec` で自動投入する:

- apt: `unzip git openssh-client curl sudo ca-certificates locales`
- ja_JP.UTF-8 ロケール生成・既定化 (`LANG=ja_JP.UTF-8`)
- タイムゾーン `Asia/Tokyo`

スクリプトは冪等で、コンテナの作成/再作成時に一度だけ走る (`terraform_data.provision` の `triggers_replace = [vm_id]`)。投入には apply を回すマシンが `ssh pve01/02/03` 可能であることが前提。特定コンテナで止めたい場合は `containers.tf` で `provision = false` を指定する。ロケールの反映には再ログイン (`pct enter` し直し) が要る。

`provision = false` のコンテナや追加ツールを入れる場合は `pct enter` 後に手動で `apt -y install <pkg>` する (初回は `apt update`)。

### コンテナを Tailscale に載せる

既定方針は **コンテナ内で tailscale を動かさず、`arona` (192.168.2.100) が Tailscale Service (`svc:...`) / サブネットルーターとして同一 LAN 上のコンテナを代理公開する**こと。tailnet 側の顔は arona で、コンテナへは LAN 経由で届く。コンテナに tailscaled を入れないので TUN も要らず、非特権 LXC のまま済む (例: archivebox は CT 内に tailscale を持たず arona が `svc:archivebox` を広告)。新しいサービスを tailnet に出すときはこの方式を選ぶ。

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

### Docker をインストールする

```sh
# Remove previous versions of docker:
apt remove $(dpkg --get-selections docker.io docker-compose docker-doc podman-docker containerd runc | cut -f1)

# Add Docker's official GPG key:
apt update
apt install ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

# Add the repository to Apt sources:
tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: $(. /etc/os-release && echo "$VERSION_CODENAME")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

# Update and install:
apt update
apt install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin -y

# Velify:
docker run hello-world
```

状態とログを確認する:

```sh
systemctl status myapp.service
journalctl -u myapp.service -f
```

## Phase 0: ブートストラップ (Proxmox 上で一度だけ・手動)

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

## Phase 1: 基盤 init / 疎通確認

```sh
terraform init
terraform plan
```

既存ゲストは import 済みなので `terraform plan` は "No changes" になる。
認証エラー (401 等) が出たら token / endpoint を見直す。`terraform output pve_version` でも疎通確認できる。

## Phase 2: クラスタ設定 (任意)

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

## Phase 3: 既存ゲストの import

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

## Phase 4: 新規 LXC の払い出し

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
