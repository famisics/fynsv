# luna-template (廃止)

VM 300 `luna-template` は pve02 上の Cloud-Init テンプレート (qemu)。Terraform 管理外。

VM テンプレートによる払い出しは廃止し、新規ゲストは Terraform の LXC ([`../../terraform/`](../../terraform/)) で払い出す方針へ移行した。

## 実機の破棄手順

安全網を取ってから purge する。

```sh
vzdump 300 --storage local --mode stop
qm destroy 300 --purge 1 --destroy-unreferenced-disks 1
```
