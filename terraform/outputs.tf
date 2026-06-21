output "pve_version" {
  description = "接続先 Proxmox VE のバージョン (認証疎通の確認用)"
  value       = module.base.pve_version
}

output "cluster_nodes" {
  description = "クラスタ参加ノード一覧"
  value       = module.base.cluster_nodes
}

output "lxc_ipv4" {
  description = "LXC の IPv4 (ネットワークデバイス別)"
  value       = { for k, m in module.lxc : k => m.ipv4 }
}

output "app_token" {
  description = "アプリ用 API トークン値 (作成時のみ取得可能・state にのみ残る)。取得: terraform output -raw app_token"
  value       = module.base.app_token
  sensitive   = true
}
