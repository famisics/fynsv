# LXC コンテナの宣言。日常の編集面はこのファイルだけ。
# キーが hostname になり、未指定のフィールドは local.container_defaults
# (Debian 13 / 2 vCPU / 2GB RAM / 16GB disk / DHCP / nesting) で補完される。
#
# 払い出し例:
#   mybox = { target_node = "pve01" }
# 上書き例 (static IP は ip_address のみ指定。gateway / nameservers は container_defaults の共通値が効く):
#   mybox = { target_node = "pve01", cores = 4, memory = 4096, ip_address = "192.168.2.220/24" }
#
# テンプレート更新で既存コンテナは作り直されない (modules/lxc の ignore_changes)。
# 意図的に作り直す場合: terraform apply -replace='module.lxc["<name>"].proxmox_virtual_environment_container.this'
# vm_id は全コンテナで実 VMID を明示する。provider は宣言値が実 id と異なる時だけ再作成するため、既存と同じ値なら再作成されない。
# 新規払い出しは vm_id を省略すれば (container_defaults の null) Proxmox が自動採番する。

locals {
  containers = {
    supabase = {
      vm_id       = 200
      target_node = "pve03"
      memory      = 4096
      swap        = 2048
      disk_size   = 32
      ip_address  = "192.168.2.202/24"
    }

    archivebox = {
      vm_id       = 201
      target_node = "pve01"
      memory      = 4096
      disk_size   = 64
      firewall    = false
      ip_address  = "192.168.2.201/24"
    }

    misskey-web = {
      vm_id       = 210
      target_node = "pve03"
      swap        = 2048
      disk_size   = 32
      firewall    = false
      ip_address  = "192.168.2.203/24"
    }

    misskey-db = {
      vm_id       = 211
      target_node = "pve02"
      disk_size   = 24
      firewall    = false
      ip_address  = "192.168.2.204/24"
    }

    misskey-redis = {
      vm_id       = 212
      target_node = "pve02"
      memory      = 1024
      disk_size   = 8
      firewall    = false
      ip_address  = "192.168.2.205/24"
    }

    obsidian-livesync = {
      vm_id       = 213
      target_node = "pve01"
      ip_address  = "192.168.2.206/24"
    }

    coolify-cp = {
      vm_id       = 220
      target_node = "pve02"
      ip_address  = "192.168.2.208/24"
    }

    coolify-app = {
      vm_id       = 221
      target_node = "pve02"
      ip_address  = "192.168.2.209/24"
    }

    dokploy = {
      vm_id         = 222
      target_node   = "pve01"
      ip_address    = "192.168.2.210/24"
      start_on_boot = false
      started       = false
    }

    kei = {
      vm_id       = 223
      cores       = 6
      memory      = 4096
      swap        = 4096
      disk_size   = 48
      target_node = "pve03"
      ip_address  = "192.168.2.211/24"
    }

    mysql = {
      vm_id       = 214
      target_node = "pve01"
      memory      = 4096
      disk_size   = 32
      ip_address  = "192.168.2.212/24"
    }

    dawarich = {
      vm_id       = 224
      target_node = "pve03"
      ip_address  = "192.168.2.213/24"
    }
  }

  container_defaults = {
    vm_id            = null
    template_file_id = null # null なら base が配布する Debian 13 テンプレートを使う
    os_type          = "debian"
    cores            = 2
    memory           = 2048
    swap             = 512
    disk_size        = 16
    ip_address       = "dhcp"
    gateway          = "192.168.2.1"          # static IP のとき適用。dhcp 時はモジュールが null 化する
    nameservers      = ["8.8.8.8", "8.8.4.4"] # IX2215 は DNS をフォワードしないため外部 DNS を指定
    firewall         = true
    nesting          = true # Docker は nesting=1 だけで動く (keyctl 等は API トークンでは設定不可)
    keyctl           = false
    started          = true # false にすると apply 時にシャットダウンする
    start_on_boot    = true # false にすると Proxmox の自動起動設定を外す
    tags             = ["terraform"]
    provision        = true # 作成後に apt ベースライン / ロケール / TZ を流す
  }
}

module "lxc" {
  source   = "./modules/lxc"
  for_each = { for k, v in local.containers : k => merge(local.container_defaults, v) }

  name             = each.key
  vm_id            = each.value.vm_id
  target_node      = each.value.target_node
  template_file_id = each.value.template_file_id != null ? each.value.template_file_id : module.base.debian_template_id[each.value.target_node]
  os_type          = each.value.os_type
  cores            = each.value.cores
  memory           = each.value.memory
  swap             = each.value.swap
  disk_size        = each.value.disk_size
  ip_address       = each.value.ip_address
  gateway          = each.value.gateway
  nameservers      = each.value.nameservers
  firewall         = each.value.firewall
  nesting          = each.value.nesting
  keyctl           = each.value.keyctl
  started          = each.value.started
  start_on_boot    = each.value.start_on_boot
  tags             = each.value.tags
  provision        = each.value.provision
}
