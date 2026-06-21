# 既存クラスタの参照 (read-only)。認証疎通の確認も兼ねる。
# storage.cfg / Ceph pool は TF 管理対象外。

data "proxmox_version" "current" {}

data "proxmox_virtual_environment_nodes" "available" {}
