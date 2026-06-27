import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { desc, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
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
