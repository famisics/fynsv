variable "name" {
  description = "コンテナ名 (= hostname)"
  type        = string
}

variable "target_node" {
  description = "作成先ノード"
  type        = string
}

variable "template_file_id" {
  description = "OS テンプレート (例: local:vztmpl/debian-13-standard_13.0-1_amd64.tar.zst)"
  type        = string
}

variable "vm_id" {
  description = "VMID。null なら provider が自動採番"
  type        = number
  default     = null
}

variable "cores" {
  description = "vCPU コア数"
  type        = number
  default     = 2
}

variable "memory" {
  description = "メモリ (MB)"
  type        = number
  default     = 2048
}

variable "swap" {
  description = "swap (MB)"
  type        = number
  default     = 512
}

variable "disk_size" {
  description = "ルートディスク (GB)"
  type        = number
  default     = 16
}

variable "datastore_id" {
  description = "ルートディスクを置くストレージ"
  type        = string
  default     = "vm-pool"
}

variable "bridge" {
  description = "ネットワークブリッジ"
  type        = string
  default     = "vmbr0"
}

variable "ip_address" {
  description = "eth0 の IPv4。\"dhcp\" か CIDR (例 192.168.2.220/24)"
  type        = string
  default     = "dhcp"
}

variable "gateway" {
  description = "static 時のデフォルトゲートウェイ。dhcp 時は null"
  type        = string
  default     = null
}

variable "nameservers" {
  description = "DNS サーバ。static 時は IX2215 が DNS を返さないので明示する"
  type        = list(string)
  default     = []
}

variable "firewall" {
  description = "NIC のファイアウォールを有効化するか"
  type        = bool
  default     = true
}

variable "nesting" {
  description = "features.nesting"
  type        = bool
  default     = false
}

variable "keyctl" {
  description = "features.keyctl"
  type        = bool
  default     = false
}

variable "os_type" {
  description = "operating_system.type"
  type        = string
  default     = "debian"
}

variable "start_on_boot" {
  description = "ホスト起動時に自動起動するか"
  type        = bool
  default     = true
}

variable "started" {
  description = "作成後に起動するか"
  type        = bool
  default     = true
}

variable "tags" {
  description = "コンテナタグ"
  type        = list(string)
  default     = ["terraform"]
}

variable "provision" {
  description = "作成後に provision.sh (apt ベースライン / ロケール / TZ) を ssh+pct exec で流すか"
  type        = bool
  default     = true
}
