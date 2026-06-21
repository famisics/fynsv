# IPv6 DNS 設定計画

LAN1 (192.168.1.0/24) クライアントに対し、IPv6 トランスポートで利用可能な DNS サーバーを RA 経由で広告する計画。現状 IPv6 接続自体は機能しているが、リゾルバ設定が IPv4 のみのため、IPv6 名前解決経路に冗長性が無い。

## 背景

### 現状

`scutil --dns` での Mac (LAN1 クライアント) のリゾルバ:

```
resolver #2
  nameserver[0] : 8.8.8.8
  nameserver[1] : 8.8.4.4
  if_index : 14 (en0)
  flags    : Request A records, Request AAAA records
```

- en0 のリゾルバは IPv4 アドレスのみ
- 出所は `router1` の `ip dhcp profile lan` 内 `dns-server 8.8.8.8 8.8.4.4` (`networksetup -getdnsservers Wi-Fi` は未設定なので OS / プロファイル経由ではない)
- `router1` GE2.0 では `ipv6 nd ra enable` で LAN1 へ RA を能動送出しているが、**RDNSS オプションは含まれていない**

### 動作確認結果

| 項目 | 結果 |
|---|---|
| IPv6 グローバル疎通 (`ping6 google.com`) | OK (RTT 27 ms) |
| AAAA レコード解決 (`dig AAAA google.com`) | OK |
| HTTPS over IPv6 (`curl -6 https://www.google.com`) | OK (200) |
| IPv6 DNS サーバーへの問い合わせ (`dig @2001:4860:4860::8888 ...`) | OK |
| 自動設定された IPv6 リゾルバの存在 | **無し** |

IPv6 経路と IPv6 DNS サーバー自体は使えるが、ルーターが広告していないためクライアントが自動で拾えない状態。

### 影響

- 平常時は影響なし (IPv4 経路でリゾルバに到達できるため)
- IPv4 経路が断絶した場合 (例えば内部のスタブリゾルバ障害、特定の IPv4 to-DNS フィルタ等) に IPv6 単独での名前解決ができない
- BIGLOBE プレフィックス変更時にプロキシ DNS 経由で挙動を観測したいケース等、IPv6 トランスポートで解決したい場面で都度手動指定が必要

## 目標

| # | 内容 |
|---|---|
| G1 | LAN1 クライアントが RA から IPv6 DNS サーバーを自動取得すること |
| G2 | macOS / Linux / Windows のいずれでも `scutil --dns` 相当でリゾルバに IPv6 アドレスが現れること |
| G3 | クライアントが IPv6 トランスポートで名前解決可能なこと (`dscacheutil` 等で AAAA / A 双方が引けること) |
| G4 | 既存の IPv4 DNS 配布 (DHCP `dns-server 8.8.8.8 8.8.4.4`) は維持すること |
| G5 | ND Proxy 構成 (GE1.0 ↔ GE2.0) を壊さないこと |

## 設計概要

### 配布方式の選択

LAN1 クライアントへ IPv6 DNS を渡す方式は 3 通り:

| 方式 | 概要 | 採否 |
|---|---|---|
| **RA RDNSS (RFC 8106)** | RA メッセージに DNS サーバーアドレスを載せる | **採用** |
| ステートレス DHCPv6 | RA で `O` フラグを立て、クライアントが DHCPv6 で DNS を取得 | 不採用 |
| プロビジョニング配布 (構成プロファイル等) | 端末側で個別に IPv6 DNS を設定 | 不採用 |

採用理由:

- 既存 RA 送出基盤 (`ipv6 nd ra enable`) にオプション追加するだけで完結
- DHCPv6 サーバープロセスを GE2.0 で立ち上げないため、ND Proxy で透過させている上流 BNG の DHCPv6 動作と競合しない
- macOS / iOS / Android / Windows / 主要 Linux ディストリビューションは RDNSS をサポート

### DNS サーバーアドレスの選択

既存 IPv4 DHCP プロファイルが Google Public DNS (`8.8.8.8` / `8.8.4.4`) を配っているため、IPv6 側も同サービスで揃える。

| 配布項目 | アドレス |
|---|---|
| Primary | `2001:4860:4860::8888` |
| Secondary | `2001:4860:4860::8844` |

### 適用対象インターフェース

| ルーター | インターフェース | 適用 |
|---|---|---|
| router1 | GigaEthernet2.0 (LAN1) | **対象** |
| router1 | GigaEthernet1.0 (WAN, ND Proxy 上流) | 対象外 (RA は送出していない) |
| router2 | 全インターフェース | 対象外 (LAN2 は IPv6 未対応) |

LAN2 の IPv6 は別途方針決定が必要 (README TODO 参照)。決定までは本計画のスコープ外。

### 上流 ND Proxy への影響

GE2.0 の RA に RDNSS オプションを追加しても、ND Proxy 動作 (GE1.0 ↔ GE2.0 の NS / NA 中継) には関与しない。LAN1 クライアントから見ると、これまで上流 BNG の RA が直接届いていたところに RDNSS だけが追加された形になる。BIGLOBE BNG が将来 RDNSS を含む RA を送るようになっても、router1 が能動送出している RA に上書きされるため挙動は安定する。

