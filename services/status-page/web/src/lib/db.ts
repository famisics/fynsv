import { and, asc, desc, gte, lt, min, sql, sum } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { getDb } from "@/db";
import { rollups30m, serviceMeta, snapshots } from "@/db/schema";
import { GAP_THRESHOLD_MS, type Gap, RANGE_MS } from "./history";
import { parseSnapshot } from "./schema";
import type {
  ResourceSnapshot,
  ServiceCategory,
  ServiceCheck,
  TimeRange,
} from "./types";
import {
  alignedWindow,
  BUCKET_COUNTS,
  computeUptimeFromCounts,
  ROLLUP_BUCKET_MS,
  type UptimeSummary,
} from "./uptime";

const CACHE_TTL = 60;
const SNAPSHOTS_TAG = "snapshots";

export const getLatestSnapshot = unstable_cache(
  async (): Promise<{
    checks: ServiceCheck[];
    resources: ResourceSnapshot[];
  }> => {
    const db = getDb();
    const rows = await db
      .select()
      .from(snapshots)
      .orderBy(desc(snapshots.recordedAtMs))
      .limit(1);
    if (rows.length === 0) return { checks: [], resources: [] };
    return parseSnapshot(rows[0]);
  },
  ["latest-snapshot"],
  { revalidate: CACHE_TTL, tags: [SNAPSHOTS_TAG] },
);

export const getServiceMeta = unstable_cache(
  async (): Promise<Record<
    string,
    { name: string; category: ServiceCategory }
  > | null> => {
    const db = getDb();
    const rows = await db
      .select()
      .from(serviceMeta)
      .orderBy(desc(serviceMeta.version))
      .limit(1);
    if (rows.length === 0) return null;
    return JSON.parse(rows[0].data);
  },
  ["service-meta"],
  { revalidate: CACHE_TTL, tags: [SNAPSHOTS_TAG] },
);

const getFirstRollupTime = unstable_cache(
  async (): Promise<number | null> => {
    const db = getDb();
    const rows = await db
      .select({ ms: min(rollups30m.bucketMs) })
      .from(rollups30m);
    return rows[0]?.ms ?? null;
  },
  ["first-rollup-time"],
  { revalidate: CACHE_TTL, tags: [SNAPSHOTS_TAG] },
);

// unstable_cache はキャッシュ値を JSON シリアライズするため、戻り値は Map ではなく plain object にする
export const getAllServicesUptime = unstable_cache(
  async (range: TimeRange): Promise<Record<string, UptimeSummary>> => {
    const db = getDb();
    const now = Date.now();
    const { start, end } = alignedWindow(range, now);
    const bucketCount = BUCKET_COUNTS[range];
    const displayBucketMs = RANGE_MS[range] / bucketCount;

    // @libsql/client は number を REAL でバインドするため、整数除算を CAST で明示する
    const bucketExpr = sql<number>`cast((${rollups30m.bucketMs} - ${start}) / ${displayBucketMs} as integer)`;
    const rows = await db
      .select({
        serviceId: rollups30m.serviceId,
        bucket: bucketExpr,
        up: sum(rollups30m.upCount).mapWith(Number),
      })
      .from(rollups30m)
      .where(and(gte(rollups30m.bucketMs, start), lt(rollups30m.bucketMs, end)))
      .groupBy(rollups30m.serviceId, bucketExpr);

    const countsByService = new Map<string, number[]>();
    for (const row of rows) {
      let counts = countsByService.get(row.serviceId);
      if (!counts) {
        counts = new Array<number>(bucketCount).fill(0);
        countsByService.set(row.serviceId, counts);
      }
      counts[row.bucket] = row.up;
    }

    const firstEver = await getFirstRollupTime();
    const result: Record<string, UptimeSummary> = {};
    for (const [serviceId, counts] of countsByService) {
      result[serviceId] = computeUptimeFromCounts(
        counts,
        range,
        now,
        firstEver,
      );
    }
    return result;
  },
  ["all-services-uptime"],
  { revalidate: CACHE_TTL, tags: [SNAPSHOTS_TAG] },
);

