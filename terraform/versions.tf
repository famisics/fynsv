terraform {
  required_version = ">= 1.5"

  required_providers {
    proxmox = {
      source = "bpg/proxmox"
      # 0.x はマイナーで破壊的変更が入りうるため、パッチのみ許容する。
      # アップグレード時は bpg の upgrade guide を確認して手動で上げる。
      version = "~> 0.108"
    }
  }
}
