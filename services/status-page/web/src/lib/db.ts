import { createClient } from "@libsql/client";
import type { ResourceSnapshot, ServiceCheck, TimeRange } from "./types";

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
    `SELECT sc.* FROM service_checks sc
     INNER JOIN (
       SELECT service_id, MAX(checked_at) as max_time
       FROM service_checks GROUP BY service_id
     ) latest
     ON sc.service_id = latest.service_id AND sc.checked_at = latest.max_time
     ORDER BY sc.service_id`,
  );
  return res.rows as unknown as ServiceCheck[];
}

export async function getLatestResources(): Promise<ResourceSnapshot[]> {
  const res = await db.execute(
    `SELECT rs.* FROM resource_snapshots rs
     INNER JOIN (
       SELECT service_id, MAX(recorded_at) as max_time
       FROM resource_snapshots GROUP BY service_id
     ) latest
     ON rs.service_id = latest.service_id AND rs.recorded_at = latest.max_time
     ORDER BY rs.service_id`,
  );
  return res.rows as unknown as ResourceSnapshot[];
}

export async function getCheckHistory(
  serviceId: string,
  range: TimeRange,
): Promise<ServiceCheck[]> {
  const res = await db.execute({
    sql: `SELECT * FROM service_checks
          WHERE service_id = ? AND checked_at >= ?
          ORDER BY checked_at ASC`,
    args: [serviceId, rangeStart(range)],
  });
  return res.rows as unknown as ServiceCheck[];
}

export async function getResourceHistory(
  serviceId: string,
  range: TimeRange,
): Promise<ResourceSnapshot[]> {
  const stride = range === "24h" ? 1 : range === "7d" ? 5 : 20;
  const res = await db.execute({
    sql: `SELECT * FROM (
            SELECT *, ROW_NUMBER() OVER (ORDER BY recorded_at ASC) AS rn
            FROM resource_snapshots
            WHERE service_id = ? AND recorded_at >= ?
          )
          WHERE (rn - 1) % ? = 0
          ORDER BY recorded_at ASC`,
    args: [serviceId, rangeStart(range), stride],
  });
  return res.rows as unknown as ResourceSnapshot[];
}

export { db };
