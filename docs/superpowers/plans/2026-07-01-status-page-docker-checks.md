# status-page: レイテンシ撤去 + arona 内サービス監視 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** status-page からレイテンシ計測・表示を撤去して up/down 判定のみのデータモデルにし、arona (VM100) 上で Docker 常駐する discord-bot / misskey-mixi2-link / swarm-gcal-sync を新しい `docker` チェックタイプで死活監視できるようにする。

**Architecture:** health-checker (`services/status-page/health-checker`) の `checks.ts` に Docker Engine API を Unix ソケット経由で叩く `dockerCheck` を追加し、`config.ts` の3サービスをこの方式に切り替える。CheckResult からレイテンシを削除し、web (`services/status-page/web`) 側の型・パース・UI からもレイテンシを撤去する。

**Tech Stack:** Bun (health-checker, `bun:test` でテスト) / TypeScript / Next.js (web) / Drizzle + Turso (libSQL) / Docker Compose

## Global Constraints

- 型チェックは出力を生成せず確認する。`.js` を生成しない (`tsc --noEmit`)。
- スクリプト実行は `nr <script>` (ni ツールセット) 経由で行う。
- 不要になったコード・ファイルは削除する (dead code を残さない)。ファイル削除には `trash` を使う。
- ドキュメントは現状の挙動のみを記載する (進捗語・日付を書かない)。
- 本番 arona への deploy (`task deploy:hc` / `task deploy:web`) は破壊的操作に準ずるため、実行前に必ずユーザーの明示承認を得る。

---

## File Structure

- Modify `services/status-page/health-checker/package.json` — `test` / `typecheck` スクリプト追加。
- Modify `services/status-page/health-checker/src/checks.ts` — `CheckResult` からレイテンシ撤去、`dockerCheck` 追加。
- Create `services/status-page/health-checker/src/checks.test.ts` — `dockerCheck` の単体テスト (Unix ソケット上のモック Docker API)。
- Modify `services/status-page/health-checker/src/config.ts` — `CheckType`/`CheckConfig`/`Service.proxmox` の型変更、3サービスの `docker` チェック化・追加。
- Create `services/status-page/health-checker/src/config.test.ts` — 新しいサービス定義の妥当性テスト。
- Modify `services/status-page/health-checker/src/proxmox.ts` — `proxmox` 未設定時に `null` を返すガード。
- Create `services/status-page/health-checker/src/proxmox.test.ts` — ガードの単体テスト。
- Modify `services/status-page/health-checker/src/index.ts` — `docker` チェックの配線、レイテンシ書き込みの撤去。
- Modify `services/status-page/health-checker/compose.yaml` — Docker ソケットマウント・root 実行・healthcheck 修正。
- Modify `services/status-page/web/src/lib/types.ts` — `ServiceCheck.latency_ms` 削除。
- Modify `services/status-page/web/src/lib/schema.ts` — `latency_ms` のパース撤去。
- Modify `services/status-page/web/src/lib/format.ts` — `formatLatency` 削除。
- Modify `services/status-page/web/src/components/service-card.tsx` — レイテンシ表示削除。
- Modify `services/status-page/web/src/app/history/[serviceId]/page.tsx` — レイテンシ表示・Response time セクション削除。
- Delete `services/status-page/web/src/components/charts/latency-chart.tsx`。
- Modify `services/status-page/README.md` — チェック方式表・機能説明文の更新。

---

### Task 1: checks.ts — レイテンシ撤去 + dockerCheck 追加

**Files:**
- Modify: `services/status-page/health-checker/package.json`
- Modify: `services/status-page/health-checker/src/checks.ts`
- Test: `services/status-page/health-checker/src/checks.test.ts`

**Interfaces:**
- Consumes: なし (このタスクが起点)
- Produces:
  - `export interface CheckResult { status: "up" | "down"; error?: string }`
  - `export async function httpCheck(url: string, timeoutMs: number, okStatuses?: number[]): Promise<CheckResult>`
  - `export async function tcpCheck(host: string, port: number, timeoutMs: number): Promise<CheckResult>`
  - `export async function pingCheck(host: string, timeoutMs: number): Promise<CheckResult>`
  - `export async function dockerCheck(container: string, timeoutMs: number, socketPath?: string): Promise<CheckResult>` (`socketPath` 既定値 `/var/run/docker.sock`)

