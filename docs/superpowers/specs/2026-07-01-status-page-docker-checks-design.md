# status-page: レイテンシ撤去 + arona 内サービスの死活監視 設計

## 背景・目的

status-page (`services/status-page/`) は現在 HTTP / TCP / ping の3方式でサービスを死活監視し、レイテンシと Proxmox リソース使用率を収集・表示している。

- arona (VM 100) 上で Docker により常駐する `discord-bot` (fun-council) / `swarm-gcal-sync` はポートを一切公開しておらず（全接続アウトバウンドのみ）、監視対象に含まれていない。
- `misskey-mixi2-link` も同じく arona 上の Docker コンテナだが、`config.ts` 上は旧 LXC (VMID 216, `192.168.2.207`) への ping チェックのままで実態と合っていない。
- レイテンシは全サービスで不要。up/down の判定だけが欲しい。

## スコープ

- health-checker に Docker コンテナの running 状態を確認する `docker` チェックタイプを追加し、arona 上の3サービス (`discord-bot` / `misskey-mixi2-link` / `swarm-gcal-sync`) を監視対象にする。
- 全サービス (既存含む) からレイテンシの計測・保存・表示を撤去し、up/down のみのデータモデルにする。
- 新規3サービスは個別 Proxmox VMID を持たないため、リソース使用率 (CPU/メモリ/ディスク) は表示しない。

## アーキテクチャ

```
health-checker (arona, Docker)
  ├─ http / tcp / ping check  → 既存サービス (up/down のみ、レイテンシ計測なし)
  └─ docker check (NEW)       → /var/run/docker.sock 経由で兄弟コンテナの State.Running を確認
        discord-bot          → fun-council-bot-1
        misskey-mixi2-link   → misskey-mixi2-link-bridge-1
        swarm-gcal-sync      → swarm-gcal-sync-sync-1
```

health-checker 自身が arona 上の Docker Compose で常駐しているため、Docker ソケットをホストと同じマウントで読み取り専用共有し、Docker Engine API (`GET /containers/{name}/json`) を Unix ソケット越しに叩く。

コンテナ名は `docker ps` で実機確認済み (2026-07-01, arona):

| id | container |
| --- | --- |
| `discord-bot` | `fun-council-bot-1` |
| `misskey-mixi2-link` | `misskey-mixi2-link-bridge-1` |
| `swarm-gcal-sync` | `swarm-gcal-sync-sync-1` |

## 変更内容

### health-checker

- `src/checks.ts`
  - `CheckResult` から `latency_ms` を削除: `{ status: "up" | "down"; error?: string }`。
  - `httpCheck` / `tcpCheck` / `pingCheck` から計測 (`performance.now()`) を削除。
  - `dockerCheck(container: string, timeoutMs: number): Promise<CheckResult>` を追加。`fetch("http://localhost/containers/{container}/json", { unix: "/var/run/docker.sock", signal: AbortSignal.timeout(timeoutMs) })` で問い合わせ、`State.Running === true` なら up（`State.Health` があれば `Health.Status === "healthy"` も条件に含める）。404 やソケットエラーは down + error メッセージ。
- `src/config.ts`
  - `CheckType` に `"docker"` を追加。
  - `CheckConfig` に `container?: string` を追加。
  - `Service.proxmox` を `proxmox?: ProxmoxConfig` に変更（省略可能化）。
  - `misskey-mixi2-link` エントリの `check` を `{ type: "docker", container: "misskey-mixi2-link-bridge-1", timeoutMs: 3000 }` に置き換え、`proxmox` フィールドを削除。
  - `discord-bot` / `swarm-gcal-sync` を `category: "internal"`, `enabled: true`, 同方式の `docker` チェックで新規追加（`proxmox` なし）。
- `src/index.ts`
  - `runCheck` に `"docker"` ケースを追加。
  - `tick()` から `latency_ms` の書き込みを削除。
- `src/proxmox.ts` / `src/index.ts`
  - `fetchResourceStats` は `service.proxmox` が無い場合 `null` を返して終了する（呼び出し側の `Promise.allSettled` はそのまま利用）。
- `compose.yaml`
  - `volumes: - /var/run/docker.sock:/var/run/docker.sock:ro` を追加。
  - `user: "0:0"` を追加（ソケット読み取りのため root で実行。`swarm-gcal-sync/compose.yml` の root-owned ファイル読み取りと同じ理由付け）。
  - `healthcheck.test` を `curl` 依存から `bun` 自身で `fetch` する形に変更する（現状 `oven/bun:1` イメージに `curl` が無く常に `unhealthy` になっているバグの修正。当タスクで触るファイルのついでに直す）。

### web

- `src/lib/types.ts`: `ServiceCheck.latency_ms` を削除。
- `src/lib/schema.ts`: `V1ServiceEntry` および `parseV1` / `parseServiceRow` から `latency_ms` を削除。
- `src/lib/format.ts`: `formatLatency` を削除。
- `src/components/service-card.tsx`: レイテンシ表示 (`formatLatency(check.latency_ms)`) を削除。
- `src/app/history/[serviceId]/page.tsx`: レイテンシ表示、および `Response time` セクション (`LatencyChart`) を削除。
- `src/components/charts/latency-chart.tsx`: 削除。
- `src/components/charts/shared.tsx` / `theme.ts`: `resource-chart.tsx` が引き続き使うため変更なし。

DB マイグレーションは不要（`latency_ms` は JSON blob 内のフィールドであり、過去データはそのまま残るが以後読み書きしないだけ）。新規3サービスのリソース非表示は、`resource` が `null` になる既存の分岐 (`service-card.tsx` の `Bar` が `—` を表示、`history` ページの `latestResource &&` ガード) がそのまま機能するため追加のUI変更は不要。

## エラーハンドリング

- `dockerCheck` はコンテナ不在・ソケット到達不可を例外にせず `{ status: "down", error }` として返す（既存の http/tcp check と同じ方針）。
- `fetchResourceStats` は `proxmox` 未設定時に例外を投げず `null` を返す。

## 検証方法

- `nr tsc` 等の型チェックはコード生成せず確認する（`.js` を出力しない）。
- ローカルには Docker ソケットが無いため `dockerCheck` の実地検証は arona 実機でのみ可能。`task deploy:hc` で反映後、`/api/status` のレスポンスと `docker ps` の実状態を突き合わせ、`docker compose stop` で意図的に落として `down` に反映されることを確認する。
