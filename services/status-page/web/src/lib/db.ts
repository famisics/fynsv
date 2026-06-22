import { asc, desc, gte } from "drizzle-orm";
import { getDb } from "@/db";
import { serviceMeta, snapshots } from "@/db/schema";
import type { ResourceSnapshot, ServiceCategory, ServiceCheck, TimeRange } from "./types";
import { parseSnapshot, parseSnapshots, type SnapshotRow } from "./schema";

function rangeStart(range: TimeRange): string {
  const ms =
    range === "24h" ? 86400000 : range === "7d" ? 604800000 : 2592000000;
  return new Date(Date.now() - ms).toISOString();
}

export async function getLatestSnapshot(): Promise<{
  checks: ServiceCheck[];
  resources: ResourceSnapshot[];
}> {
  const db = getDb();
  const rows = await db
    .select()
    .from(snapshots)
    .orderBy(desc(snapshots.recordedAt))
    .limit(1);
  if (rows.length === 0) return { checks: [], resources: [] };
  return parseSnapshot(rows[0] as unknown as SnapshotRow);
}

export async function getHistory(
  serviceId: string,
  range: TimeRange,
): Promise<{ checks: ServiceCheck[]; resources: ResourceSnapshot[] }> {
  const db = getDb();
  const rows = await db
    .select()
    .from(snapshots)
    .where(gte(snapshots.recordedAt, rangeStart(range)))
    .orderBy(asc(snapshots.recordedAt));

  const { checks } = parseSnapshots(rows as unknown as SnapshotRow[]);

  const stride = range === "24h" ? 1 : range === "7d" ? 5 : 20;
  const sampled = rows.filter((_, i) => i % stride === 0);
  const { resources } = parseSnapshots(sampled as unknown as SnapshotRow[]);

  return {
    checks: checks.filter((c) => c.service_id === serviceId),
    resources: resources.filter((r) => r.service_id === serviceId),
  };
}

export async function getServiceMeta(): Promise<
  Record<string, { name: string; category: ServiceCategory }> | null
> {
  const db = getDb();
  const rows = await db
    .select()
    .from(serviceMeta)
    .orderBy(desc(serviceMeta.version))
    .limit(1);
  if (rows.length === 0) return null;
  return JSON.parse(rows[0].data);
}
