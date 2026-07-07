import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  and,
  asc,
  desc,
  gte,
  type InferInsertModel,
  type InferSelectModel,
  lt,
  max,
  min,
  sql,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { Service } from "../config";
import * as schema from "./schema";
import { rollups30m, serviceMeta, snapshots } from "./schema";

export type SnapshotRow = InferSelectModel<typeof snapshots>;
export type RollupRow = InferInsertModel<typeof rollups30m>;

const db = drizzle({
  connection: {
    url: process.env.TURSO_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  },
  schema,
});

export const SCHEMA_VERSION = 1;

const migrationsFolder = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../drizzle",
);

export async function initDb(): Promise<void> {
  await migrate(db, { migrationsFolder });
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
    recordedAtMs: Date.parse(recordedAt),
  });
}

export async function cleanOldRecords(retentionDays = 90): Promise<void> {
  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
  await db.delete(snapshots).where(lt(snapshots.recordedAt, cutoff));
}

export async function selectSnapshotsInRange(
  startMs: number,
  endMs: number,
): Promise<SnapshotRow[]> {
  return db
    .select()
    .from(snapshots)
    .where(
      and(gte(snapshots.recordedAtMs, startMs), lt(snapshots.recordedAtMs, endMs)),
    )
    .orderBy(asc(snapshots.recordedAtMs));
}

export async function upsertRollups(rows: RollupRow[]): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(rollups30m)
    .values(rows)
    .onConflictDoUpdate({
      target: [rollups30m.bucketMs, rollups30m.serviceId],
      set: {
        upCount: sql`excluded.up_count`,
        downCount: sql`excluded.down_count`,
        sampleCount: sql`excluded.sample_count`,
        resourceCount: sql`excluded.resource_count`,
        cpuSum: sql`excluded.cpu_sum`,
        memUsedSum: sql`excluded.mem_used_sum`,
        memTotalSum: sql`excluded.mem_total_sum`,
        diskUsedSum: sql`excluded.disk_used_sum`,
        diskTotalSum: sql`excluded.disk_total_sum`,
        netInSum: sql`excluded.net_in_sum`,
        netOutSum: sql`excluded.net_out_sum`,
      },
    });
}

export async function getRollupWatermark(): Promise<number | null> {
  const rows = await db.select({ ms: max(rollups30m.bucketMs) }).from(rollups30m);
  return rows[0]?.ms ?? null;
}

export async function getFirstSnapshotMs(): Promise<number | null> {
  const rows = await db.select({ ms: min(snapshots.recordedAtMs) }).from(snapshots);
  return rows[0]?.ms ?? null;
}
