# WAN 冗長化計画

router1 (BIGLOBE PPPoE) または router2 (NCV DHCP) のいずれか片方の WAN が断絶した際に、対向ルーターの WAN を経由して LAN1 / LAN2 双方からインターネット到達性を維持する構成にする計画。

## 背景

現状 (`router1.config` / `router2.config` running-config 参照):

- 各ルーターのデフォルト経路は自身の WAN 1 本のみ (metric / track 指定なし)
- ルーター間直結リンク `10.0.0.0/30` (GE0.0 ↔ GE0.0) 上の対向 LAN への静的経路は両ルーターとも投入済みで、LAN1↔LAN2 双方向疎通は成立している
- WAN 到達性監視と経路自動切替の仕組みは無い
- フローティング default、`monitor` / `track`、router1 GE1.1 の `ip tcp adjust-mss auto` はいずれも未投入

GE0 リンクは現状 LAN 間ルーティング以外には活用されておらず、これを WAN 冗長化のバックボーンとして併用する。

## 目標

| # | 内容 |
|---|---|
| G1 | router1 WAN 断時に LAN1 が router2 WAN 経由でインターネット到達 |
| G2 | router2 WAN 断時に LAN2 が router1 WAN 経由でインターネット到達 |
| G3 | WAN 復旧時の自動フェイルバック |
| G4 | 平常時のトラフィックは従来どおり各自 WAN を直接利用 (対向経由しない) |

## 設計概要

### トポロジ (論理)

```
                          [Internet]
                ┌────────────┬─────────────┐
          [BIGLOBE ONU]              [NCV ONU]
                │                          │
       ┌──[router1 GE1.1]─┐    ┌─[router2 GE1.0]──┐
       │  PPPoE / NAPT    │    │  DHCP / NAPT     │
       │                  │    │                  │
  GE2.0 192.168.1.1   GE0.0 10.0.0.1 ──── 10.0.0.2 GE0.0   GE2.0 192.168.2.1
       │                  └─── 10.0.0.0/30 ───┘                │
   [LAN1 192.168.1.0/24]                                  [LAN2 192.168.2.0/24]
```

### 経路ポリシー

両ルーターに以下を持たせる:

- **プライマリ default**: 自身の WAN (低 metric)
- **フローティング default**: 対向ルーターの GE0.0 経由 (高 metric)
- **WAN 到達性監視**: 自 WAN を source とした ICMP 監視 (外部固定ホスト宛)。失敗時にプライマリ default を FIB から取り下げ、フローティング側へ自動切替
- LAN セグメント間スタティックは両方向で完備

### NAPT 配置

NAPT は各ルーターの WAN インターフェース (現行どおり) で実施する。GE0 リンク上では NAPT しない (二段 NAT 化を避けるため)。

フェイルオーバー時の流れ:

| 経路 | 通過点 | NAPT 実施箇所 |
|---|---|---|
| LAN1 ⇒ NCV | router1 (forward) → GE0 → router2 → GE1.0 | router2 GE1.0 |
| LAN2 ⇒ BIGLOBE | router2 (forward) → GE0 → router1 → GE1.1 | router1 GE1.1 |

対向 WAN の既存 NAPT 設定をそのまま流用するため、NAPT プールやポート定義の追加は不要。

### 戻り経路

NAPT で逆引きされた後、内部 LAN への経路解決が必要。

| ルーター | 対向 LAN への経路 | 状態 |
|---|---|---|
| router1 | `ip route 192.168.2.0/24 10.0.0.2 GigaEthernet0.0` | 設定済み |
| router2 | `ip route 192.168.1.0/24 10.0.0.1 GigaEthernet0.0` | 設定済み |

両経路は LAN1↔LAN2 双方向疎通とフェイルオーバー時の戻りトラフィックの前提条件であり、本計画ではこれを既存前提として扱う。

## 設定差分案

> IX 10.11 の文法。実機 help で確認済み:
>
> - `ip route` は `track` / `monitor` キーワードを取らない (`metric` / `distance` のみ)。route 連動は **`watch-group` + `network-monitor`** で実装する。
> - 監視プローブは `watch-group <name> <seq>` サブモード内に `event ... ip reach-host <ip> <if>` で定義。
> - `probe-mode` は **`passive` / `traffic` の 2 択**。`active` モードは存在しない。`traffic` モードは「監視先への実トラフィックが流れた後に ICMP プローブを能動送出」する半能動方式で、対象に通信が無いとプローブが始まらない (実機で初回 enable から 14 分プローブ無しの空白を観測)。
> - 失敗/復旧アクションは `action <seq> ip shutdown-route <prefix> <next-hop|if>` / `resume-route ...` で特定 default エントリだけを狙って withdraw / restore できる。
> - 起動有効化は `network-monitor <name> enable` (グローバル)。`startup-delay` で起動直後の誤検知抑制可 (ただし下記の variance 誤発火は抑止できない)。
> - `default` という綴りは `ip route default ...` には使えるが `shutdown-route` の引数では弾かれるので `0.0.0.0/0` で書く。
> - `probe-counter` / `probe-timer` の実機デフォルトは `watch=1 / variance=6 / restorer=1 / probe-timer variance=5s / restorer=5s / wait=2s` で、本計画値と一致するため running-config に明示行は出ない (省略表示される)。

