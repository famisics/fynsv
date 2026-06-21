# Proxmox VE クラスター IP 移行 / 復旧ガイド

3 ノード PVE クラスター (`pve01` / `pve02` / `pve03`) を **LAN1 (`192.168.1.0/24`) から LAN2 (`192.168.2.0/24`)** へ移行する手順。

> **本ガイドは「物理配線を SW2 (router2 配下) に切替え済みで、クラスターが既にクォーラム喪失している状態」を前提とする復旧手順**。
>
> クォーラム喪失中の PVE では `pmxcfs` が **`/etc/pve/` を read-only にマウント**するため、`/etc/pve/corosync.conf` を直接書き換える通常手順は使えない。本ガイドでは pmxcfs を経由せず、各ノードの **実体ファイル `/etc/corosync/corosync.conf` を直接編集する方式** を採る。

## 移行先 IP プラン

DHCP プール (`.100-.200`) と衝突しない `.11`-`.13` を使用。

| ノード | 旧 IP (LAN1) | 新 IP (LAN2) |
|---|---|---|
| pve01 | `192.168.1.109` | `192.168.2.11` |
| pve02 | `192.168.1.112` | `192.168.2.12` |
| pve03 | `192.168.1.114` | `192.168.2.13` |
| Gateway | `192.168.1.1` | `192.168.2.1` |

## 編集対象ファイル

各ノードでローカル編集が必要なものと、クラスター全体で同期されるものを区別する。本ガイドでは **pmxcfs 経由のファイル (`/etc/pve/...`) は触らず**、各ノードのローカル実体ファイルを直接編集する。

| ファイル | 役割 | 編集場所 | 本作業で触るか |
|---|---|---|---|
| `/etc/network/interfaces` | ノード自身の IP/GW | 各ノードでローカル | ✅ 全ノード |
| `/etc/hosts` | ホスト名↔IP 解決 | 各ノードでローカル (3 ノード同一内容) | ✅ 全ノード |
| `/etc/corosync/corosync.conf` | クラスター通信用ノード IP (実体ファイル) | 各ノードでローカル (3 ノード同一内容) | ✅ 全ノード |
| `/etc/pve/corosync.conf` | 上記の pmxcfs 同期ビュー | 通常時はここを編集する | ❌ read-only のため触らない |
| `/etc/pve/storage.cfg` | ストレージ定義 | pmxcfs 経由 | ❌ 該当する場合のみ、復旧後 |
| `/etc/pve/ceph.conf` / `/etc/ceph/ceph.conf` | Ceph 設定 (mon_host / public_network 等) | pmxcfs 経由 | ✅ Ceph 使用時、PVE クラスター復旧後 |
| 各 mon の monmap (バイナリ) | mon が知っている mon の IP リスト | 各 mon ノード | ✅ Ceph 使用時、ceph.conf 更新だけでは不足 |

## 復旧手順

### Step 0: 現状診断 (各ノード)

3 ノード全部のコンソールに入って、それぞれの状態を確認する。**ノードによって状態がまちまちな可能性がある**ので、必ず 3 台分把握すること。

```sh
# クォーラム状態 (おそらく "Quorum: No quorum" 等が表示される)
pvecm status

# 自ノードの IP / ルーティング (旧 IP のままか、新 IP に切替済みか)
ip -4 -br a
ip route

# 既存の corosync 設定 (旧 IP のままのはず)
cat /etc/corosync/corosync.conf

# 既存の hosts
cat /etc/hosts

# 既存の interfaces
cat /etc/network/interfaces

# pmxcfs / corosync サービス状態
systemctl status pve-cluster corosync --no-pager | head -20

# /etc/pve が read-only か確認 (タッチして書き込めないことを見る)
touch /etc/pve/.check 2>&1
```

把握しておく情報:
- 各ノードが今どの IP を持っているか (旧/新/未設定)
- 各ノードの `/etc/corosync/corosync.conf` の内容が同一か (`md5sum /etc/corosync/corosync.conf` を 3 ノードで比較)
- `pve-cluster` / `corosync` サービスが running か failed か