export const getAllServicesHistory = unstable_cache(
  async (
    range: TimeRange,
  ): Promise<{
    resources: Record<string, ResourceSnapshot[]>;
    gaps: Gap[];
  }> => {
    if (range === "24h") return getRawHistory24h();
    return getRollupHistory(range);
  },
  ["all-services-history"],
  { revalidate: CACHE_TTL, tags: [SNAPSHOTS_TAG] },
);

// 24h は 1 分解像度の生スナップショットをそのまま描画する
async function getRawHistory24h(): Promise<{
  resources: Record<string, ResourceSnapshot[]>;
  gaps: Gap[];
}> {
  const db = getDb();
  const now = Date.now();
  const start = now - RANGE_MS["24h"];

  const rows = await db
    .select()
    .from(snapshots)
    .where(gte(snapshots.recordedAtMs, start))
    .orderBy(asc(snapshots.recordedAtMs));

  const resources: Record<string, ResourceSnapshot[]> = {};
  for (const row of rows) {
    const { resources: rowResources } = parseSnapshot(row);
    for (const r of rowResources) {
      let list = resources[r.service_id];
      if (!list) {
        list = [];
        resources[r.service_id] = list;
      }
      list.push(r);
    }
  }

  const gapRows = await db.all<{ prev_ms: number; cur_ms: number }>(sql`
    SELECT prev_ms, cur_ms FROM (
      SELECT recorded_at_ms AS cur_ms,
             LAG(recorded_at_ms) OVER (ORDER BY recorded_at_ms) AS prev_ms
      FROM snapshots WHERE recorded_at_ms >= ${start}
    ) WHERE prev_ms IS NOT NULL AND cur_ms - prev_ms > ${GAP_THRESHOLD_MS}
  `);
  const gaps: Gap[] = gapRows.map((g) => ({
    start: Number(g.prev_ms),
    end: Number(g.cur_ms),
  }));

  const lastMs = rows.length > 0 ? rows[rows.length - 1].recordedAtMs : null;
  if (lastMs !== null && now - lastMs > GAP_THRESHOLD_MS) {
    gaps.push({ start: lastMs, end: now });
  }

  return { resources, gaps };
}

// 7d/30d は 30 分ロールアップの加重平均を描画する
async function getRollupHistory(range: TimeRange): Promise<{
  resources: Record<string, ResourceSnapshot[]>;
  gaps: Gap[];
}> {
  const db = getDb();
  const now = Date.now();
  const { start, end } = alignedWindow(range, now);

  const rows = await db
    .select()
    .from(rollups30m)
    .where(and(gte(rollups30m.bucketMs, start), lt(rollups30m.bucketMs, end)))
    .orderBy(asc(rollups30m.bucketMs));

  const resources: Record<string, ResourceSnapshot[]> = {};
  const presentBuckets = new Set<number>();
  for (const row of rows) {
    presentBuckets.add(row.bucketMs);
    if (row.resourceCount === 0) continue;
    let list = resources[row.serviceId];
    if (!list) {
      list = [];
      resources[row.serviceId] = list;
    }
    const avg = (v: number | null) =>
      v === null ? null : v / row.resourceCount;
    list.push({
      id: row.bucketMs,
      service_id: row.serviceId,
      cpu_percent: avg(row.cpuSum),
      mem_used_bytes: avg(row.memUsedSum),
      mem_total_bytes: avg(row.memTotalSum),
      disk_used_bytes: avg(row.diskUsedSum),
      disk_total_bytes: avg(row.diskTotalSum),
      net_in_bytes: avg(row.netInSum),
      net_out_bytes: avg(row.netOutSum),
      recorded_at: new Date(row.bucketMs).toISOString(),
    });
  }

  // チェッカー全停止区間 = 欠損バケットをギャップとして塗る
  const firstEver = await getFirstRollupTime();
  const gaps: Gap[] = [];
  if (firstEver !== null) {
    const scanStart = Math.max(start, firstEver);
    for (let b = scanStart; b < now; b += ROLLUP_BUCKET_MS) {
      if (presentBuckets.has(b)) continue;
      const gapEnd = Math.min(b + ROLLUP_BUCKET_MS, now);
      const last = gaps[gaps.length - 1];
      if (last && last.end === b) {
        last.end = gapEnd;
      } else {
        gaps.push({ start: b, end: gapEnd });
      }
    }
  }

  return { resources, gaps };
}