### router1 追加設定

```text
! フローティング default (対向経由)
ip route default 10.0.0.2 GigaEthernet0.0 metric 200

! WAN 到達性監視 + プライマリ default 自動切替
watch-group wan-failover 1
  probe-mode traffic event 1
  probe-timer variance 5
  probe-timer restorer 5
  probe-timer wait 2
  probe-counter watch 1
  probe-counter variance 6      ! 6 連続失敗 (~30 秒) で down 判定
  probe-counter restorer 1      ! 1 回成功で up 判定
  event 1 ip reach-host 8.8.8.8 GigaEthernet1.1
  action 1 ip shutdown-route 0.0.0.0/0 GigaEthernet1.1
  action 2 ip resume-route 0.0.0.0/0 GigaEthernet1.1
  exit

network-monitor wan-failover startup-delay 180
network-monitor wan-failover enable

! PPPoE 経由 MSS 調整 (LAN2 からの通過時の MTU 1454 対策)
interface GigaEthernet1.1
  ip tcp adjust-mss auto
```

### router2 追加設定

```text
! フローティング default (対向経由)
ip route default 10.0.0.1 GigaEthernet0.0 metric 200

! WAN 到達性監視 (router1 と監視先を分け、誤検知の同時発生を抑制)
watch-group wan-failover 1
  probe-mode traffic event 1
  probe-timer variance 5
  probe-timer restorer 5
  probe-timer wait 2
  probe-counter watch 1
  probe-counter variance 6
  probe-counter restorer 1
  event 1 ip reach-host 1.1.1.1 GigaEthernet1.0
  action 1 ip shutdown-route 0.0.0.0/0 GigaEthernet1.0
  action 2 ip resume-route 0.0.0.0/0 GigaEthernet1.0
  exit

network-monitor wan-failover startup-delay 180
network-monitor wan-failover enable
```

> `action <seq>` の発火タイミングは `shutdown-*` 系が variance (失敗) 時、`resume-*` 系が restorer (復旧) 時に対応。`command-action-list` を使う場合は `restore` / `variance` を明示するが、`shutdown-route` / `resume-route` 系は名称で方向が決まる。
> `event` / `action` の正確な紐付け規則 (例: action sequence と event sequence が暗黙でマッチするか、別途 `action ... event ...` 指定が必要か) は `show network-monitor` 等で挙動確認すること。

## 段階的ロールアウト

実機影響を最小化するため、以下の順で投入する。各段階で次へ進む前に検証チェックを通すこと。

> **前提**: LAN1↔LAN2 双方向の静的経路は両ルーターに既に投入済み (`router1.config:15` / `router2.config:15`)。本計画はここを起点とする。

### Phase 1: フローティング default 投入 (監視なし)

- 両ルーターに metric 200 のフローティング default を追加
- 既存プライマリ (metric 無印 = 既定値) が常に優先されるため平常挙動は無変化
- `show ip route default` で 2 本見え、Active が WAN 側であることを確認

### Phase 2: 手動フェイルオーバー試験

- router1 GE1.1 を一時的に `shutdown`
  - LAN1 クライアントから外向き ping / curl が継続することを確認
  - traceroute が router2 を経由していることを確認
  - GE1.1 を `no shutdown` で復旧、プライマリへ自動復帰を確認
- router2 GE1.0 を一時的に `shutdown` で同様に逆方向確認

### Phase 3: WAN 監視 + watch-group 連動

- 両ルーターに `watch-group wan-failover 1` を投入 (probe / event / action / network-monitor)
- プライマリ default は触らずそのまま (action `shutdown-route` が動的に該当エントリを withdraw する)
- `show watch-group detail` で probe 状態と watch-group 状態を確認
- **enable 直後に必ず `Status: normal` / `Action ... Status: restoration` を確認**。`Status: stand` / `Action ... Status: executing` だった場合は下記「enable 直後の variance 誤発火」を参照して disable → enable で即リセットする
- WAN ケーブル抜去または上流 ISP 障害シミュレーション (監視先のみ到達不能化など) で自動切替・復旧を確認

### Phase 4: MSS / MTU 調整