### Step 1: corosync と pve-cluster を停止 (全ノード)

3 ノード全部で:

```sh
systemctl stop corosync
systemctl stop pve-cluster
```

これで `/etc/pve/` のマウントも外れ、pmxcfs 経由のファイル参照は止まる。各ノードのローカル状態だけになる。

> ここから先は VM/CT は単体ノード上で動き続ける (停止していなければ)。Web UI のクラスター系操作は不可。

### Step 2: 設定ファイルを編集 (全ノード)

3 ノードそれぞれで以下 3 ファイルを書き換える。

#### 2-A. `/etc/network/interfaces`

vmbr0 セクションの `address` と `gateway` を新 IP に。`/24` を忘れない。`bridge-ports` は元の物理 NIC 名 (`eno1` 等) のまま。

例 (pve01 の場合):
```
auto vmbr0
iface vmbr0 inet static
        address 192.168.2.11/24
        gateway 192.168.2.1
        bridge-ports eno1
        bridge-stp off
        bridge-fd 0
```

pve02 / pve03 はそれぞれ `192.168.2.12` / `192.168.2.13` に。

#### 2-B. `/etc/hosts`

3 ノードとも**全く同じ内容**に揃える。`127.0.1.1` の行は自ノードのホスト名のみそのノード固有で残す。

```
127.0.0.1 localhost
127.0.1.1 <自ノードのホスト名>

192.168.2.11 pve01.example.local pve01
192.168.2.12 pve02.example.local pve02
192.168.2.13 pve03.example.local pve03

::1 localhost ip6-localhost ip6-loopback
ff02::1 ip6-allnodes
ff02::2 ip6-allrouters
```

#### 2-C. `/etc/corosync/corosync.conf`

各 `node` ブロックの `ring0_addr` を新 IP に。**3 ノードで同一内容に揃える**。`config_version` は既存値のままで OK (オフライン状態で 3 ノード一斉に書き換えるため、バージョン整合は気にしなくてよい)。

```
totem {
    cluster_name: <既存のまま>
    config_version: <既存値のまま>
    interface {
        linknumber: 0
    }
    ip_version: ipv4
    secauth: on
    version: 2
}

nodelist {
    node {
        name: pve01
        nodeid: 1
        quorum_votes: 1
        ring0_addr: 192.168.2.11
    }
    node {
        name: pve02
        nodeid: 2
        quorum_votes: 1
        ring0_addr: 192.168.2.12
    }
    node {
        name: pve03
        nodeid: 3
        quorum_votes: 1
        ring0_addr: 192.168.2.13
    }
}

quorum {
    provider: corosync_votequorum
}

logging {
    to_syslog: yes
    debug: off
}
```

`cluster_name` / `nodeid` / `quorum_votes` / `config_version` 等は既存ファイルの値を継承する。書き換えるのは `ring0_addr` のみ。

#### 2-D. 整合性チェック

3 ノードで `/etc/hosts` と `/etc/corosync/corosync.conf` の内容が完全一致しているか確認:

```sh
# 各ノードでハッシュを取って比較
md5sum /etc/hosts /etc/corosync/corosync.conf
```

3 ノードで両ファイルの md5 が一致すること。

### Step 3: ネットワークを反映 (全ノード)

各ノードで:

```sh
systemctl restart networking
# または
ifreload -a
```

直後に自ノードの IP を確認:

```sh
ip -4 -br a
ip route
```

`vmbr0` に新 IP が乗り、`default via 192.168.2.1` になっていること。

### Step 4: 3 ノード相互の疎通確認

各ノードで:

```sh
ping -c 2 192.168.2.1     # router2 GW
ping -c 2 192.168.2.11    # pve01
ping -c 2 192.168.2.12    # pve02
ping -c 2 192.168.2.13    # pve03
ping -c 2 8.8.8.8         # 外部
```

**3 ノード相互に ping が通ることが Step 5 の前提条件**。1 つでも届かないノードがあれば、そのノードの `interfaces` 設定や物理配線・SW2 のポートを再確認する。

### Step 5: クラスターサービスを起動 (全ノード)

