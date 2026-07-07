import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const snapshots = sqliteTable(
  "snapshots",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    schemaVersion: integer("schema_version").notNull(),
    data: text().notNull(),
    recordedAt: text("recorded_at").notNull(),
    recordedAtMs: integer("recorded_at_ms").notNull(),
  },
  (t) => [
    index("idx_snapshots_time").on(t.recordedAt),
    index("idx_snapshots_ms").on(t.recordedAtMs),
  ],
);

export const rollups30m = sqliteTable(
  "rollups_30m",
  {
    bucketMs: integer("bucket_ms").notNull(),
    serviceId: text("service_id").notNull(),
    upCount: integer("up_count").notNull(),
    downCount: integer("down_count").notNull(),
    sampleCount: integer("sample_count").notNull(),
    resourceCount: integer("resource_count").notNull(),
    cpuSum: real("cpu_sum"),
    memUsedSum: real("mem_used_sum"),
    memTotalSum: real("mem_total_sum"),
    diskUsedSum: real("disk_used_sum"),
    diskTotalSum: real("disk_total_sum"),
    netInSum: real("net_in_sum"),
    netOutSum: real("net_out_sum"),
  },
  (t) => [primaryKey({ columns: [t.bucketMs, t.serviceId] })],
);

export const serviceMeta = sqliteTable("service_meta", {
  version: integer().primaryKey({ autoIncrement: true }),
  data: text().notNull(),
  createdAt: text("created_at").notNull(),
});
