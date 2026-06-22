import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const snapshots = sqliteTable("snapshots", {
  id: integer().primaryKey({ autoIncrement: true }),
  schemaVersion: integer("schema_version").notNull(),
  data: text().notNull(),
  recordedAt: text("recorded_at").notNull(),
});

export const serviceMeta = sqliteTable("service_meta", {
  version: integer().primaryKey({ autoIncrement: true }),
  data: text().notNull(),
  createdAt: text("created_at").notNull(),
});