3 ノードで:

```sh
systemctl start pve-cluster
sleep 5
systemctl start corosync
```

`pve-cluster` を先に起動して pmxcfs マウントを復旧させ、続いて `corosync`。

### Step 6: クォーラム回復確認

任意の 1 ノードで:

```sh
pvecm status
pvecm nodes
```

期待値:
- `Quorate: Yes`
- `Total votes: 3`
- 3 ノードとも `online` (`pvecm nodes` で `A`/`NR` フラグなし)
- 各ノードのアドレスが新 IP (`192.168.2.x`) で表示されている

`/etc/pve/` も再び書き込み可能になっているはず:

```sh
touch /etc/pve/.check && rm /etc/pve/.check
```

エラーが出なければ pmxcfs は通常モードに戻っている。

### Step 7: pmxcfs 経由の corosync.conf も同期されていることを確認

```sh
diff /etc/corosync/corosync.conf /etc/pve/corosync.conf
```

差分があれば pmxcfs 側 (`/etc/pve/corosync.conf`) を実体ファイルの内容で上書き。クォーラムが回復していれば書き込み可:

```sh
cp /etc/corosync/corosync.conf /etc/pve/corosync.conf
```

これで以降の corosync.conf 編集は通常通り `/etc/pve/corosync.conf` 経由で全ノード同期できる状態に戻る。

## Ceph 移行 (Step 8)

PVE クラスター本体 (Step 1-7) が回復しても **Ceph は別クラスターなので個別に IP 移行が必要**。Ceph は IP 情報を **3 箇所** に持っていて、すべて揃えないと中途半端に壊れる:

1. **`/etc/pve/ceph.conf`** (テキスト): 起動時に各デーモンが読む
2. **各 mon の `monmap`** (バイナリ): mon 同士が peer を見つけるための情報
3. **`ceph config` (mon DB)**: ヘルスチェックや CLI が参照する中央設定

`public_network` / `cluster_network` は **runtime 変更不可** (`ceph tell ... config set` が `EPERM` で拒否される)。値の更新には **mon 再起動が必須**。

### 8-A. ceph.conf の更新 (任意の 1 ノードで)

更新すべき行は **計 6 行**。`[mon.pveXX] public_addr` だけ直して `[global]` の 3 行を取りこぼすと OSD が起動しない。

```ini
[global]
    mon_host        = 192.168.2.11 192.168.2.12 192.168.2.13
    public_network  = 192.168.2.0/24
    cluster_network = 192.168.2.0/24

[mon.pve01]
    public_addr = 192.168.2.11
[mon.pve02]
    public_addr = 192.168.2.12
[mon.pve03]
    public_addr = 192.168.2.13
```

`*_network` の値は **`192.168.2.0/24` のようなネットワークアドレスで書く**こと。`192.168.2.11/24` のようにホスト IP+/24 で書いても Ceph は内部で /24 ネットに丸めるので動くが、`192.168.2.11` (prefix 抜き) は `/32` 解釈になり pve02/pve03 で OSD が弾かれる。

sed で安全に置換:

```sh
sed -i -E \
  -e 's|^([[:space:]]*)mon_host[[:space:]]*=.*|\1mon_host = 192.168.2.11 192.168.2.12 192.168.2.13|' \
  -e 's|^([[:space:]]*)public_network[[:space:]]*=.*|\1public_network = 192.168.2.0/24|' \
  -e 's|^([[:space:]]*)cluster_network[[:space:]]*=.*|\1cluster_network = 192.168.2.0/24|' \
  /etc/pve/ceph.conf

grep -E "mon_host|public_network|cluster_network|public_addr" /etc/pve/ceph.conf
```

`/etc/ceph/ceph.conf` は `/etc/pve/ceph.conf` へのシンボリックリンクのはず (`ls -l /etc/ceph/ceph.conf`)。

### 8-B. monmap の書き換え (各 mon ノード)

`ceph.conf` を直しただけでは mon は **monmap (バイナリ)** に書かれた旧 IP で peer を探し続け、quorum を組めない。**全 mon を停止 → monmap をオフラインで書き換え → mon を起動**。

