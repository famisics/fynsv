# クラスタのユーザー/ロール/トークン/ACL を宣言管理する (Phase 2)。
#
# provider を動かす親トークン (terraform@pve!provider) とは別に、
# 「アプリ/CI 用」の権限を払い出す例。chicken-and-egg を避けるため、
# 親トークンは pveum で手動発行し (README Phase 0)、ここではそれ以外を TF 管理する。
#
# 既定では無効 (var.manage_cluster_users = false)。有効化する前に親ロールへ
# User.Modify / Permissions.Modify / Realm.AllocateUser を付与しておくこと。

resource "proxmox_virtual_environment_role" "app" {
  count      = var.manage_cluster_users ? 1 : 0
  role_id    = "AppDeployer"
  privileges = ["VM.Audit", "VM.PowerMgmt", "VM.Console", "VM.GuestAgent.Audit"]
}

resource "proxmox_virtual_environment_user" "app" {
  count   = var.manage_cluster_users ? 1 : 0
  user_id = "app@pve"
  comment = "Managed by Terraform"
  enabled = true
}

resource "proxmox_user_token" "app" {
  count                 = var.manage_cluster_users ? 1 : 0
  user_id               = proxmox_virtual_environment_user.app[0].user_id
  token_name            = "ci"
  comment               = "Managed by Terraform"
  privileges_separation = false
}

resource "proxmox_acl" "app" {
  count     = var.manage_cluster_users ? 1 : 0
  user_id   = proxmox_virtual_environment_user.app[0].user_id
  role_id   = proxmox_virtual_environment_role.app[0].role_id
  path      = "/vms"
  propagate = true
}
