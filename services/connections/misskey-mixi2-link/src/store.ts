import { createClient, type Client } from "@libsql/client";

export type Direction = "misskey->mixi2" | "mixi2->misskey";

export class BridgeStore {
  private constructor(private readonly db: Client) {}

  static async open(url: string, authToken?: string): Promise<BridgeStore> {
    const db = createClient({ url, authToken });
    await db.batch(
      [
        `CREATE TABLE IF NOT EXISTS bridged_posts (
          direction  TEXT NOT NULL,
          source_id  TEXT NOT NULL,
          target_id  TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (direction, source_id)
        )`,
        `CREATE TABLE IF NOT EXISTS cursors (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )`,
      ],
      "write",
    );
    return new BridgeStore(db);
  }

  async isProcessed(direction: Direction, sourceId: string): Promise<boolean> {
    const res = await this.db.execute({
      sql: "SELECT 1 FROM bridged_posts WHERE direction = ? AND source_id = ?",
      args: [direction, sourceId],
    });
    return res.rows.length > 0;
  }

  async record(direction: Direction, sourceId: string, targetId: string): Promise<void> {
    await this.db.execute({
      sql: "INSERT OR IGNORE INTO bridged_posts (direction, source_id, target_id) VALUES (?, ?, ?)",
      args: [direction, sourceId, targetId],
    });
  }

  async getCursor(key: string): Promise<string | null> {
    const res = await this.db.execute({
      sql: "SELECT value FROM cursors WHERE key = ?",
      args: [key],
    });
    return (res.rows[0]?.value as string | undefined) ?? null;
  }

  async setCursor(key: string, value: string): Promise<void> {
    await this.db.execute({
      sql: "INSERT INTO cursors (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      args: [key, value],
    });
  }

  close(): void {
    this.db.close();
  }
}
