import { and, asc, desc, gte, lt, sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { getDb } from "@/db";
import { serviceMeta, snapshots } from "@/db/schema";
import { GAP_THRESHOLD_MS, type Gap, RANGE_MS } from "./history";
import { parseSnapshot } from "./schema";
import type {
  ResourceSnapshot,
  ServiceCategory,
  ServiceCheck,
  TimeRange,
} from "./types";
import {
  BUCKET_COUNTS,
  computeUptimeFromCounts,
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

const getFirstSnapshotTime = unstable_cache(
  async (): Promise<number | null> => {
    const db = getDb();
    const rows = await db
      .select({ ms: snapshots.recordedAtMs })
      .from(snapshots)
      .orderBy(asc(snapshots.recordedAtMs))
      .limit(1);
    return rows.length > 0 ? rows[0].ms : null;
  },
  ["first-snapshot-time"],
  { revalidate: CACHE_TTL, tags: [SNAPSHOTS_TAG] },
);

export const getAllServicesUptime = unstable_cache(
  async (range: TimeRange): Promise<Map<string, UptimeSummary>> => {
    const db = getDb();
    const windowMs = RANGE_MS[range];
    const now = Date.now();
    const start = now - windowMs;
    const bucketCount = BUCKET_COUNTS[range];
    const bucketMs = windowMs / bucketCount;

    const rows = await db
      .select()
      .from(snapshots)
      .where(
        and(
          gte(snapshots.recordedAtMs, start),
          lt(snapshots.recordedAtMs, now),
        ),
      );

    const countsByService = new Map<string, number[]>();
    for (const row of rows) {
      const bucket = Math.floor((row.recordedAtMs - start) / bucketMs);
      if (bucket < 0 || bucket >= bucketCount) continue;
      for (const { service_id } of parseSnapshot(row).checks) {
        let counts = countsByService.get(service_id);
        if (!counts) {
          counts = new Array<number>(bucketCount).fill(0);
          countsByService.set(service_id, counts);
        }
        counts[bucket]++;
      }
    }

    const firstEver = await getFirstSnapshotTime();
    const result = new Map<string, UptimeSummary>();
    for (const [serviceId, counts] of countsByService) {
      result.set(
        serviceId,
        computeUptimeFromCounts(counts, range, now, firstEver),
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
    resources: Map<string, ResourceSnapshot[]>;
    gaps: Gap[];
  }> => {
    const db = getDb();
    const now = Date.now();
    const start = now - RANGE_MS[range];
    const stride = range === "24h" ? 1 : range === "7d" ? 5 : 20;

    const rows = await db
      .select()
      .from(snapshots)
      .where(
        and(
          gte(snapshots.recordedAtMs, start),
          sql`${snapshots.id} % ${stride} = 0`,
        ),
      )
      .orderBy(asc(snapshots.recordedAtMs));

    const resources = new Map<string, ResourceSnapshot[]>();
    for (const row of rows) {
      const { resources: rowResources } = parseSnapshot(row);
      for (const r of rowResources) {
        let list = resources.get(r.service_id);
        if (!list) {
          list = [];
          resources.set(r.service_id, list);
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

    const lastRow = await db
      .select({ ms: snapshots.recordedAtMs })
      .from(snapshots)
      .where(gte(snapshots.recordedAtMs, start))
      .orderBy(desc(snapshots.recordedAtMs))
      .limit(1);
    if (lastRow.length > 0 && now - lastRow[0].ms > GAP_THRESHOLD_MS) {
      gaps.push({ start: lastRow[0].ms, end: now });
    }

    return { resources, gaps };
  },
  ["all-services-history"],
  { revalidate: CACHE_TTL, tags: [SNAPSHOTS_TAG] },
);
