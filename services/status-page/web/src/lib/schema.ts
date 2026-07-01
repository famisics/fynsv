import type { InferSelectModel } from "drizzle-orm";
import type { snapshots } from "@/db/schema";
import type { ResourceSnapshot, ServiceCheck } from "./types";

type SnapshotRow = InferSelectModel<typeof snapshots>;

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

interface V1Data {
  services: Record<string, V1ServiceEntry>;
}

function parseV1(row: SnapshotRow): {
  checks: ServiceCheck[];
  resources: ResourceSnapshot[];
} {
  const parsed = JSON.parse(row.data) as V1Data;
  const checks: ServiceCheck[] = [];
  const resources: ResourceSnapshot[] = [];

  for (const [serviceId, entry] of Object.entries(parsed.services)) {
    checks.push({
      id: row.id,
      service_id: serviceId,
      status: entry.status as ServiceCheck["status"],
      error: entry.error ?? null,
      checked_at: row.recordedAt,
    });

    if (entry.cpu_percent !== undefined) {
      resources.push({
        id: row.id,
        service_id: serviceId,
        cpu_percent: entry.cpu_percent ?? null,
        mem_used_bytes: entry.mem_used_bytes ?? null,
        mem_total_bytes: entry.mem_total_bytes ?? null,
        disk_used_bytes: entry.disk_used_bytes ?? null,
        disk_total_bytes: entry.disk_total_bytes ?? null,
        net_in_bytes: entry.net_in_bytes ?? null,
        net_out_bytes: entry.net_out_bytes ?? null,
        recorded_at: row.recordedAt,
      });
    }
  }

  return { checks, resources };
}

export function parseSnapshot(row: SnapshotRow): {
  checks: ServiceCheck[];
  resources: ResourceSnapshot[];
} {
  if (row.schemaVersion !== 1) {
    console.error(`unknown schema version: ${row.schemaVersion}`);
    return { checks: [], resources: [] };
  }
  return parseV1(row);
}
