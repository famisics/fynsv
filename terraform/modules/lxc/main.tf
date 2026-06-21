resource "proxmox_virtual_environment_container" "this" {
  node_name     = var.target_node
  vm_id         = var.vm_id
  unprivileged  = true
  started       = var.started
  start_on_boot = var.start_on_boot
  tags          = var.tags

  cpu {
    cores = var.cores
  }

  memory {
    dedicated = var.memory
    swap      = var.swap
  }

  disk {
    datastore_id = var.datastore_id
    size         = var.disk_size
  }

  network_interface {
    name     = "eth0"
    bridge   = var.bridge
    firewall = var.firewall
  }

  operating_system {
    template_file_id = var.template_file_id
    type             = var.os_type
  }

  initialization {
    hostname = var.name

    dynamic "dns" {
      for_each = length(var.nameservers) > 0 ? [1] : []
      content {
        servers = var.nameservers
      }
    }

    ip_config {
      ipv4 {
        address = var.ip_address
        gateway = var.ip_address == "dhcp" ? null : var.gateway
      }
    }
  }

  features {
    nesting = var.nesting
    keyctl  = var.keyctl
  }

  # 作成時にしか意味を持たない / API トークンでは変更できない属性は差分を無視する。
  # 意図的に作り直す場合: terraform apply -replace='module.lxc["<name>"].proxmox_virtual_environment_container.this'
  lifecycle {
    ignore_changes = [
      operating_system[0].template_file_id, # テンプレ更新で既存コンテナが作り直されるのを防ぐ
      initialization[0].user_account,       # 作成時に鍵を投入した既存コンテナとの差分を無視する
      features,                             # keyctl 等は root@pam でしか変更できず API トークンでは 403 になる
    ]
  }
}

# 払い出し直後のベースライン投入 (apt / ロケール / TZ)。コンテナに鍵を入れず、
# apply を回すマシンから ssh <node> 経由で pct exec する (既存の「ノード経由で入る」方式)。
# triggers_replace に vm_id を置き、作成/再作成時に一度だけ流す。失敗時は tainted になり次 apply で再実行。
resource "terraform_data" "provision" {
  count = var.provision ? 1 : 0

  triggers_replace = [proxmox_virtual_environment_container.this.vm_id]

  provisioner "local-exec" {
    command = "ssh ${var.target_node} 'pct exec ${proxmox_virtual_environment_container.this.vm_id} -- bash -s' < ${path.module}/provision.sh"
  }
}