- [ ] **Step 1: package.json に test / typecheck スクリプトを追加**

`services/status-page/health-checker/package.json` の `scripts` を次のように変更する (`misskey-mixi2-link/package.json` と同じ命名規約):

```json
  "scripts": {
    "start": "bun run src/index.ts",
    "dev": "bun --watch run src/index.ts",
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate"
  },
```

- [ ] **Step 2: 失敗するテストを書く**

`services/status-page/health-checker/src/checks.test.ts` を新規作成:

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dockerCheck } from "./checks";

function startMockDockerd(respond: () => Response): {
  socketPath: string;
  server: ReturnType<typeof Bun.serve>;
  dir: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "dockerd-mock-"));
  const socketPath = join(dir, "docker.sock");
  const server = Bun.serve({
    unix: socketPath,
    fetch(req) {
      const match = new URL(req.url).pathname.match(
        /^\/containers\/([^/]+)\/json$/,
      );
      if (!match) return new Response("not found", { status: 404 });
      return respond();
    },
  });
  return { socketPath, server, dir };
}

describe("dockerCheck", () => {
  let cleanup: (() => void) | null = null;

  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  test("up when container is running", async () => {
    const { socketPath, server, dir } = startMockDockerd(() =>
      Response.json({ State: { Running: true } }),
    );
    cleanup = () => {
      server.stop();
      rmSync(dir, { recursive: true, force: true });
    };

    const result = await dockerCheck("fun-council-bot-1", 1000, socketPath);
    expect(result).toEqual({ status: "up" });
  });

  test("down when container is stopped", async () => {
    const { socketPath, server, dir } = startMockDockerd(() =>
      Response.json({ State: { Running: false } }),
    );
    cleanup = () => {
      server.stop();
      rmSync(dir, { recursive: true, force: true });
    };

    const result = await dockerCheck("fun-council-bot-1", 1000, socketPath);
    expect(result.status).toBe("down");
    expect(result.error).toBe("container not running");
  });

  test("down when container does not exist", async () => {
    const { socketPath, server, dir } = startMockDockerd(
      () => new Response("no such container", { status: 404 }),
    );
    cleanup = () => {
      server.stop();
      rmSync(dir, { recursive: true, force: true });
    };

    const result = await dockerCheck("missing", 1000, socketPath);
    expect(result.status).toBe("down");
    expect(result.error).toBe("no such container");
  });

  test("down when container is running but unhealthy", async () => {
    const { socketPath, server, dir } = startMockDockerd(() =>
      Response.json({
        State: { Running: true, Health: { Status: "unhealthy" } },
      }),
    );
    cleanup = () => {
      server.stop();
      rmSync(dir, { recursive: true, force: true });
    };

    const result = await dockerCheck("fun-council-bot-1", 1000, socketPath);
    expect(result.status).toBe("down");
    expect(result.error).toBe("health status: unhealthy");
  });

  test("down when socket is unreachable", async () => {
    const result = await dockerCheck(
      "fun-council-bot-1",
      500,
      "/nonexistent/docker.sock",
    );
    expect(result.status).toBe("down");
    expect(result.error).toBeDefined();
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `cd services/status-page/health-checker && nr test`
Expected: FAIL — `dockerCheck` が `checks.ts` に存在せずインポートエラーになる。

- [ ] **Step 4: checks.ts を書き換える**

`services/status-page/health-checker/src/checks.ts` の内容を次に置き換える:

```ts
export interface CheckResult {
  status: "up" | "down";
  error?: string;
}

export async function httpCheck(
  url: string,
  timeoutMs: number,
  okStatuses?: number[],
): Promise<CheckResult> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
    });
    if (okStatuses && !okStatuses.includes(res.status)) {
      return { status: "down", error: `HTTP ${res.status}` };
    }
    return { status: "up" };
  } catch (e) {
    return {
      status: "down",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function tcpCheck(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<CheckResult> {
  return new Promise((resolve) => {
    let socket: { end(): void } | undefined;

    const timer = setTimeout(() => {
      socket?.end();
      resolve({ status: "down", error: "timeout" });
    }, timeoutMs);

    Bun.connect({
      hostname: host,
      port,
      socket: {
        open(s) {
          clearTimeout(timer);
          socket = s;
          s.end();
          resolve({ status: "up" });
        },
        error(_s, err) {
          clearTimeout(timer);
          resolve({
            status: "down",
            error: err instanceof Error ? err.message : String(err),
          });
        },
        data() {},
        close() {},
      },
    }).catch((err) => {
      clearTimeout(timer);
      resolve({
        status: "down",
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });
}

export async function pingCheck(
  host: string,
  timeoutMs: number,
): Promise<CheckResult> {
  const waitSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  const proc = Bun.spawn(["ping", "-c", "1", "-W", String(waitSeconds), host], {
    stdout: "ignore",
    stderr: "ignore",
  });
  const code = await proc.exited;
  if (code === 0) {
    return { status: "up" };
  }
  return { status: "down", error: `ping exit ${code}` };
}

export async function dockerCheck(
  container: string,
  timeoutMs: number,
  socketPath = "/var/run/docker.sock",
): Promise<CheckResult> {
  try {
    const res = await fetch(`http://localhost/containers/${container}/json`, {
      unix: socketPath,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 404) {
      return { status: "down", error: "no such container" };
    }
    if (!res.ok) {
      return { status: "down", error: `Docker API HTTP ${res.status}` };
    }
    const body = (await res.json()) as {
      State?: { Running?: boolean; Health?: { Status?: string } };
    };
    if (!body.State?.Running) {
      return { status: "down", error: "container not running" };
    }
    const health = body.State.Health?.Status;
    if (health && health !== "healthy") {
      return { status: "down", error: `health status: ${health}` };
    }
    return { status: "up" };
  } catch (e) {
    return {
      status: "down",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `cd services/status-page/health-checker && nr test`
Expected: PASS — 5 テストすべて成功。

- [ ] **Step 6: 型チェック**

Run: `cd services/status-page/health-checker && nr typecheck`
Expected: エラーなし (出力ファイルは生成されない)。

- [ ] **Step 7: コミット**

```bash
git add services/status-page/health-checker/package.json services/status-page/health-checker/src/checks.ts services/status-page/health-checker/src/checks.test.ts
git commit -m "feat(status-page): checks からレイテンシを撤去し dockerCheck を追加"
```

---

### Task 2: config.ts — docker チェックタイプの導入とサービス定義

**Files:**
- Modify: `services/status-page/health-checker/src/config.ts`
- Test: `services/status-page/health-checker/src/config.test.ts`

**Interfaces:**
- Consumes: なし (型定義のみ、Task 1 の `checks.ts` には依存しない)
- Produces:
  - `export type CheckType = "http" | "tcp" | "ping" | "docker"`
  - `export interface CheckConfig { type: CheckType; url?: string; host?: string; port?: number; container?: string; timeoutMs: number; okStatuses?: number[] }`
  - `export interface Service { id: string; name: string; category: Category; enabled: boolean; check: CheckConfig; proxmox?: ProxmoxConfig }`
  - `services` 配列に `id: "discord-bot"` と `id: "swarm-gcal-sync"` が追加され、`id: "misskey-mixi2-link"` の `check` が `docker` 型になる。

- [ ] **Step 1: 失敗するテストを書く**

`services/status-page/health-checker/src/config.test.ts` を新規作成:

```ts
import { describe, expect, test } from "bun:test";
import { services } from "./config";

function findService(id: string) {
  const s = services.find((s) => s.id === id);
  if (!s) throw new Error(`service not found: ${id}`);
  return s;
}

describe("arona 上の docker チェック対象サービス", () => {
  test("discord-bot は fun-council-bot-1 を docker チェックする", () => {
    const s = findService("discord-bot");
    expect(s.enabled).toBe(true);
    expect(s.check).toEqual({
      type: "docker",
      container: "fun-council-bot-1",
      timeoutMs: 3000,
    });
    expect(s.proxmox).toBeUndefined();
  });

  test("misskey-mixi2-link は misskey-mixi2-link-bridge-1 を docker チェックする", () => {
    const s = findService("misskey-mixi2-link");
    expect(s.enabled).toBe(true);
    expect(s.check).toEqual({
      type: "docker",
      container: "misskey-mixi2-link-bridge-1",
      timeoutMs: 3000,
    });
    expect(s.proxmox).toBeUndefined();
  });

  test("swarm-gcal-sync は swarm-gcal-sync-sync-1 を docker チェックする", () => {
    const s = findService("swarm-gcal-sync");
    expect(s.enabled).toBe(true);
    expect(s.check).toEqual({
      type: "docker",
      container: "swarm-gcal-sync-sync-1",
      timeoutMs: 3000,
    });
    expect(s.proxmox).toBeUndefined();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd services/status-page/health-checker && nr test`
Expected: FAIL — `discord-bot` / `swarm-gcal-sync` が見つからず `service not found` で落ちる。

- [ ] **Step 3: config.ts を書き換える**

`services/status-page/health-checker/src/config.ts` の型定義部分 (1-27行目) を次に置き換える:

```ts
export type Category = "public" | "internal";
export type CheckType = "http" | "tcp" | "ping" | "docker";
export type GuestType = "lxc" | "qemu";

export interface CheckConfig {
  type: CheckType;
  url?: string;
  host?: string;
  port?: number;
  container?: string;
  timeoutMs: number;
  okStatuses?: number[];
}

export interface ProxmoxConfig {
  node: string;
  vmid: number;
  type: GuestType;
}

export interface Service {
  id: string;
  name: string;
  category: Category;
  enabled: boolean;
  check: CheckConfig;
  proxmox?: ProxmoxConfig;
}
```

続けて `misskey-mixi2-link` のエントリ (既存の `check`/`proxmox`) を次に置き換える:

```ts
  {
    id: "misskey-mixi2-link",
    name: "Misskey-mixi2 Bridge",
    category: "internal",
    enabled: true,
    check: {
      type: "docker",
      container: "misskey-mixi2-link-bridge-1",
      timeoutMs: 3000,
    },
  },
  {
    id: "discord-bot",
    name: "Discord Bot",
    category: "internal",
    enabled: true,
    check: { type: "docker", container: "fun-council-bot-1", timeoutMs: 3000 },
  },
  {
    id: "swarm-gcal-sync",
    name: "Swarm-GCal Sync",
    category: "internal",
    enabled: true,
    check: {
      type: "docker",
      container: "swarm-gcal-sync-sync-1",
      timeoutMs: 3000,
    },
  },
```

(元の `misskey-mixi2-link` エントリは1件でこれに置き換え、`discord-bot` と `swarm-gcal-sync` はその直後に新規挿入する。他のサービスのエントリは変更しない。)

- [ ] **Step 4: テストが通ることを確認**

Run: `cd services/status-page/health-checker && nr test`
Expected: PASS — Task 1 のテストと合わせて全テスト成功。

- [ ] **Step 5: 型チェック**

Run: `cd services/status-page/health-checker && nr typecheck`
Expected: エラーなし。

- [ ] **Step 6: コミット**

```bash
git add services/status-page/health-checker/src/config.ts services/status-page/health-checker/src/config.test.ts
git commit -m "feat(status-page): discord-bot / swarm-gcal-sync を docker チェックで追加し misskey-mixi2-link を docker チェックに切り替え"
```

---

### Task 3: proxmox.ts — proxmox 未設定サービスのガード

**Files:**
- Modify: `services/status-page/health-checker/src/proxmox.ts`
- Test: `services/status-page/health-checker/src/proxmox.test.ts`

**Interfaces:**
- Consumes: `Service` 型 (Task 2, `proxmox?: ProxmoxConfig`)
- Produces: `export async function fetchResourceStats(service: Service): Promise<ResourceStats | null>` — `service.proxmox` が無ければネットワークアクセスせず `null` を返す。

- [ ] **Step 1: 失敗するテストを書く**

`services/status-page/health-checker/src/proxmox.test.ts` を新規作成:

```ts
import { describe, expect, test } from "bun:test";
import type { Service } from "./config";
import { fetchResourceStats } from "./proxmox";

describe("fetchResourceStats", () => {
  test("proxmox マッピングが無いサービスは null を返す", async () => {
    const service: Service = {
      id: "discord-bot",
      name: "Discord Bot",
      category: "internal",
      enabled: true,
      check: { type: "docker", container: "fun-council-bot-1", timeoutMs: 3000 },
    };

    const result = await fetchResourceStats(service);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd services/status-page/health-checker && nr test`
Expected: 型エラーで失敗 (`service.proxmox` が `undefined` の可能性があるのに非 null 前提で分割代入しているため `strict` モードでコンパイルエラー) — `bun test` は TypeScript を型チェックせず実行するため、実際には分割代入時に `TypeError: Cannot destructure property 'node' of 'service.proxmox' as it is undefined.` で失敗する。

- [ ] **Step 3: proxmox.ts にガードを追加**

`services/status-page/health-checker/src/proxmox.ts` の `fetchResourceStats` 冒頭 (17-20行目) を次に置き換える:

```ts
export async function fetchResourceStats(
  service: Service,
): Promise<ResourceStats | null> {
  if (!service.proxmox) return null;
  const { node, vmid, type } = service.proxmox;
  const ip = PVE_NODES[node];
  if (!ip) return null;
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd services/status-page/health-checker && nr test`
Expected: PASS — 全テスト成功。

- [ ] **Step 5: 型チェック**

Run: `cd services/status-page/health-checker && nr typecheck`
Expected: エラーなし。

- [ ] **Step 6: コミット**

```bash
git add services/status-page/health-checker/src/proxmox.ts services/status-page/health-checker/src/proxmox.test.ts
git commit -m "fix(status-page): proxmox 未設定サービスはリソース取得をスキップする"
```

---

### Task 4: index.ts — docker チェックの配線とレイテンシ撤去

**Files:**
- Modify: `services/status-page/health-checker/src/index.ts`

**Interfaces:**
- Consumes:
  - `dockerCheck(container: string, timeoutMs: number): Promise<CheckResult>` (Task 1)
  - `CheckConfig.container?: string` (Task 2)
  - `CheckResult` は `{ status: "up" | "down"; error?: string }` (Task 1、`latency_ms` は存在しない)
- Produces: `tick()` が書き込む JSON エントリから `latency_ms` フィールドが無くなる (`{ status, error, ...resource }` のみ)。

このタスクは配線のみで新規ロジックを持たないため、型チェックと目視レビューで検証する (実際の Docker ソケット・Turso 接続は arona 実機でのみ確認可能、Task 9 で検証する)。

- [ ] **Step 1: import 文に dockerCheck を追加**

`services/status-page/health-checker/src/index.ts` の1-2行目を次に置き換える:

```ts
import { getEnabledServices, services, type Service } from "./config";
import { dockerCheck, httpCheck, pingCheck, tcpCheck, type CheckResult } from "./checks";
```

- [ ] **Step 2: runCheck に docker ケースを追加**

`services/status-page/health-checker/src/index.ts` の `runCheck` 関数 (9-19行目) を次に置き換える:

```ts
function runCheck(service: Service): Promise<CheckResult> {
  const { check } = service;
  switch (check.type) {
    case "http":
      return httpCheck(check.url!, check.timeoutMs, check.okStatuses);
    case "tcp":
      return tcpCheck(check.host!, check.port!, check.timeoutMs);
    case "ping":
      return pingCheck(check.host!, check.timeoutMs);
    case "docker":
      return dockerCheck(check.container!, check.timeoutMs);
  }
}
```

- [ ] **Step 3: tick() からレイテンシ書き込みを削除**

`services/status-page/health-checker/src/index.ts` の `tick()` 内、サービスごとのエントリ組み立て部分 (34-49行目) を次に置き換える:

```ts
  services.forEach((service, i) => {
    const entry: Record<string, unknown> = {};

    const checkResult = checks[i];
    if (checkResult.status === "fulfilled") {
      const r = checkResult.value;
      r.status === "up" ? up++ : down++;
      entry.status = r.status;
      entry.error = r.error ?? null;
    } else {
      down++;
      entry.status = "down";
      entry.error = String(checkResult.reason);
    }
```

(このブロックの後に続く `resourceResult` の処理と `serviceData[service.id] = entry;` はそのまま変更しない。)

- [ ] **Step 4: 型チェック**

Run: `cd services/status-page/health-checker && nr typecheck`
Expected: エラーなし。

- [ ] **Step 5: 既存テストが通ることを確認**

Run: `cd services/status-page/health-checker && nr test`
Expected: PASS — `index.ts` はテスト対象外 (トップレベルで `loop()` を実行し実際の Turso 接続を試みるため import 不可) だが、Task 1-3 のテストが引き続き通ることを確認する。

- [ ] **Step 6: コミット**

```bash
git add services/status-page/health-checker/src/index.ts
git commit -m "feat(status-page): docker チェックを配線しレイテンシ書き込みを撤去"
```

---

### Task 5: compose.yaml — Docker ソケットマウントと healthcheck 修正

**Files:**
- Modify: `services/status-page/health-checker/compose.yaml`

**Interfaces:**
- Consumes: なし
- Produces: `fynsv-health-checker` コンテナが `/var/run/docker.sock` を読み取り専用でマウントし、root で実行され、`bun` ベースの healthcheck を持つ。

- [ ] **Step 1: compose.yaml を書き換える**

`services/status-page/health-checker/compose.yaml` の内容を次に置き換える:

```yaml
services:
  health-checker:
    build: .
    container_name: fynsv-health-checker
    restart: unless-stopped
    # Docker ソケット読み取りのため root で実行する (swarm-gcal-sync の
    # root-owned ファイル読み取りと同じ理由付け)
    user: "0:0"
    ports:
      - "8090:8090"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    env_file: .env
    healthcheck:
      test: ["CMD", "bun", "-e", "fetch('http://localhost:8090/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
```

- [ ] **Step 2: YAML構文の確認**

Run: `cd services/status-page/health-checker && python3 -c "import yaml, sys; yaml.safe_load(open('compose.yaml'))" `
Expected: エラーなく終了 (`python3`/`pyyaml` が無ければ `docker compose config` で代替してよいが、arona 上でのみ実行可能なため後続の Task 9 検証に委ねてもよい)。

- [ ] **Step 3: コミット**

```bash
git add services/status-page/health-checker/compose.yaml
git commit -m "fix(status-page): health-checker に Docker ソケットをマウントし healthcheck を修正"
```

---

### Task 6: web — 型・パース・フォーマットからレイテンシを撤去

**Files:**
- Modify: `services/status-page/web/src/lib/types.ts`
- Modify: `services/status-page/web/src/lib/schema.ts`
- Modify: `services/status-page/web/src/lib/format.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `export interface ServiceCheck { id: number; service_id: string; status: ServiceStatus; error: string | null; checked_at: string }` (`latency_ms` を含まない)
  - `parseSnapshot` / `parseServiceRow` が返す `checks` に `latency_ms` を含まない
  - `formatLatency` は削除される (Task 7 で参照箇所も削除するため、この時点で web 全体の型チェックは Task 7 完了まで一時的に失敗する)

- [ ] **Step 1: types.ts から latency_ms を削除**

`services/status-page/web/src/lib/types.ts` の `ServiceCheck` (3-10行目) を次に置き換える:

```ts
export interface ServiceCheck {
  id: number;
  service_id: string;
  status: ServiceStatus;
  error: string | null;
  checked_at: string;
}
```

- [ ] **Step 2: schema.ts から latency_ms を削除**

`services/status-page/web/src/lib/schema.ts` の `V1ServiceEntry` (7-18行目) を次に置き換える:

```ts
interface V1ServiceEntry {
  status: string;
  error: string | null;
  cpu_percent?: number;
  mem_used_bytes?: number;
  mem_total_bytes?: number;
  disk_used_bytes?: number;
  disk_total_bytes?: number;
  net_in_bytes?: number;
  net_out_bytes?: number;
}
```

同ファイルの `parseV1` 内 `checks.push` (32-40行目) を次に置き換える:

```ts
  for (const [serviceId, entry] of Object.entries(parsed.services)) {
    checks.push({
      id: row.id,
      service_id: serviceId,
      status: entry.status as ServiceCheck["status"],
      error: entry.error ?? null,
      checked_at: row.recordedAt,
    });
```

同ファイルの `parseServiceRow` 内 `check` 組み立て (79-86行目) を次に置き換える:

```ts
  const check: ServiceCheck = {
    id: row.id,
    service_id: serviceId,
    status: entry.status as ServiceCheck["status"],
    error: entry.error ?? null,
    checked_at: row.recordedAt,
  };
```

- [ ] **Step 3: format.ts から formatLatency を削除**

`services/status-page/web/src/lib/format.ts` から次のブロック (17-20行目) を削除する:

```ts
export function formatLatency(ms: number | null): string {
  if (ms === null) return "—";
  return `${Math.round(ms)}ms`;
}
```

- [ ] **Step 4: コミット**

```bash
git add services/status-page/web/src/lib/types.ts services/status-page/web/src/lib/schema.ts services/status-page/web/src/lib/format.ts
git commit -m "feat(status-page): web の型・パース層からレイテンシを撤去"
```

(この時点では `service-card.tsx` / `history/[serviceId]/page.tsx` が削除済みの `formatLatency` を参照しており型チェックは失敗する。Task 7 で解消する。)

---

### Task 7: web — UI からレイテンシ表示を撤去

**Files:**
- Modify: `services/status-page/web/src/components/service-card.tsx`
- Modify: `services/status-page/web/src/app/history/[serviceId]/page.tsx`
- Delete: `services/status-page/web/src/components/charts/latency-chart.tsx`

**Interfaces:**
- Consumes: `ServiceCheck` (Task 6、`latency_ms` を含まない)
- Produces: サービスカード・履歴ページからレイテンシ表示が消え、CPU/MEM とステータスのみになる。

- [ ] **Step 1: service-card.tsx を書き換える**

`services/status-page/web/src/components/service-card.tsx` の内容を次に置き換える:

```tsx
import Link from "next/link";
import { percent } from "@/lib/format";
import type {
  ResourceSnapshot,
  ServiceCategory,
  ServiceCheck,
} from "@/lib/types";
import { StatusIndicator } from "./status-indicator";

function Bar({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-8 text-[10px] uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-zinc-400"
          style={{ width: `${Math.min(100, value ?? 0)}%` }}
        />
      </div>
      <span className="w-9 text-right text-[10px] tabular-nums text-zinc-400">
        {value === null ? "—" : `${Math.round(value)}%`}
      </span>
    </div>
  );
}

export function ServiceCard({
  check,
  resource,
  meta,
}: {
  check: ServiceCheck;
  resource: ResourceSnapshot | null;
  meta: { name: string; category: ServiceCategory };
}) {
  const cpu = resource?.cpu_percent ?? null;
  const mem = percent(
    resource?.mem_used_bytes ?? null,
    resource?.mem_total_bytes ?? null,
  );

  return (
    <Link
      href={`/history/${check.service_id}`}
      className="block rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 transition-colors hover:border-zinc-700 hover:bg-zinc-900"
    >
      <div className="flex items-center gap-2.5">
        <StatusIndicator status={check.status} />
        <span className="font-medium text-zinc-100">{meta.name}</span>
      </div>
      <div className="mt-4 space-y-1.5">
        <Bar label="CPU" value={cpu} />
        <Bar label="MEM" value={mem} />
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: history ページを書き換える**

`services/status-page/web/src/app/history/[serviceId]/page.tsx` の import 部分 (1-14行目) を次に置き換える:

```tsx
import Link from "next/link";
import { ResourceChart } from "@/components/charts/resource-chart";
import { RangeSelector } from "@/components/range-selector";
import { StatusIndicator } from "@/components/status-indicator";
import { getHistory, getLatestSnapshot, getServiceMeta } from "@/lib/db";
import { formatBytes, percent, relativeTime } from "@/lib/format";
import { RANGE_MS } from "@/lib/history";
import { parseRange } from "@/lib/types";
```

同ファイルの `header` 内の最新チェック表示 (63-69行目) を次に置き換える:

```tsx
            {latest && (
              <p className="text-sm text-zinc-500">
                {relativeTime(latest.checked_at)}
                {latest.error ? ` · ${latest.error}` : ""}
              </p>
            )}
```

同ファイルの `Response time` セクションとその直後の空行 (96-103行目) を削除する:

```tsx
      <Section title="Response time">
        {checks.length > 0 ? (
          <LatencyChart data={checks} domain={domain} gaps={gaps} />
        ) : (
          <Empty />
        )}
      </Section>

```

(このブロックを空行ごと丸ごと削除し、直後の `Section title="Resource usage"` の前に空行が1つだけ残る形にする。)

- [ ] **Step 3: latency-chart.tsx を削除**

```bash
trash services/status-page/web/src/components/charts/latency-chart.tsx
```

- [ ] **Step 4: 型チェック**

Run: `cd services/status-page/web && nr typecheck`

(`typecheck` スクリプトが無ければ追加する: `services/status-page/web/package.json` の `scripts` に `"typecheck": "tsc --noEmit"` を追加してから実行する。)
Expected: エラーなし。

- [ ] **Step 5: lint**

Run: `cd services/status-page/web && nr lint`
Expected: エラーなし。

- [ ] **Step 6: コミット**

```bash
git add services/status-page/web/src/components/service-card.tsx services/status-page/web/src/app/history/[serviceId]/page.tsx services/status-page/web/package.json
git rm services/status-page/web/src/components/charts/latency-chart.tsx
git commit -m "feat(status-page): UI からレイテンシ表示を撤去"
```

---

### Task 8: README.md の更新

**Files:**
- Modify: `services/status-page/README.md`

**Interfaces:**
- Consumes: なし
- Produces: なし (ドキュメントのみ)

- [ ] **Step 1: 機能説明からレイテンシ表記を削除**

`services/status-page/README.md` の14行目を次に置き換える:

```md
- **web**: Turso を読み取り、稼働状況・リソース推移を表示する Next.js アプリ。Vercel にデプロイする。
```

57行目を次に置き換える:

```md
- トップページ: サービスをカテゴリ (public / internal) ごとにグループ表示。状態インジケータ・CPU/メモリ使用率を表示し、30 秒ごとに自動更新する
```

59行目を次に置き換える:

```md
- `/history/[serviceId]`: サービス単位の詳細。時間レンジ (24h / 7d / 30d) を切り替えてリソース使用量のチャートを表示する
```

- [ ] **Step 2: チェック方式表に docker を追加**

「チェック方式は 3 種類」の見出しと表を次に置き換える:

```md
チェック方式は 4 種類:

| type | 必須パラメータ | 用途 |
| --- | --- | --- |
| `http` | `url`, `timeoutMs`, `okStatuses?` | HTTP エンドポイントがあるサービス。`okStatuses` 省略時は任意の HTTP レスポンスで up |
| `tcp` | `host`, `port`, `timeoutMs` | ポートの到達性だけ確認（DB, Redis, SSH 等） |
| `ping` | `host`, `timeoutMs` | inbound ポートがないサービス。ICMP でコンテナ生存のみ確認 |
| `docker` | `container`, `timeoutMs` | ポート未公開で health-checker と同じ arona ホスト上に同居する Docker コンテナ。Docker ソケット経由でコンテナの running / health 状態を確認 |
```

- [ ] **Step 3: コミット**

```bash
git add services/status-page/README.md
git commit -m "docs(status-page): docker チェックタイプとレイテンシ撤去を反映"
```

---

### Task 9: arona / Vercel へのデプロイ (ユーザー承認必須)

**Files:** なし (デプロイ操作のみ)

**Interfaces:** なし

このタスクは本番の arona ホストに Docker ソケットマウント付きの新しいコンテナを配置し、`fynsv-health-checker` を再起動する。**必ず事前にユーザーへ内容を提示し、明示的な承認を得てから実行する。** 承認が得られるまで実行しない。

- [ ] **Step 1: ユーザーに確認する**

次の内容を伝えて承認を得る:
- `task deploy:hc` で arona 上の `fynsv-health-checker` を再ビルド・再起動すること
- 新しい `compose.yaml` により `/var/run/docker.sock` が読み取り専用でマウントされ、コンテナが root で実行されること
- 既存の `misskey-mixi2-link` の死活監視方式が ping から docker に切り替わること

- [ ] **Step 2 (承認後): health-checker をデプロイ**

Run: `cd services/status-page && task deploy:hc`
Expected: `docker compose up -d --build` が成功し、arona 上で `fynsv-health-checker` が再起動する。

- [ ] **Step 3: 実機で動作確認**

`.claude/skills/claude-remote/scripts/remote-run ssh:arona "docker ps --format '{{.Names}}\t{{.Status}}'"` で `fynsv-health-checker` が `healthy` になることを確認する (Task 5 の healthcheck 修正が有効か)。

続けて数分待ってから `curl -s https://<status-page-url>/api/status | jq '.checks[] | select(.service_id == "discord-bot" or .service_id == "misskey-mixi2-link" or .service_id == "swarm-gcal-sync")'` 相当で `discord-bot` / `misskey-mixi2-link` / `swarm-gcal-sync` が `up` になっていることを確認する (web が未デプロイならローカルの `/api/status` エンドポイントの代わりに、arona 上で `docker logs fynsv-health-checker` の `checked N services: X up, Y down` ログで代用してもよい)。

- [ ] **Step 4 (承認後): web をデプロイ**

Run: `cd services/status-page/web && task deploy:web` (このコマンドも実行前にユーザー承認を得る)
Expected: Vercel への本番デプロイが成功する。

- [ ] **Step 5: 最終確認**

status-page のトップページで discord-bot / misskey-mixi2-link / swarm-gcal-sync のカードが表示され、レイテンシ表記が全サービスから消えていることを目視確認する。
