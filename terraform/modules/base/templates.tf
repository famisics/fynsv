# LXC 用 OS テンプレートの配布。各ノードの local datastore に自動ダウンロードする。

resource "proxmox_download_file" "debian_template" {
  for_each = toset(["pve01", "pve02", "pve03"])

  node_name    = each.key
  datastore_id = "local"
  content_type = "vztmpl"
  url          = "http://download.proxmox.com/images/system/debian-13-standard_13.1-2_amd64.tar.zst"
  # 配布は HTTP のみ (download.proxmox.com は TLS 証明書不一致で HTTPS 不可) のため、
  # 署名付きインデックス aplinfo-pve-9.dat の値をピン留めして改ざんを検出する (pveam と同じ検証方式)。
  checksum           = "5aec4ab2ac5c16c7c8ecb87bfeeb10213abe96db6b85e2463585cea492fc861d7c390b3f9c95629bf690b95e9dfe1037207fc69c0912429605f208d5cb2621f8"
  checksum_algorithm = "sha512"
  # 過去に pveam download 等で同名ファイルが置かれていても apply を失敗させない
  # (checksum 検証があるため上書きしても安全)。
  overwrite_unmanaged = true
}
