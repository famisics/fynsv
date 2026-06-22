import { createClient } from "@libsql/client";
import type { ResourceSnapshot, ServiceCheck, TimeRange } from "./types";
import { parseSnapshot, parseSnapshots, type SnapshotRow } from "./schema";

const db = createClient({
  url: process.env.TURSO_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

function rangeStart(range: TimeRange): string {
  const ms =
    range === "24h" ? 86400000 : range === "7d" ? 604800000 : 2592000000;
  return new Date(Date.now() - ms).toISOString();
}

export async function getLatestChecks(): Promise<ServiceCheck[]> {
  const res = await db.execute(
    `SELECT * FROM snapshots ORDER BY recorded_at DESC LIMIT 1`,
  );
  const row = res.rows[0] as unknown as SnapshotRow | undefined;
  if (!row) return [];
  return parseSnapshot(row).checks;
}

export async function getLatestResources(): Promise<ResourceSnapshot[]> {
  const res = await db.execute(
    `SELECT * FROM snapshots ORDER BY recorded_at DESC LIMIT 1`,
  );
  const row = res.rows[0] as unknown as SnapshotRow | undefined;
  if (!row) return [];
  return parseSnapshot(row).resources;
}

export async function getCheckHistory(
  serviceId: string,
  range: TimeRange,
): Promise<ServiceCheck[]> {
  const res = await db.execute({
    sql: `SELECT * FROM snapshots WHERE recorded_at >= ? ORDER BY recorded_at ASC`,
    args: [rangeStart(range)],
  });
  const { checks } = parseSnapshots(res.rows as unknown as SnapshotRow[]);
  return checks.filter((c) => c.service_id === serviceId);
}

export async function getResourceHistory(
  serviceId: string,
  range: TimeRange,
): Promise<ResourceSnapshot[]> {
  const stride = range === "24h" ? 1 : range === "7d" ? 5 : 20;
  const res = await db.execute({
    sql: `SELECT * FROM (
            SELECT *, ROW_NUMBER() OVER (ORDER BY recorded_at ASC) AS rn
            FROM snapshots
            WHERE recorded_at >= ?
          )
          WHERE (rn - 1) % ? = 0
          ORDER BY recorded_at ASC`,
    args: [rangeStart(range), stride],
  });
  const { resources } = parseSnapshots(res.rows as unknown as SnapshotRow[]);
  return resources.filter((r) => r.service_id === serviceId);
}

export { db };
