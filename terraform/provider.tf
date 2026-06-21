provider "proxmox" {
  endpoint  = var.pve_endpoint
  api_token = var.pve_api_token
  insecure  = var.pve_insecure

  # bpg はほとんどの操作 (VM/LXC の CRUD・clone・migration・download) を HTTP API で行うため
  # SSH は不要。snippet/file upload・disk の file_id import・container の idmap を使うときだけ
  # SSH が必要になる。その場合は README「SSH を有効化する」を参照して ssh ブロックを追加する。
}
