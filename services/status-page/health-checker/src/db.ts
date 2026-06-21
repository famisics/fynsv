import { createClient } from "@libsql/client";
import type { CheckResult } from "./checks";
import type { ResourceStats } from "./proxmox";

const client = createClient({
  url: process.env.TURSO_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

export async function initDb(): Promise<void> {
  await client.batch(
    [
      `CREATE TABLE IF NOT EXISTS service_checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        service_id TEXT NOT NULL,
        status TEXT NOT NULL,
        latency_ms REAL,
        error TEXT,
        checked_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_checks_service_time ON service_checks(service_id, checked_at)`,
      `CREATE TABLE IF NOT EXISTS resource_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        service_id TEXT NOT NULL,
        cpu_percent REAL,
        mem_used_bytes INTEGER,
        mem_total_bytes INTEGER,
        disk_used_bytes INTEGER,
        disk_total_bytes INTEGER,
        net_in_bytes INTEGER,
        net_out_bytes INTEGER,
        recorded_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_resources_service_time ON resource_snapshots(service_id, recorded_at)`,
    ],
    "write",
  );
}

export async function insertCheckResult(
  serviceId: string,
  result: CheckResult,
  checkedAt: string,
): Promise<void> {
  await client.execute({
    sql: `INSERT INTO service_checks (service_id, status, latency_ms, error, checked_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [serviceId, result.status, result.latency_ms, result.error ?? null, checkedAt],
  });
}

export async function insertResourceSnapshot(
  serviceId: string,
  stats: ResourceStats,
  recordedAt: string,
): Promise<void> {
  await client.execute({
    sql: `INSERT INTO resource_snapshots
          (service_id, cpu_percent, mem_used_bytes, mem_total_bytes,
           disk_used_bytes, disk_total_bytes, net_in_bytes, net_out_bytes, recorded_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      serviceId,
      stats.cpu_percent,
      stats.mem_used_bytes,
      stats.mem_total_bytes,
      stats.disk_used_bytes,
      stats.disk_total_bytes,
      stats.net_in_bytes,
      stats.net_out_bytes,
      recordedAt,
    ],
  });
}

export async function cleanOldRecords(retentionDays = 90): Promise<void> {
  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
  await client.batch(
    [
      { sql: `DELETE FROM service_checks WHERE checked_at < ?`, args: [cutoff] },
      { sql: `DELETE FROM resource_snapshots WHERE recorded_at < ?`, args: [cutoff] },
    ],
    "write",
  );
}
