# IX2215 クラスタからサーバーへの統計情報収集

IX2215 2台構成のクラスタリング環境で、トラフィック量と 1.1.1.1 への ping を毎分計測し、ダッシュボードで可視化するための方式。

## データ収集方式

### SNMP ポーリング（トラフィック量）

IX2215 は SNMP v1/v2c/v3 に対応している。サーバーからルーターのインターフェースカウンタを定期的にポーリングしてトラフィック量を取得する。

- `ifHCInOctets` / `ifHCOutOctets` (64bit カウンタ) でインターフェースごとの送受信バイト数を取得
- 差分を取ることで単位時間あたりの通信量（bps）を算出

#### IX2215 側の設定

```
snmp-agent community read-community <コミュニティ名>
snmp-agent sysname IX2215-primary
```

2台目にも同様に設定し、`sysname` で区別する。

### ping 計測（1.1.1.1 への RTT）

サーバーから直接 1.1.1.1 へ ping する方式を推奨する。

- サーバー → IX2215 → ISP → 1.1.1.1 の経路で計測されるため実用上十分
- Telegraf の ping plugin なら設定1つで済む
- ルーターの `ip probe` + SNMP や SSH スクレイピングは保守コストが高い

ルーター自身の視点からの RTT が必要な場合は、以下の代替手段がある。

| 方式 | 概要 | 欠点 |
|---|---|---|
| `ip probe` + SNMP | ルーターの probe 機能で到達性確認し、結果を SNMP で取得 | MIB 対応がファームウェアに依存 |
| SSH スクレイピング | SSH で `ping` コマンドを実行し出力をパース | 脆弱、保守コストが高い |

## 構成

```
┌──────────────┐    SNMP     ┌──────────────────────────────┐
│  IX2215 (#1) │◄───────────►│                              │
└──────────────┘             │   サーバー                    │
                             │                              │
┌──────────────┐    SNMP     │  Telegraf (SNMP + ping)      │
│  IX2215 (#2) │◄───────────►│    ↓                         │
└──────────────┘             │  InfluxDB                    │
                             │    ↓                         │
                             │  Grafana (ダッシュボード)     │
                             └──────────────────────────────┘
```

| コンポーネント | 役割 |
|---|---|
| Telegraf | SNMP でルーターからトラフィック量を収集 / ping で 1.1.1.1 の RTT を計測 |
| InfluxDB | 時系列データの保存 |
| Grafana | ダッシュボード表示 |

## Telegraf 設定例

```toml
# IX2215 2台からトラフィック量を収集
[[inputs.snmp]]
  agents = ["<IX2215-1のIP>:161", "<IX2215-2のIP>:161"]
  community = "<コミュニティ名>"
  interval = "60s"

  [[inputs.snmp.field]]
    oid = "IF-MIB::ifHCInOctets.1"
    name = "bytes_in"
  [[inputs.snmp.field]]
    oid = "IF-MIB::ifHCOutOctets.1"
    name = "bytes_out"

# 1.1.1.1 への ping
[[inputs.ping]]
  urls = ["1.1.1.1"]
  interval = "60s"
  count = 3
```

> `ifHCInOctets.1` の末尾の数字はインターフェースインデックス。`snmpwalk` で対象インターフェースの index を事前に確認すること。