- router1 GE1.1 に `ip tcp adjust-mss auto` 投入
- フェイルオーバー中の LAN2 から大容量 HTTPS ダウンロードや長時間 SSH で stall しないことを確認

## 検証チェックリスト

| Phase | 項目 |
|---|---|
| 1 | 両ルーターで `show ip route default` に 2 本見えていること |
| 1 | 平常時の traceroute (LAN1→外) が GE1.1 経由、(LAN2→外) が GE1.0 経由 |
| 2 | router1 GE1.1 shutdown 中に LAN1 から外向き疎通維持 |
| 2 | router2 GE1.0 shutdown 中に LAN2 から外向き疎通維持 |
| 2 | shutdown 解除後にプライマリへ自動復帰 (FIB / traceroute) |
| 3 | 監視 down 検知でフェイルオーバー、監視 up 復帰でフェイルバック |
| 3 | 切替検知時間 (`frequency × retry` 程度) が想定範囲内 |
| 4 | フェイルオーバー時に 100 MB 級 HTTPS ダウンロード / 連続 SSH が継続 |

前提となる LAN1↔LAN2 双方向 ping 疎通および LAN2→LAN1 SSH は、Phase 着手前に再確認しておくこと。

## 既知の不具合と運用上の注意

### enable 直後の variance 誤発火

`network-monitor <name> enable` 投入時、**プローブ未走時点で variance イベントが即時発火**し、その後何百回成功プローブを受けても自動復帰しない症状を実機で確認 (router1 / router2 ともに再現)。`startup-delay 180` でも抑止できない。

観測症状 (`show watch-group detail`):

- `Status: stand` (本来 `normal`)
- `Profile variance counts: 1` / `restore counts: 0`
- `Action 1 ip shutdown-route ... Status: executing` (本来 `restoration`)
- `Action 2 ip resume-route ... Status: executing` (本来 `restoration`)

データプレーン上は primary default が FIB に残っており通信は維持されるが、state machine が "発火後" 状態のまま固定されるため**実 WAN 障害時の正しい挙動が保証できない**。

**回避手順** (running-config 変更なし):

```
no network-monitor wan-failover enable
! 数秒待機
network-monitor wan-failover enable
```

probe history が既に蓄積された状態で再 enable すれば、即時 `Status: normal` / `Action ... Status: restoration` に遷移する。`write memory` 不要 (config は変わらない) だが、**機器再起動後は再発する**ため reload 時は手動で再リセットが必要。

将来的な恒久対策として、enable を probe 蓄積後に行うスクリプトの常駐 (cron + expect / NetMeister) または `event-terminal` を用いた別実装を検討する余地あり。

## 制約と対象外事項

- **IPv6 はフェイルオーバー対象外**
  - IPv6 は BIGLOBE 側の ND Proxy 構成 (LAN1 のみ) で成立しているため、router1 WAN 断時は IPv6 自体が利用不能。NCV は IPv4 のみ提供のため、router2 経由で IPv6 を救済する手段が無い。フェイルオーバー中は LAN1 クライアントが IPv4 のみで通信する形になる。
- **既存セッションは切断**
  - フェイルオーバーは別 NAPT プール経由となるため、TCP セッションは持続しない。HTTP は再接続で復帰、長時間 SSH やオンラインゲーム等は切断する。Active/Standby としてはシームレスではない点に留意。
- **二重 NAT は発生しない**
  - GE0 リンク上では NAPT を行わない。NAPT は対向 WAN 上の 1 段だけ。
- **MAP-E (`Tunnel0.0`) は対象外**
  - 現状 shutdown であり、本計画では触らない。将来 v6 プラス系へ切替える際は別途設計。
- **VRRP は導入しない**
  - LAN1 / LAN2 が物理的に別セグメントのため、同一セグメント上で仮想 IP を共有する VRRP は適用範囲外。クライアントのデフォルトゲートウェイは各 LAN の自ルーターのまま。
- **対向回線の帯域 / 約款**
  - フェイルオーバー時にトラフィックが対向 ISP 回線に集中する。NCV / BIGLOBE それぞれの上限と利用約款 (商用利用 / 帯域制限等) を超えないことを事前確認すること。
- **監視先依存**
  - `8.8.8.8` / `1.1.1.1` 自体が一時的に到達不能になった場合の誤切替リスクがある。必要なら複数ホスト OR 条件など `monitor` の冗長化を検討。

## 派生する整理対象

本計画と直接の依存は無いが、隣接する整理項目:

- LAN2 の IPv6 対応方針決定 (HGW 導入 / LAN1・LAN2 統合 / LAN1 限定運用継続)
- router1 の未使用 DHCPv6 関連プロファイル整理 (一部は除去済み)
