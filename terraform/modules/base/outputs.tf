output "debian_template_id" {
  description = "ノードごとの Debian テンプレート file id"
  value       = { for node, f in proxmox_download_file.debian_template : node => f.id }
}

output "pve_version" {
  description = "接続先 Proxmox VE のバージョン (認証疎通の確認用)"
  value       = data.proxmox_version.current.version
}

output "cluster_nodes" {
  description = "クラスタ参加ノード一覧"
  value       = data.proxmox_virtual_environment_nodes.available.names
}

output "app_token" {
  description = "アプリ用 API トークン値 (作成時のみ取得可能・state にのみ残る)"
  value       = var.manage_cluster_users ? proxmox_user_token.app[0].value : null
  sensitive   = true
}
