# fynsv ネットワーク構成

自宅 LAN (fynsv) のネットワーク機器構成と設定の覚書。トポロジ図は [network-diagram.drawio](./network-diagram.drawio) 参照 (シート「ネットワーク構成図v2」が現行)。

## ハードウェア

| 役割 | 機器 | OS |
|---|---|---|
| Primary ルーター | NEC IX2215 | IX Series Software 10.11.14 |
| Secondary ルーター | NEC IX2215 | IX Series Software 10.11.14 |
| Primary 回線 | BIGLOBE 光 (PPPoE + IPoE) | — |
| Secondary 回線 | NCV (DHCP) | — |

設定ファイルは [router1.config](./router1.config) (Primary) / [router2.config](./router2.config) (Secondary) に `show running-config` 出力をそのまま保管。

## 物理接続

```
[Internet]──┬──[ONU(BIGLOBE)]──[IX2215-1 Primary]──┐
            └──[ONU(NCV)]─────[IX2215-2 Secondary]─┤
                                                    │
[IX2215-1 GE0] ──── (10.0.0.0/30 直結) ──── [IX2215-2 GE0]
```

ルーター間は `GE0 ↔ GE0` を直結 (`10.0.0.0/30`)。LAN1↔LAN2 のルーティング経路を兼ねる。

## IPv4

### サブネット

| セグメント | プレフィックス | DHCP プール | 接続機器 |
|---|---|---|---|
| LAN1 (Primary) | `192.168.1.0/24` (GW `192.168.1.1`) | `.100`–`.200` | クライアント (PC, MacBook, AP) |
| LAN2 (Secondary) | `192.168.2.0/24` (GW `192.168.2.1`) | `.100`–`.200` | Proxmox VE クラスター (ミニPC×3) |
| 直結リンク | `10.0.0.0/30` (`.1`/`.2`) | — | ルーター間 |

### ルーティング

| ルーター | 経路 | 種別 |
|---|---|---|
| router1 | `default → GigaEthernet1.1 (PPPoE)` | NAPT 抜け |
| router1 | `192.168.2.0/24 → 10.0.0.2 GigaEthernet0.0` | LAN2 への静的ルート |
| router2 | `default → GigaEthernet1.0 (NCV DHCP)` | NAPT 抜け |
| router2 | `192.168.1.0/24 → 10.0.0.1 GigaEthernet0.0` | LAN1 への静的ルート |

両ルーターで GE0.0 (`10.0.0.0/30`) には NAPT・フィルタを設定していないため、LAN1↔LAN2 は IPv4 で双方向に疎通する。

## IPv6 (Primary 系のみ)

BIGLOBE「IPv6 オプション」を契約しているが、**ONU 直結構成では BIGLOBE 側から /64 1 本しか払い出されず、DHCPv6-PD では `NoPrefixAvail` が返る**。そのため /56 を分割して LAN へ配る通常の構成が取れない。

代替として **ND Proxy** で WAN 側の /64 をそのまま LAN1 に展開している。

### 構成

| インターフェース | 役割 | 主な設定 |
|---|---|---|
| `GigaEthernet1.0` (WAN, IPoE) | ND Proxy 上流 | `ipv6 enable` / `ipv6 nd proxy GigaEthernet2.0` (autoconfig は無効) |
| `GigaEthernet2.0` (LAN1) | ND Proxy 下流 | `ipv6 enable` / `ipv6 nd ra enable` (auto-prefix を学習して LAN へ RA 送出) |

### 動作

- BIGLOBE 上流 (`fe80::221:d8ff:fe9a:e3c2`) からの RA を GE1.0 が受信
- 学習したプレフィックス `2404:7a83:c081:1100::/64` を `auto-prefix11` として保持
- GE2.0 が同プレフィックスを LAN1 へ RA で能動送出
- ND Proxy が GE1.0 ↔ GE2.0 間の NS/NA を中継するため、LAN1 クライアントは BIGLOBE BNG 直下に接続しているように振る舞う
- LAN1 クライアントの IPv6 デフォルトゲートウェイは `fe80::260:b9ff:fea4:e99e` (router1 GE2.0 LL アドレス)

### 制約

- **LAN2 (192.168.2.0/24) は IPv6 未対応**: 上流から /64 1 本しか降りないため、別セグメントで使う手段が無い (HGW 経由なら /60〜/56 の PD が貰えて分割可能)
- ルーター自身 (router1) は IPv6 GUA を持たない (GE1.0 から `ipv6 address autoconfig` を外して ND Proxy 要件を満たしているため)
- BIGLOBE が払い出すプレフィックスが変わると LAN クライアントのアドレスも変わる

### IPv4 over IPv6 (MAP-E)

`Tunnel0.0` に `tunnel mode map-e` の設定が残っているが現在 `shutdown`。将来 v6 プラス系に切替えるときに利用する想定。

## TODO

- [ ] **WAN 冗長化の実施** — 詳細は [wan-failover-plan.md](./archives/wan-failover-plan.md)
  - フローティング default + WAN 監視 + 自動切替を順次投入
- [ ] LAN2 の IPv6 対応方針を決める (HGW 導入 / LAN1・LAN2 を統合 / IPv6 は LAN1 限定で運用継続 のいずれか)