## 設定差分案

NEC IX の `ipv6 nd ra dns-server` は **1 行 = DNS サーバ一覧** として扱われる単一値設定で、コマンドを 2 回投入すると後者が前者を上書きする (1 行 1 サーバの追加型ではない)。複数サーバを配布する場合は 1 行に半角スペース区切りで列挙する。

### router1 追加設定

```text
interface GigaEthernet2.0
  ipv6 nd ra dns-server 2001:4860:4860::8888 2001:4860:4860::8844
```

`lifetime` 省略時は IX のデフォルト値が適用される。RA インターバル (`MaxRtrAdvInterval`) の 3 倍程度を上限とするのが RFC 8106 の推奨。明示する場合の例:

```text
  ipv6 nd ra dns-server 2001:4860:4860::8888 2001:4860:4860::8844 lifetime 1800
```

### router2 追加設定

無し。

### AP 側設定

不要。AP は L2 ブリッジとして RA を素通しするのみで、自身では RA を生成しない。

## 段階的ロールアウト

### Phase 1: router1 へ投入

- 上記の 1 行構文で GE2.0 配下に投入
- `show running-config interface GigaEthernet2.0` で 1 行に Primary / Secondary 両方が並んでいることを確認
- `show ipv6 nd ra` 系コマンド (機種依存) で送出される RA に RDNSS が含まれることを確認

### Phase 2: クライアント側受信確認

- macOS: Wi-Fi を一旦オフ→オンで再 RA 受信、`scutil --dns` で `nameserver` に `2001:4860:4860::8888` / `::8844` 両方が現れることを確認
- 既存接続では古い RA がキャッシュされ Secondary が反映されないことがあるため、必ずインターフェースを上げ直す

### Phase 3: IPv6 トランスポートでの名前解決確認

- `dig google.com @2001:4860:4860::8888` が応答すること (Phase 3 と独立に動作することの再確認)
- IPv4 リゾルバを一時的に無効化した状態 (Mac 側で `networksetup -setdnsservers Wi-Fi` に IPv6 アドレスのみを手動指定する等) で `curl https://www.google.com` が成功すること

## 検証チェックリスト

| Phase | 項目 |
|---|---|
| 1 | `show running-config` の RDNSS 行に Primary / Secondary が 1 行で並んでいる |
| 1 | RA 送出ログ / 統計に RDNSS option 含む RA が観測される |
| 2 | macOS `scutil --dns` で en0 / en7 リゾルバに IPv6 アドレスが追加 |
| 2 | RDNSS 対応 OS (Linux `systemd-resolved`, Windows `Get-DnsClientServerAddress`) でも同様に IPv6 リゾルバが現れる |
| 3 | `dig @<広告された IPv6 DNS> example.com` が応答 |
| 3 | IPv4 リゾルバ無効状態で標準的な HTTP/HTTPS アクセスが成立 |
| 3 | 既存の IPv4 名前解決経路 (`8.8.8.8` 経由) に劣化が無い |

## 制約と対象外事項

- **LAN2 (192.168.2.0/24) は対象外**
  - LAN2 は IPv6 自体が未提供のため、IPv6 DNS 配布の前提が無い。LAN2 の IPv6 対応方針が決まった後に別計画で扱う。
- **router1 WAN 断時は IPv6 全体が利用不可**
  - ND Proxy 上流が BIGLOBE WAN のため、WAN 断時は IPv6 アドレス自体が無効化される。IPv6 DNS だけ救済する手段は無い。これは [wan-failover-plan.md](./wan-failover-plan.md) の制約と同根。
- **ルーター自身のリゾルバには影響しない**
  - 本計画で投入するのは LAN1 へ向けた RA オプション。router1 自身が IPv6 DNS で名前解決する設定 (`dns-server` グローバル設定や `name-server` 系) は対象外。
- **DHCPv6 サーバーは立てない**
  - `O` フラグ + `ipv6 dhcp server` 構成は採用しない。ND Proxy 配下での DHCPv6 サーバー / リレー併存挙動を増やしたくないため。
- **古い RDNSS 非対応クライアント**
  - 旧 Android (8.0 以前) や一部の組み込み機器は RDNSS を読まない。該当機器は IPv4 DHCP の `8.8.8.8` で名前解決を継続する形になる (実害なし)。
- **公開 DNS への外向きフロー増加**
  - 配布先の `2001:4860:4860::8888/::8844` は Google Public DNS。プライバシー / トラフィック観点でローカル / 別キャッシュ DNS (例: 自前 unbound, BIGLOBE プロキシ DNS, Cloudflare) を採用したい場合はアドレスを差し替える。

## 派生する整理対象

本計画と直接の依存は無いが、隣接する整理項目:

- LAN2 の IPv6 対応方針決定 (README TODO 既出)
- router1 自身のリゾルバ / プロキシ DNS 構成の整理 (現状 `proxy-dns` 系設定は未投入)
- IPv4 DHCP プロファイル `lan` の DNS サーバーを Google 以外へ寄せる場合は IPv6 側と整合させる
