import type { ResourceSnapshot, ServiceCheck } from "./types";

interface SnapshotRow {
  id: number;
  schema_version: number;
  data: string;
  recorded_at: string;
}

interface V1ServiceEntry {
  status: string;
  latency_ms: number;
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

function parseV1(
  row: SnapshotRow,
): { checks: ServiceCheck[]; resources: ResourceSnapshot[] } {
  const parsed = JSON.parse(row.data) as V1Data;
  const checks: ServiceCheck[] = [];
  const resources: ResourceSnapshot[] = [];

  for (const [serviceId, entry] of Object.entries(parsed.services)) {
    checks.push({
      id: row.id,
      service_id: serviceId,
      status: entry.status as ServiceCheck["status"],
      latency_ms: entry.latency_ms ?? null,
      error: entry.error ?? null,
      checked_at: row.recorded_at,
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
        recorded_at: row.recorded_at,
      });
    }
  }

  return { checks, resources };
}

const parsers: Record<
  number,
  (row: SnapshotRow) => { checks: ServiceCheck[]; resources: ResourceSnapshot[] }
> = {
  1: parseV1,
};

export function parseSnapshot(
  row: SnapshotRow,
): { checks: ServiceCheck[]; resources: ResourceSnapshot[] } {
  const parser = parsers[row.schema_version];
  if (!parser) {
    console.error(`unknown schema version: ${row.schema_version}`);
    return { checks: [], resources: [] };
  }
  return parser(row);
}

export function parseSnapshots(rows: SnapshotRow[]): {
  checks: ServiceCheck[];
  resources: ResourceSnapshot[];
} {
  const checks: ServiceCheck[] = [];
  const resources: ResourceSnapshot[] = [];
  for (const row of rows) {
    const parsed = parseSnapshot(row);
    checks.push(...parsed.checks);
    resources.push(...parsed.resources);
  }
  return { checks, resources };
}

export type { SnapshotRow };
