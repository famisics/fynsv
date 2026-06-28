# fynsv ネットワーク構成

自宅 LAN (fynsv) のネットワーク機器構成と設定の覚書。トポロジ図は [network-diagram.drawio](./network-diagram.drawio) 参照 (シート「ネットワーク構成図v2」が現行)。

## ハードウェア

| 役割 | 機器 | OS |
|---|---|---|
| Primary ルーター | NEC IX2215 | IX Series Software 10.11.14 |
| Secondary ルーター | NEC IX2215 | IX Series Software 10.11.14 |
| Primary 回線 | BIGLOBE 光 (PPPoE + IPoE) | — |
| Secondary 回線 | NCV (DHCP) | — |

設定ファイルは [router1.config](./router1.config) (Primary) / [router2.config](./router2.config) (Secondary) に `show running-config` 出力を保管 (機密情報はプレースホルダに置換済み)。

## 設定ファイルの同期

ルーターに設定変更を行ったら、その都度この覚書の config を最新化する。実機が正、リポジトリはそのスナップショット。

1. 変更後の実機から最新の `show running-config` を取得する (config モードで実行。シリアルコンソール手順は claude-remote の `serial:ix2215` を参照)
2. 出力を該当ファイル ([router1.config](./router1.config) / [router2.config](./router2.config)) に反映する
3. **コミット前に、機密性の高い値をプレースホルダへ置換する** (実値は絶対にコミットしない):

   | 実機の行 | 置換後のプレースホルダ |
   |---|---|
   | `username ... password hash <ハッシュ>` | `<ADMIN_PASSWORD_HASH>` |
   | `authentication myname <PPPoE ユーザー名>` | `<PPPOE_USERNAME>` |
   | `authentication password <PPPoE パスワード> ...` | `<PPPOE_PASSWORD>` |

4. 上表以外にも、新たに pre-shared key・SNMP community・各種パスワード/ハッシュ・トークンが現れたら、内容が分かる名前のプレースホルダ (`<...>`) に置換する
5. 置換漏れがないか差分を確認してからコミットする

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
| router1 | `default → GigaEthernet1.1 (PPPoE)` | 主回線 (NAPT 抜け) |
| router1 | `default → 10.0.0.2 GigaEthernet0.0 metric 200` | 予備 (router2 経由) |
| router1 | `192.168.2.0/24 → 10.0.0.2 GigaEthernet0.0` | LAN2 への静的ルート |
| router2 | `default → 10.0.0.1 GigaEthernet0.0` | 主回線 (router1 経由) |
| router2 | `default → GigaEthernet1.0 metric 200 (NCV DHCP)` | 予備 (自回線 NAPT 抜け) |
| router2 | `192.168.1.0/24 → 10.0.0.1 GigaEthernet0.0` | LAN1 への静的ルート |

両ルーターで GE0.0 (`10.0.0.0/30`) には NAPT・フィルタを設定していないため、LAN1↔LAN2 は IPv4 で双方向に疎通する。

### WAN フェイルオーバー

router1 の PPPoE を網全体の主回線、router2 の NCV (DHCP) 回線を予備とする。通常時は両ルーターとも router1 の PPPoE 経由でインターネットに出る (router2 は GE0 経由で router1 へ抜ける)。router1 の PPPoE が落ちると、両ルーターとも router2 の DHCP 回線へ役割反転する。

各ルーターが `watch-group wan-failover` (`network-monitor`) で監視し、`probe-mode traffic` でデフォルト経路を切離/復帰する。

| ルーター | 監視先 | 監視経路 | 失敗時の動作 |
|---|---|---|---|
| router1 | `8.8.8.8` | `GigaEthernet1.1` (PPPoE) | 自 PPPoE のデフォルトを切離 → `10.0.0.2` (router2) 経由へ |
| router2 | `1.1.1.1` | `GigaEthernet0.0` (router1 経由) | router1 経由デフォルトを切離 → 自 `GigaEthernet1.0` (DHCP) へ |

#### sentinel-blackhole (発振防止)

router2 のメトリクスを反転しただけでは、router1 PPPoE 断時に router1 が router2 へフェイルオーバーするため、router2 のプローブ (`1.1.1.1` via GE0) が router1↔router2 でヘアピンして成功/失敗を繰り返し**発振 (フラッピング)** する。

これを防ぐため router1 に sentinel 経路を置く:

- `ip route 1.1.1.1/32 GigaEthernet1.1` — PPPoE 稼働時は `1.1.1.1` を PPPoE 経由で転送 (router2 のプローブが成功)
- `ip route 1.1.1.1/32 Null0.0 metric 200` — PPPoE 断時のみ有効化される floating な discard 経路。`1.1.1.1` を router2 へ送り返さず破棄するため、router2 のプローブがクリーンに失敗し自回線へ確定切替できる

代償として router1 PPPoE 断中は router1 LAN (`192.168.1.0/24`) から `1.1.1.1` だけ到達できなくなる (監視用と割り切る)。

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
