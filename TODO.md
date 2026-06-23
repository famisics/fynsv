# Proxmox クラスタ FYNSV 可用性プラン

クラスタ ([README.md](./README.md)) の **ノード障害耐性の評価と対策計画**。基盤構成の正は README、ゲストのリソース割り当ての正は [`../terraform/`](../terraform/)。本書はそれらを前提に「ノードが1台落ちたら何が起きるか」「自動復旧させるには何が要るか」を扱う。

数値は実機確認のスナップショットで、状態は変動する。可用性に関わる設定値 (Ceph pool の `size`/`min_size`、CRUSH rule、HA リソース、mgr/mds の構成) は変更時にここを更新する。

## 障害耐性の現状

実機 (`ceph`, `pvecm`, `ha-manager`, `pvesh`) で確認した可用性まわりの事実。

### 1ノード障害に耐える部分

| 層 | 設定 | 効果 |
| --- | --- | --- |
| corosync quorum | 3ノード `expected 3` | 1ノード喪失でも 2/3 で quorate 維持 |
| Ceph mon | 3 daemons (各ノード) | 1個喪失でも 2/3 で mon quorum 維持 |
| Ceph pool (全4プール) | `size=3` / `min_size=2` | 1 OSD 喪失でも min_size を満たし I/O 継続 |
| CRUSH rule `replicated_rule` | 障害ドメイン `host` (`chooseleaf_firstn type host`) | 3レプリカが3ノードに分散。1ノードが丸ごと落ちても残2コピー生存、**データ消失なし** |
| 容量 | Raw 約7% 使用 (199 GiB / 2.8 TiB) | 1ノード分 (0.93 TiB) 喪失も残容量に十分収まる |

→ **1ノード障害ではデータは失われず、Ceph 上の VM/CT ディスクは生存ノードから読み書きできる**。Ceph は degraded になるが I/O は止まらない。ただし 3ノードで 3レプリカを置けるノードが2台に減るため、再レプリケーションは完了せず degraded のまま留まる (稼働は継続)。

### 単一障害点・冗長化されていない部分

| 項目 | 現状 | リスク |
| --- | --- | --- |
| **Proxmox HA** | リソース0件 (`ha-manager config` 空 / CRM standby) | ⚠️ ゲストの**自動フェイルオーバーなし**。落ちたノードのゲストは手動で生存ノードに移して起動するまで停止 |
| **Ceph mgr** | pve01 単独、standby なし | ⚠️ pve01 喪失で mgr 一時不在。VM の I/O は mon+osd で継続するが、Ceph 統計・GUI・自動バランス等が止まり、別ノードで立て直すまで自動復帰しない |
| **Ceph mds** | 1/1、standby なし | mds の乗るノード喪失で CephFS 停止。ただし CephFS は `storage.cfg` 未登録・data 0B で実質未使用のため実害は小さい |
| 2ノード同時障害 | quorum 喪失 (残1票 < 過半数) + Ceph min_size 割れ | 書き込み停止・全体ダウン。3ノード構成の構造的限界 |

## ノード別の障害影響

ゲストの実配置 (`pvesh get /cluster/resources`、README の表と一致)。HA 未設定のため、いずれも自動移行されず手動復旧が必要。ディスクは共有 `vm-pool` 上にあるので生存ノードで起動し直せば戻る。

| 落ちるノード | 停止するゲスト | 影響 |
| --- | --- | --- |
| **pve01** | `arona`(100, 公開口・Tailscale+cloudflared・Docker ホスト) | 外部公開の入口が断。`prana`(101) は予備で stopped のため即時の代替にならない。加えて **mgr 不在**になる |
| **pve02** | `archivebox`(201), `misskey-db`(211/PostgreSQL), `misskey-redis`(212) | **Misskey 全停止** (web は pve03 だが DB/Redis 欠で機能しない) + ArchiveBox 停止 |
| **pve03** | `misskey-web`(210) | **Misskey 停止**。`supabase`(200) は元々 stopped |

misskey が pve02 (DB/Redis) と pve03 (Web) に分かれているため、どちらのノードが落ちても Misskey は停止する。

## やるべきこと

優先度順。1・2 が「1ノード障害を自動でしのぐ」ための本丸。

1. **Proxmox HA の導入** — 共有 `vm-pool` 上にあるので技術的に即可能。最低限 `arona`(100) と misskey 3点 (210/211/212) を HA リソース化し、ノード障害時に生存ノードへ自動再起動させる。
   - node affinity rule でノード優先度を設計 (PVE 9 で HA group は廃止)。例: misskey-db/redis を同居させ片寄せ、arona は任意ノード。
   - watchdog/fencing の挙動を確認 (現在 CRM watchdog standby)。
   - 自動再起動だけで成立するか、ゲスト内サービスの起動順依存 (misskey-web が DB/Redis を待てるか) を検証。
   - **HA 化の前提となる 2 点**:
     - corosync が単一リンク (ring0 / 192.168.2.x のみ)。HA + self-fencing 下ではこのリンクが揺れるだけで quorum を失い正常ノードまで self-fence する。`nic1` で 2nd link (ring1) を張る冗長化を先に推奨。
     - arona (8 GB) のフェイルオーバー先は pve02 / pve03 (各 13.3 GB) で、どちらに移っても物理 RAM を超える。HA 化前に arona のメモリ割当を 4–6 GB へ見直す。
2. **ceph-mgr を pve02 / pve03 にも追加** — `pveceph mgr create` で standby 化し、pve01 単一障害点を解消する。
3. **障害注入テスト** — 1ノードを計画停止 (`reboot` / NIC 落とし) して、(a) Ceph が degraded でも I/O 継続するか、(b) HA 導入後にゲストが自動再起動するか、(c) 復帰後に再レプリケーションが収束するかを実測する。
4. **`prana`(101) の位置づけを決める** — 公開口 `arona` の冗長・代替として常用するのか、純粋な予備のままにするのかを決め、前者なら構成を Terraform に反映する。
5. **(任意) standby MDS の追加** — CephFS を今後使う場合のみ。現状未使用のため優先度は低い。

2ノード同時障害は本構成では救えない。許容するか、ノード増設 (4〜5ノード化) で耐性を上げるかは別途判断する。