```sh
# 1. 全 mon 停止 (3 ノードそれぞれ)
systemctl stop ceph-mon@$(hostname)

# 注意: mon が動いている間は store.db がロックされ extract が失敗する
#   → "rocksdb: IO error: ... LOCK: Resource temporarily unavailable"
#   その場合 systemctl stop が効いていないので fuser や pkill で確実に止める
```

任意の 1 ノードで:

```sh
ceph-mon -i $(hostname) --extract-monmap /tmp/monmap
monmaptool --print /tmp/monmap                # 旧 IP を確認

monmaptool --rm pve01 /tmp/monmap
monmaptool --rm pve02 /tmp/monmap
monmaptool --rm pve03 /tmp/monmap

monmaptool --addv pve01 '[v2:192.168.2.11:3300/0,v1:192.168.2.11:6789/0]' /tmp/monmap
monmaptool --addv pve02 '[v2:192.168.2.12:3300/0,v1:192.168.2.12:6789/0]' /tmp/monmap
monmaptool --addv pve03 '[v2:192.168.2.13:3300/0,v1:192.168.2.13:6789/0]' /tmp/monmap

monmaptool --print /tmp/monmap                # 新 IP を確認
```

他 2 ノードに配布して全ノードで inject:

```sh
# 1 ノードで
scp /tmp/monmap root@192.168.2.12:/tmp/monmap
scp /tmp/monmap root@192.168.2.13:/tmp/monmap

# 各ノードで (scp は inject ではない、忘れず注入する)
ceph-mon -i $(hostname) --inject-monmap /tmp/monmap

# 各ノードで mon 起動
systemctl start ceph-mon@$(hostname)
```

確認:

```sh
ceph daemon mon.$(hostname) mon_status | grep -E '"state"|"quorum"'
# state: leader/peon, quorum: [0,1,2] になれば OK
```

### 8-C. ceph.conf の mon_host が CLI まで届くように

mon が quorum を組んでも、**CLI (`ceph -s`) は `/etc/ceph/ceph.conf` の `mon_host` を見て** 接続するため、ここが旧 IP のままだと「クラスターは健康だが CLI からアクセス不能」状態になる。8-A の sed で `mon_host` も更新済みのはず。確認:

```sh
ceph -s                                       # 即応答するか
grep mon_host /etc/pve/ceph.conf              # 新 IP か
ls -l /etc/ceph/ceph.conf                     # /etc/pve/ceph.conf へのシンボリックリンクか
```

### 8-D. mon の runtime config を新 public_network に揃える ★最大の落とし穴

mon は **起動時の `ceph.conf` の値をメモリに保持** する。8-A で `ceph.conf` を直しても、その時点で動いていた mon は旧 `public_network` を持ち続け、ヘルスチェックで:

```
HEALTH_ERR: 3 osds(s) are not reachable
  osd.X's public address is not in '192.168.1.0/24' subnet
```

を出し続ける。確認:

```sh
ceph daemon mon.pve01 config get public_network
# 旧値が出たら 8-D の作業が必要
```

`public_network` は runtime 変更不可なので **mon ローリング再起動が唯一の手段**:

```sh
# 1 ノードずつ。再起動中も他 2 mon でクォーラム維持される
systemctl restart ceph-mon@pve01 && sleep 10 && ceph -s    # quorum 復活確認
systemctl restart ceph-mon@pve02 && sleep 10 && ceph -s
systemctl restart ceph-mon@pve03 && sleep 10 && ceph -s

# 全ノードで新値になったか確認
for h in pve01 pve02 pve03; do
  ssh root@$h "ceph daemon mon.$h config get public_network"
done
```

### 8-E. ceph config (mon DB) も同期

`ceph config dump` で参照される中央設定 DB にも `public_network` / `cluster_network` を入れる。これは将来 daemon が再起動した際の追加保険:

```sh
ceph config set global public_network  192.168.2.0/24
ceph config set global cluster_network 192.168.2.0/24
ceph config dump | grep network          # global advanced で 2 行出ることを確認
```

