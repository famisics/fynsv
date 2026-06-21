variable "pve_endpoint" {
  description = "Proxmox VE API エンドポイント (例: https://192.168.2.11:8006/)"
  type        = string
}

variable "pve_api_token" {
  description = "API トークン (形式: user@realm!tokenid=uuid)。terraform.tfvars か環境変数 TF_VAR_pve_api_token で渡す"
  type        = string
  sensitive   = true
}

variable "pve_insecure" {
  description = "自己署名証明書を許可するか"
  type        = bool
  default     = true
}

variable "manage_cluster_users" {
  description = "クラスタのユーザー/ロール/トークン/ACL (cluster-users.tf) を宣言管理するか。有効化前に親ロールへ User.Modify / Permissions.Modify / Realm.AllocateUser を付与すること"
  type        = bool
  default     = false
}
