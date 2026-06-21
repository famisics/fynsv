output "vm_id" {
  description = "払い出された VMID"
  value       = proxmox_virtual_environment_container.this.vm_id
}

output "ipv4" {
  description = "ネットワークデバイスごとの IPv4 アドレス map"
  value       = proxmox_virtual_environment_container.this.ipv4
}
