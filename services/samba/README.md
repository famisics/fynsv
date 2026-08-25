# samba

シンプルな LAN 向けファイル共有。VMID / IP / リソース量は `terraform/containers.tf` の `samba` エントリが正。

## 構築

Debian 13 標準リポジトリの Samba をネイティブインストールしている。

```bash
apt-get install -y samba
```

`samba` パッケージは推奨パッケージとして `samba-ad-dc` (AD ドメインコントローラ) も有効化するが、単純なファイル共有には不要かつ `smbd`/`nmbd` と役割が競合するため無効化・マスクしている。

```bash
systemctl disable --now samba-ad-dc
systemctl mask samba-ad-dc
```

- ユーザー認証方式 (ゲストアクセスなし)
- OS ユーザー `famisics` (sudo 付与済み) を Samba ユーザーとしても登録: `smbpasswd -a famisics`
- 共有ディレクトリ `/srv/samba/share` を新規作成し `famisics:famisics` / `2770` で所有

`/etc/samba/smb.conf` に追記した共有定義:

```conf
[share]
   comment = shared folder
   path = /srv/samba/share
   browseable = yes
   read only = no
   guest ok = no
   valid users = famisics
   create mask = 0660
   directory mask = 2770
```

## 接続情報

- **サーバー**: `192.168.2.214` (`terraform/containers.tf` の IP を参照)
- **共有名**: `share`
- **認証**: `famisics` / パスワードは運用者に確認すること

### Windows

エクスプローラーのアドレスバーに入力:

```
\\192.168.2.214\share
```

### macOS

Finder → 移動 → サーバへ接続 (⌘K):

```
smb://192.168.2.214/share
```

### Linux

```sh
smbclient //192.168.2.214/share -U famisics
# または
sudo mount -t cifs //192.168.2.214/share /mnt/share -o username=famisics
```

同一 LAN (`192.168.2.0/24`) からのみアクセス可能。外部公開は行っていない (Tailscale 代理公開が必要なら `services/README.md` の Tips を参照)。