`osd` / `osd.X` / `mon` 階層に旧値が残っていたら削除:

```sh
ceph config dump | grep -i network       # global 以外に残骸がないか
# 残っていたら ceph config rm <who> public_network ...
```

### 8-F. mgr / OSD / MDS を起動

mon が新値で揃ったら、その他のデーモンも再起動して新しい `mon_host` を読み込ませる:

```sh
# 各ノードで
systemctl restart ceph-mgr.target
systemctl restart ceph-osd.target
systemctl restart ceph-mds.target 2>/dev/null || true
```

OSD が `failed to fetch mon config` で 5 分待ちのループに入って起動しないときは、**`public_network` の不一致** が真因なことが多い。foreground 起動で即時に真因が出る:

```sh
ceph-osd -f --cluster ceph --id <id> --setuser ceph --setgroup ceph --debug-monc 10 --debug-ms 1 2>&1 | head -50
# → "unable to find any IPv4 address in networks '192.168.X.X/24'" のような行が原因を示す
```

### 8-G. 最終確認

```sh
ceph -s
ceph health detail
ceph osd tree                            # 全 OSD up/in
ceph mgr stat                            # active mgr あり
ceph mon stat                            # 3 mon quorum
ceph fs status                           # CephFS 使用時

# ヘルスキャッシュが古いままなら mgr を fail させて再評価
ceph mgr fail $(ceph mgr stat -f json | python3 -c "import json,sys;print(json.load(sys.stdin)['active_name'])")
```

`HEALTH_OK` または `HEALTH_WARN: ... recovering` (PG 同期中) なら成功。`Slow OSD heartbeats` の警告は IP 切替前後の古い計測値がキャッシュされているだけで、数分で自動消滅する。

### 8-H. ハマりどころサマリ

| 症状 | 真因 | 対処 |
|---|---|---|
| `ceph -s` がタイムアウト | `/etc/pve/ceph.conf` の `mon_host` が旧 IP | 8-A を再確認 |
| mon が `probing` から抜けない | monmap が旧 IP のまま | 8-B (mon 停止 → monmap 書換 → 注入 → 起動) |
| `extract-monmap` が `LOCK: Resource temporarily unavailable` | mon が動いている | `systemctl stop` を確実に。`fuser /var/lib/ceph/mon/ceph-X/store.db/LOCK` で残存プロセス確認 |
| OSD が `failed to fetch mon config` で 5 分後死亡 | `public_network` が旧値で、新 IP の NIC を見つけられない | 8-A の `public_network` 更新 + foreground で確認 |
| `HEALTH_ERR: ... not reachable` がいつまでも消えない | mon の runtime `public_network` が旧値 | **8-D: mon ローリング再起動** (`ceph tell` は EPERM で拒否される) |
| `33.333% degraded` がしばらく続く | OSD 復帰後の PG 再同期 (正常) | 待つだけ。急ぐなら `osd_max_backfills` / `osd_recovery_max_active` を一時的に上げる |
| `Slow OSD heartbeats: 10000ms` | IP 切替時の古い計測値キャッシュ | 数分待てば自動消滅 |

### 8-I. クライアント側 (RBD / CephFS) の確認

クラスター外で Ceph を使うクライアント (kernel RBD, libceph, ceph-fuse) があれば `mon_host` 指定を新 IP に更新。Proxmox の `pveceph` ストレージ定義は `monhost` を参照する:

```sh
grep -A 5 -E "rbd|cephfs" /etc/pve/storage.cfg
```

`monhost` 行に旧 IP が残っていれば編集 (pmxcfs 経由で全ノード同期)。

## クラスター外: SSH config の更新

ローカル `~/.ssh/config` の `pveXX-local` の `HostName` を新 IP に書き換える:

```diff
 Host pve01-local
-  HostName 192.168.1.109
+  HostName 192.168.2.11
   User root

 Host pve02-local
-  HostName 192.168.1.112
+  HostName 192.168.2.12

 Host pve03-local
-  HostName 192.168.1.114
+  HostName 192.168.2.13
```

