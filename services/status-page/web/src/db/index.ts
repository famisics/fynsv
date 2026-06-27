import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

let _db: LibSQLDatabase<typeof schema> | null = null;

export function getDb() {
  if (!_db) {
    _db = drizzle({
      connection: {
        url: process.env.TURSO_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN!,
      },
      schema,
    });
  }
  return _db;
}
