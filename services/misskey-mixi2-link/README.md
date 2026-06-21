# misskey-mixi2-link 構成 (Misskey ⇔ mixi2 投稿ブリッジ)

see also [../../cluster/README.md](../../cluster/README.md) / [../misskey/README.md](../misskey/README.md)

[README](../../cluster/README.md) で説明したクラスタ FYNSV 上の Misskey ([../misskey/README.md](../misskey/README.md)) と
[mixi2](https://mixi.social) の間で投稿を相互コピーするブリッジを 1 LXC で動かす。
本体は [famisics/misskey-mixi2-link](https://github.com/famisics/misskey-mixi2-link) (TypeScript / [Bun](https://bun.sh))。

## 動作仕様

- **Misskey → mixi2**: 本人アカウントの公開ノートを mixi2 の bot アカウントが自動転載する。
- **mixi2 → Misskey**: mixi2 で投稿に bot をメンションしたものだけ、メンションを除去して Misskey の専用 bot アカウントに転載する。
  (mixi2 公式 Application API にはユーザーの投稿一覧取得がなく、イベントも bot 宛てのみのため、規約準拠で実現できるのはメンション方式)

| 条件 | 扱い |
| --- | --- |
| リプライ / リノート・引用 | 転送しない |
| 公開範囲が public 以外 / CW 付き | 転送しない |
| 149 文字超 (mixi2 上限) | 切り詰めて元ノートの URL を付与 |
| 画像 | 転送する (ダウンロード → 再アップロード)。動画は対象外 |

ループ防止は構造的に成立する: Misskey 側は本人のノートのみ拾い、転載先は別の bot アカウント。mixi2 側は bot へのメンションのみ拾い、転載は bot 自身の投稿。加えて SQLite の処理済み記録が再起動・再配信時の二重転送を防ぐ。

## アーキテクチャ

```
                FYNSV LAN (192.168.2.0/24)
┌────────────────────────┐      ┌───────────────────────────────────┐
│ misskey-web (210)      │◀─WS──│ LXC: misskey-mixi2-link (216)     │
│ Misskey :3000 (http)   │◀REST─│  bridge (Bun, systemd)            │
└────────────────────────┘      │   ├ misskey watcher (streaming)   │──▶ mixi2 Application API
                                │   ├ mixi2 watcher (gRPC stream)   │    (gRPC, outbound のみ)
                                │   ├ 変換 / フィルタ                │
                                │   └ SQLite (処理済み ID 記録)      │
                                └───────────────────────────────────┘
```

全接続がアウトバウンド (Misskey へは LAN 内 WebSocket/REST、mixi2 へは gRPC ストリーミング)。
**inbound ポート開放も cloudflared も不要**で、公開面はゼロ。

## LXC 構成

Debian LXC 1 台 (unprivileged)。Docker は使わないため nesting は実質不要だが、既定 (nesting=1) のまま。リソース割り当て (ノード / IP / cores / RAM / rootfs) は [`../../terraform/`](../../terraform/) を正とする。

| VMID | ホスト名             | 役割                    | TF リソース ([containers.tf](../../terraform/containers.tf)) |
| ---- | -------------------- | ----------------------- | ----------------------------------------------------------- |
| 216  | `misskey-mixi2-link` | ブリッジ (Bun + SQLite) | `module.lxc["misskey-mixi2-link"]`                          |

## 前提

- Misskey に転載先の **bot アカウント**を作成済みで、API トークンを 2 本発行できる
  - 本人アカウント: ストリーミング購読・ノート読み取り用
  - bot アカウント: `write:notes` / `write:drive`
- [mixi2 Developer Platform](https://developer.mixi.social/) の利用申請が済み、bot の `client_id` / `client_secret` を取得済み
- 上記トークン・クレデンシャルはすべて 1Password 管理 (リポジトリ・ゲストには `.env` 以外に置かない)
- LXC への root アクセスは Proxmox ノード経由 (`ssh pve02` → `pct enter 216`。SSH 鍵は投入しない)
- famisics/misskey-mixi2-link は **private リポジトリ**。LXC からの clone は read-only の deploy key で行う (§3.1 で LXC 上に生成して登録する)

以降、コマンドは見出しの「実行場所」に従う。

## 1. LXC を払い出す (Terraform)

### 実行場所: 手元 (Mac)

宣言は [`../../terraform/containers.tf`](../../terraform/containers.tf) の `local.containers`。
デフォルト (2 vCPU / 2 GiB / 16 GB) のまま、静的 IP と VMID だけ指定する。

```sh
cd projects/fynsv/terraform
terraform plan      # 差分が module.lxc["misskey-mixi2-link"] のみであることを確認
terraform apply
terraform output lxc_ipv4          # {"misskey-mixi2-link":{"eth0":"192.168.2.207"}}
ssh pve02 pct exec 216 -- hostname # ノード経由で疎通確認
```

## 2. アカウントとトークンの準備

### 実行場所: Misskey Web UI

1. bot 用アカウントを作成し、プロフィールで「Bot として設定」を有効にする。
2. **設定 > API > アクセストークンの発行**で 2 本発行し、1Password に保存する。
   - 本人アカウント: 既定の読み取り権限のみ
   - bot アカウント: `ノートを作成・削除する` / `ドライブを操作する`
3. 本人アカウントのユーザー ID を控える (設定画面、または `https://misskey.example.com/api/users/show` で確認)。

### 実行場所: mixi2 Developer Platform

1. bot アプリケーションの `client_id` / `client_secret` を 1Password に保存する。
2. bot のスクリーンネームと本人のスクリーンネーム (どちらも `@` なし) を控える。

## 3. ブリッジを構築

### 実行場所: misskey-mixi2-link (`pct enter 216` from pve02)

#### 3.1 Bun とアプリ配置

```sh
apt update && apt -y upgrade
apt -y install curl git unzip
curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash

useradd --system --create-home --shell /usr/sbin/nologin bridge

# private リポジトリ用の deploy key を bridge ユーザーに生成
sudo -u bridge -H ssh-keygen -t ed25519 -N '' \
  -f /home/bridge/.ssh/id_ed25519 -C misskey-mixi2-link-deploy
cat /home/bridge/.ssh/id_ed25519.pub
```

表示された公開鍵を **read-only deploy key** として登録する (手元 Mac から):

```sh
gh repo deploy-key add <(echo "<上の公開鍵>") --repo famisics/misskey-mixi2-link --title lxc-216
```

続けて LXC 上で clone とビルド:

```sh
mkdir -p /opt/misskey-mixi2-link && chown bridge:bridge /opt/misskey-mixi2-link
sudo -u bridge -H bash -lc '
  git clone git@github.com:famisics/misskey-mixi2-link.git /opt/misskey-mixi2-link
  cd /opt/misskey-mixi2-link
  bun install --frozen-lockfile
'
```

#### 3.2 `.env` (パーミッション 600、値は 1Password 管理)

```sh
# /opt/misskey-mixi2-link/.env
MISSKEY_ORIGIN=http://192.168.2.203:3000
MISSKEY_PUBLIC_ORIGIN=https://misskey.example.com
MISSKEY_USER_ID=change-me            # 本人アカウントのユーザー ID
MISSKEY_USER_TOKEN=change-me         # 本人アカウントのトークン (読み取り)
MISSKEY_BOT_TOKEN=change-me          # bot アカウントのトークン (write:notes, write:drive)
MIXI2_CLIENT_ID=change-me
MIXI2_CLIENT_SECRET=change-me
MIXI2_BOT_NAME=change-me             # bot のスクリーンネーム (@ なし)
MIXI2_OWNER_NAME=change-me           # 本人のスクリーンネーム (@ なし、メンション元の検証用)
DB_PATH=/var/lib/misskey-mixi2-link/state.db
```

```sh
chown bridge:bridge /opt/misskey-mixi2-link/.env
chmod 600 /opt/misskey-mixi2-link/.env
```

#### 3.3 systemd unit

```sh
tee /etc/systemd/system/misskey-mixi2-link.service >/dev/null <<'EOF'
[Unit]
Description=Misskey <-> mixi2 bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=bridge
Group=bridge
WorkingDirectory=/opt/misskey-mixi2-link
EnvironmentFile=/opt/misskey-mixi2-link/.env
ExecStart=/usr/local/bin/bun src/index.ts
Restart=always
RestartSec=5
StateDirectory=misskey-mixi2-link
StandardOutput=journal
StandardError=journal
SyslogIdentifier=misskey-mixi2-link

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now misskey-mixi2-link
journalctl -u misskey-mixi2-link -f
```

## 4. 検証

1. Misskey にテキストノートを投稿 → mixi2 の bot アカウントに同文が出る
2. 150 文字超のノート → 切り詰め + 元ノート URL 付きで出る
3. 画像付きノート → 画像ごと転載される
4. リプライ / リノート / フォロワー限定 / CW 付き → **転載されない**
5. mixi2 で bot をメンションして投稿 (テキスト / 画像) → Misskey の bot アカウントにメンション除去済みで出る
6. `systemctl restart misskey-mixi2-link` 直後に直前の投稿が**二重転載されない** (SQLite 記録)
7. サービス停止中に Misskey へ投稿 → 起動後にバックフィルで転載される

## 5. 運用メモ

### バックアップ

| 対象 | 頻度 | 方法 |
| --- | --- | --- |
| LXC 216 | 週次 | vzdump。SQLite (`/var/lib/misskey-mixi2-link/`) は処理済み記録のみで、消えても再転送が数件出るだけで致命ではない |

### 更新

```sh
sudo -u bridge -H bash -lc 'cd /opt/misskey-mixi2-link && git pull && bun install --frozen-lockfile'
systemctl restart misskey-mixi2-link
```

Bun は `bun upgrade`、OS は `unattended-upgrades` か `apt -y upgrade` の定期実行。

### 障害切り分けの第一手

| 症状 | 最初に見る場所 |
| --- | --- |
| どちらの方向も転載されない | `journalctl -u misskey-mixi2-link -n 50 --no-pager` |
| Misskey → mixi2 だけ止まる | misskey-web (`192.168.2.203:3000`) の死活、mixi2 API 障害 (トークン取得エラーのログ) |
| mixi2 → Misskey だけ止まる | gRPC ストリーム再接続ログ、Misskey bot トークンの失効 |
| 同じ投稿が二重に出る | SQLite 消失 (vzdump リストア直後など)。仕様上 at-least-once のため稀に発生しうる |
