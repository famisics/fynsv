# 既存 VM の構成。terraform import で実機から取り込み済み。
# リソース割り当て (vCPU/RAM/ディスク/NIC) の正はこの定義。
# 初期値は `terraform plan -generate-config-out` で生成 (provider 既定値を含む)。

resource "proxmox_virtual_environment_vm" "prana" {
  acpi                                 = true
  bios                                 = "seabios"
  boot_order                           = ["scsi0", "net0"]
  delete_unreferenced_disks_on_destroy = true
  description                          = null
  hook_script_file_id                  = null
  keyboard_layout                      = "en-us"
  kvm_arguments                        = null
  mac_addresses                        = ["BC:24:11:A8:C3:DF"]
  machine                              = null
  migrate                              = false
  name                                 = "prana"
  network_device = [{
    bridge       = "vmbr0"
    disconnected = false
    enabled      = null
    firewall     = true
    mac_address  = "BC:24:11:A8:C3:DF"
    model        = "virtio"
    mtu          = 0
    queues       = 0
    rate_limit   = 0
    trunks       = ""
    vlan_id      = 0
  }]
  node_name           = "pve01"
  on_boot             = false
  pool_id             = null
  protection          = false
  purge_on_destroy    = true
  reboot              = false
  reboot_after_update = true
  scsi_hardware       = "virtio-scsi-single"
  started             = false
  stop_on_destroy     = false
  tablet_device       = true
  tags                = []
  template            = false
  timeout_clone       = 1800
  timeout_create      = 1800
  timeout_migrate     = 1800
  timeout_reboot      = 1800
  timeout_shutdown_vm = 1800
  timeout_start_vm    = 1800
  timeout_stop_vm     = 300
  vm_id               = 101
  cpu {
    affinity     = null
    architecture = null
    cores        = 4
    flags        = []
    hotplugged   = 0
    limit        = 0
    numa         = false
    sockets      = 1
    type         = "x86-64-v2-AES"
  }
  disk {
    aio               = "io_uring"
    backup            = true
    cache             = "none"
    datastore_id      = "vm-pool"
    discard           = "ignore"
    file_format       = "raw"
    file_id           = null
    import_from       = null
    interface         = "scsi0"
    iothread          = true
    path_in_datastore = "vm-101-disk-0"
    replicate         = true
    serial            = null
    size              = 64
    ssd               = false
  }
  memory {
    dedicated      = 8192
    floating       = 0
    hugepages      = null
    keep_hugepages = false
    shared         = 0
  }
  operating_system {
    type = "l26"
  }
}

resource "proxmox_virtual_environment_vm" "arona" {
  acpi                                 = true
  bios                                 = "seabios"
  boot_order                           = ["scsi0", "net0"]
  delete_unreferenced_disks_on_destroy = true
  description                          = null
  hook_script_file_id                  = null
  keyboard_layout                      = "en-us"
  kvm_arguments                        = null
  mac_addresses                        = ["BC:24:11:72:61:10"]
  machine                              = null
  migrate                              = false
  name                                 = "arona"
  network_device = [{
    bridge       = "vmbr0"
    disconnected = false
    enabled      = null
    firewall     = true
    mac_address  = "BC:24:11:72:61:10"
    model        = "virtio"
    mtu          = 0
    queues       = 0
    rate_limit   = 0
    trunks       = ""
    vlan_id      = 0
  }]
  node_name           = "pve01"
  on_boot             = true
  pool_id             = null
  protection          = false
  purge_on_destroy    = true
  reboot              = false
  reboot_after_update = true
  scsi_hardware       = "virtio-scsi-single"
  started             = true
  stop_on_destroy     = false
  tablet_device       = true
  tags                = []
  template            = false
  timeout_clone       = 1800
  timeout_create      = 1800
  timeout_migrate     = 1800
  timeout_reboot      = 1800
  timeout_shutdown_vm = 1800
  timeout_start_vm    = 1800
  timeout_stop_vm     = 300
  vm_id               = 100
  cpu {
    affinity     = null
    architecture = null
    cores        = 4
    flags        = []
    hotplugged   = 0
    limit        = 0
    numa         = false
    sockets      = 1
    type         = "x86-64-v2-AES"
  }
  disk {
    aio               = "io_uring"
    backup            = true
    cache             = "none"
    datastore_id      = "vm-pool"
    discard           = "ignore"
    file_format       = "raw"
    file_id           = null
    import_from       = null
    interface         = "scsi0"
    iothread          = true
    path_in_datastore = "vm-100-disk-0"
    replicate         = true
    serial            = null
    size              = 64
    ssd               = false
  }
  memory {
    dedicated      = 8192
    floating       = 0
    hugepages      = null
    keep_hugepages = false
    shared         = 0
  }
  operating_system {
    type = "l26"
  }
}
