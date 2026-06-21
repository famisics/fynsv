# 基盤 (テンプレート配布 / クラスタ参照 / ユーザー管理)。通常編集不要 — 実体は modules/base/。

module "base" {
  source               = "./modules/base"
  manage_cluster_users = var.manage_cluster_users
}
