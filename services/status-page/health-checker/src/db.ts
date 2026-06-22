import { createClient } from "@libsql/client";
import type { Service } from "./config";

const client = createClient({
  url: process.env.TURSO_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

export const SCHEMA_VERSION = 1;

export async function initDb(): Promise<void> {
  await client.batch(
    [
      `CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        schema_version INTEGER NOT NULL,
        data TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_snapshots_time ON snapshots(recorded_at)`,
      `CREATE TABLE IF NOT EXISTS service_meta (
        version INTEGER PRIMARY KEY AUTOINCREMENT,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
    ],
    "write",
  );
}

export async function syncServiceMeta(services: Service[]): Promise<void> {
  const meta: Record<string, { name: string; category: string }> = {};
  for (const s of services) {
    meta[s.id] = { name: s.name, category: s.category };
  }
  const newData = JSON.stringify(meta);

  const res = await client.execute(
    `SELECT data FROM service_meta ORDER BY version DESC LIMIT 1`,
  );
  const current = res.rows[0]?.data as string | undefined;
  if (current === newData) return;

  await client.execute({
    sql: `INSERT INTO service_meta (data, created_at) VALUES (?, ?)`,
    args: [newData, new Date().toISOString()],
  });
  console.log("service_meta updated");
}

export async function insertSnapshot(
  data: Record<string, unknown>,
  recordedAt: string,
): Promise<void> {
  await client.execute({
    sql: `INSERT INTO snapshots (schema_version, data, recorded_at) VALUES (?, ?, ?)`,
    args: [SCHEMA_VERSION, JSON.stringify(data), recordedAt],
  });
}

export async function cleanOldRecords(retentionDays = 90): Promise<void> {
  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
  await client.execute({
    sql: `DELETE FROM snapshots WHERE recorded_at < ?`,
    args: [cutoff],
  });
}
