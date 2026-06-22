import { desc, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import type { Service } from "../config";
import * as schema from "./schema";
import { serviceMeta, snapshots } from "./schema";

const db = drizzle({
  connection: {
    url: process.env.TURSO_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  },
  schema,
});

export const SCHEMA_VERSION = 1;

export async function initDb(): Promise<void> {
  await db.run(sql`CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schema_version INTEGER NOT NULL,
    data TEXT NOT NULL,
    recorded_at TEXT NOT NULL
  )`);
  await db.run(
    sql`CREATE INDEX IF NOT EXISTS idx_snapshots_time ON snapshots(recorded_at)`,
  );
  await db.run(sql`CREATE TABLE IF NOT EXISTS service_meta (
    version INTEGER PRIMARY KEY AUTOINCREMENT,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
}

export async function syncServiceMeta(services: Service[]): Promise<void> {
  const meta: Record<string, { name: string; category: string }> = {};
  for (const s of services) {
    meta[s.id] = { name: s.name, category: s.category };
  }
  const newData = JSON.stringify(meta);

  const rows = await db
    .select({ data: serviceMeta.data })
    .from(serviceMeta)
    .orderBy(desc(serviceMeta.version))
    .limit(1);

  if (rows[0]?.data === newData) return;

  await db.insert(serviceMeta).values({
    data: newData,
    createdAt: new Date().toISOString(),
  });
  console.log("service_meta updated");
}

export async function insertSnapshot(
  data: Record<string, unknown>,
  recordedAt: string,
): Promise<void> {
  await db.insert(snapshots).values({
    schemaVersion: SCHEMA_VERSION,
    data: JSON.stringify(data),
    recordedAt,
  });
}

export async function cleanOldRecords(retentionDays = 90): Promise<void> {
  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
  await db.delete(snapshots).where(lt(snapshots.recordedAt, cutoff));
}