Tailscale は IP が変わっても自動再接続するので追加対応不要。`pveXX` (Tailscale 名指定) と `pveXX-local` (LAN2 直接) の両方でアクセス確認:

```sh
ssh pve01 'hostname && ip -4 -br a'
ssh pve01-local 'hostname && ip -4 -br a'
```

## トラブルシュート

### Step 6 でクォーラムが揃わない

```sh
# 各ノードで corosync ログを確認
journalctl -u corosync -n 50 --no-pager
journalctl -u pve-cluster -n 50 --no-pager

# corosync 自体の状態
corosync-cfgtool -s
corosync-quorumtool -ls
```

主な原因と対処:

| 症状 | 原因 | 対処 |
|---|---|---|
| 1 ノードだけ Offline | 該当ノードの `interfaces` 設定誤り、物理リンク不良 | 該当ノードで `ip -4 -br a` / `ethtool eno1` 確認 |
| 全ノード Offline 扱い | `/etc/corosync/corosync.conf` の内容が 3 ノードで不一致 | `md5sum /etc/corosync/corosync.conf` を比較、最も正しいノードから他にコピー |
| `link 0 down` ログ | UDP 5405 の通信が届かない | `omping -c 10 192.168.2.11 192.168.2.12 192.168.2.13` で疎通テスト |
| `Totem is unable to form a cluster` | 全ノードで corosync が起動はしているが互いに見えない | ファイアウォール (`iptables -L -n`) と物理配線確認 |

### `/etc/pve/` が read-only のまま (Step 6 後)

クォーラム回復していないということ。`pvecm status` を見て Offline ノードを特定し、そちらを直す。

応急処置として 1 ノードだけ強制復旧したい場合は、本ガイドのこの後の節「単独ノードの強制復旧」を参照。

### 単独ノードの強制復旧 (最終手段)

3 ノード中 2 ノードが死んでいて 1 ノードだけ動かしたい場合 (= 本来クォーラム不足):

```sh
# 自ノードだけで quorum を 1 として強制起動
pvecm expected 1
```

これで残り 1 ノードでも `/etc/pve/` が書き込み可能になる。ただし **他ノードを後から戻す際にスプリットブレインリスクがある**ので、応急処置のみ。残り 2 ノードを復旧させ次第、`pvecm expected 3` で戻す。

### `pmxcfs` が壊れた場合 (FATAL: Unable to mount)

`pve-cluster` が起動しないケース。データベースが壊れていると以下で再構築:

```sh
systemctl stop pve-cluster
pmxcfs -l                    # ローカルモードで起動 → /etc/pve 書き込み可
# 問題のファイルを修復
killall pmxcfs
systemctl start pve-cluster
```

詳細は PVE Wiki の "Recovery" 節参照。

### ロールバック (旧 LAN1 に戻す)

物理配線を SW1 側に戻し、Step 2 で書き換えた 3 ファイルを旧値に戻して Step 1-6 を再実行。

## 移行後の付随作業

- [ ] `~/.ssh/config` の `pveXX-local` の `HostName` を新 IP に更新
- [ ] `projects/fynsv/docs/network-diagram.drawio` の v2 と現状を再確認
- [ ] `projects/fynsv/docs/README.md` の TODO を更新 (LAN2 移行完了を反映)
- [ ] PVE Web UI の Datacenter → クラスタータブで全ノード Online を確認
- [ ] `ceph -s` で `HEALTH_OK` を確認 (Ceph 使用時)
- [ ] `/etc/pve/storage.cfg` の RBD/CephFS の `monhost` を新 IP に更新済みか確認
- [ ] バックアップジョブ・レプリケーションタスクが新 IP 前提で動くか確認
- [ ] 必要なら `pvecm updatecerts` でノード証明書を再生成 (ホスト名変更時)

## 参考

- PVE 公式 Wiki: [Cluster Manager](https://pve.proxmox.com/wiki/Cluster_Manager)
- PVE 公式 Wiki: [Separate Cluster Network](https://pve.proxmox.com/wiki/Separate_Cluster_Network)
- `man pmxcfs` (`pmxcfs -l` のローカルモードについて)
