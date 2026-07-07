import { describe, expect, test } from "bun:test";
import type { SnapshotRow } from "./db";
import { aggregateSnapshots, bucketStart, ROLLUP_BUCKET_MS } from "./rollup";

const T0 = 1_800_000_000_000; // 30分境界に整列した epoch ms

function snapshot(
  id: number,
  recordedAtMs: number,
  services: Record<string, Record<string, unknown>>,
  schemaVersion = 1,
): SnapshotRow {
  return {
    id,
    schemaVersion,
    data: JSON.stringify({ services }),
    recordedAt: new Date(recordedAtMs).toISOString(),
    recordedAtMs,
  };
}

describe("bucketStart", () => {
  test("30分境界に切り捨てる", () => {
    expect(bucketStart(T0)).toBe(T0);
    expect(bucketStart(T0 + 1)).toBe(T0);
    expect(bucketStart(T0 + ROLLUP_BUCKET_MS - 1)).toBe(T0);
    expect(bucketStart(T0 + ROLLUP_BUCKET_MS)).toBe(T0 + ROLLUP_BUCKET_MS);
  });
});

describe("aggregateSnapshots", () => {
  test("status を up/down で数える", () => {
    const rows = [
      snapshot(1, T0, { web: { status: "up", error: null } }),
      snapshot(2, T0 + 60_000, { web: { status: "down", error: "timeout" } }),
      snapshot(3, T0 + 120_000, { web: { status: "up", error: null } }),
    ];
    const [r] = aggregateSnapshots(rows);
    expect(r).toMatchObject({
      bucketMs: T0,
      serviceId: "web",
      upCount: 2,
      downCount: 1,
      sampleCount: 3,
      resourceCount: 0,
      cpuSum: null,
    });
  });

  test("バケット境界とサービスで行が分かれる", () => {
    const rows = [
      snapshot(1, T0, {
        web: { status: "up", error: null },
        db: { status: "up", error: null },
      }),
      snapshot(2, T0 + ROLLUP_BUCKET_MS, { web: { status: "up", error: null } }),
    ];
    const result = aggregateSnapshots(rows);
    expect(result).toHaveLength(3);
    const keys = result.map((r) => `${r.bucketMs - T0}:${r.serviceId}`).sort();
    expect(keys).toEqual(["0:db", "0:web", `${ROLLUP_BUCKET_MS}:web`]);
  });

  test("リソース値は合計し resource_count を数える", () => {
    const rows = [
      snapshot(1, T0, {
        web: {
          status: "up",
          error: null,
          cpu_percent: 10,
          mem_used_bytes: 100,
          mem_total_bytes: 1000,
          disk_used_bytes: 50,
          disk_total_bytes: 500,
          net_in_bytes: 5,
          net_out_bytes: 7,
        },
      }),
      snapshot(2, T0 + 60_000, {
        web: {
          status: "up",
          error: null,
          cpu_percent: 30,
          mem_used_bytes: 300,
          mem_total_bytes: 1000,
          disk_used_bytes: 150,
          disk_total_bytes: 500,
          net_in_bytes: 15,
          net_out_bytes: 13,
        },
      }),
      // proxmox 取得失敗 tick: リソース欄なし
      snapshot(3, T0 + 120_000, { web: { status: "up", error: null } }),
    ];
    const [r] = aggregateSnapshots(rows);
    expect(r).toMatchObject({
      sampleCount: 3,
      resourceCount: 2,
      cpuSum: 40,
      memUsedSum: 400,
      memTotalSum: 2000,
      diskUsedSum: 200,
      diskTotalSum: 1000,
      netInSum: 20,
      netOutSum: 20,
    });
  });

  test("未知の schema_version はスキップする", () => {
    const rows = [
      snapshot(1, T0, { web: { status: "up", error: null } }, 2),
      snapshot(2, T0 + 60_000, { web: { status: "up", error: null } }),
    ];
    const [r] = aggregateSnapshots(rows);
    expect(aggregateSnapshots(rows)).toHaveLength(1);
    expect(r.sampleCount).toBe(1);
  });

  test("同じ入力から同じ結果が得られる (再計算 upsert の前提)", () => {
    const rows = [
      snapshot(1, T0, { web: { status: "up", error: null, cpu_percent: 10 } }),
      snapshot(2, T0 + 60_000, { web: { status: "down", error: "x" } }),
    ];
    expect(aggregateSnapshots(rows)).toEqual(aggregateSnapshots(rows));
  });
});
