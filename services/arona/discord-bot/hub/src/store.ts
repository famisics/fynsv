import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type ReminderRow = {
  id: number;
  guildId: string;
  channelId: string;
  userId: string;
  message: string;
  fireAt: number;
};

export type SessionRow = {
  userId: string;
  username: string;
  avatarUrl: string | null;
  // ログイン時に取得した、管理権限を持つギルド (表示用。操作の認可には使わない)
  guilds: SessionGuild[];
};

export type SessionGuild = { id: string; name: string; iconUrl: string | null };

const CURSOR_KEY = "misskey_last_note_id";

export class Store {
  private db: Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true, strict: true });
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run(`CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT NOT NULL,
      feature  TEXT NOT NULL,
      enabled  INTEGER NOT NULL,
      config   TEXT NOT NULL,
      PRIMARY KEY (guild_id, feature)
    )`);
    this.db.run(`CREATE TABLE IF NOT EXISTS reminders (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id   TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      message    TEXT NOT NULL,
      fire_at    INTEGER NOT NULL
    )`);
    this.db.run(`CREATE TABLE IF NOT EXISTS cursors (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`);
    this.db.run(`CREATE TABLE IF NOT EXISTS forwarded_notes (
      note_id  TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      PRIMARY KEY (note_id, guild_id)
    )`);
    this.db.run(`CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      user       TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )`);
  }

  getSetting(guildId: string, feature: string): { enabled: boolean; config: unknown } | null {
    const row = this.db
      .query<{ enabled: number; config: string }, [string, string]>(
        "SELECT enabled, config FROM guild_settings WHERE guild_id = ? AND feature = ?",
      )
      .get(guildId, feature);
    return row ? { enabled: row.enabled === 1, config: JSON.parse(row.config) } : null;
  }

  setSetting(guildId: string, feature: string, enabled: boolean, config: unknown) {
    this.db
      .query(
        `INSERT INTO guild_settings (guild_id, feature, enabled, config) VALUES (?, ?, ?, ?)
         ON CONFLICT(guild_id, feature) DO UPDATE SET enabled = excluded.enabled, config = excluded.config`,
      )
      .run(guildId, feature, enabled ? 1 : 0, JSON.stringify(config));
  }

  // 保存済みの行だけを返す。未保存のギルドは既定値の扱いになるので含まれない
  listSettings(feature: string): { guildId: string; enabled: boolean; config: unknown }[] {
    return this.db
      .query<{ guild_id: string; enabled: number; config: string }, [string]>(
        "SELECT guild_id, enabled, config FROM guild_settings WHERE feature = ?",
      )
      .all(feature)
      .map((r) => ({ guildId: r.guild_id, enabled: r.enabled === 1, config: JSON.parse(r.config) }));
  }

  addReminder(r: Omit<ReminderRow, "id">): number {
    const res = this.db
      .query(
        "INSERT INTO reminders (guild_id, channel_id, user_id, message, fire_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(r.guildId, r.channelId, r.userId, r.message, r.fireAt);
    return Number(res.lastInsertRowid);
  }

  private toReminder(r: {
    id: number;
    guild_id: string;
    channel_id: string;
    user_id: string;
    message: string;
    fire_at: number;
  }): ReminderRow {
    return {
      id: r.id,
      guildId: r.guild_id,
      channelId: r.channel_id,
      userId: r.user_id,
      message: r.message,
      fireAt: r.fire_at,
    };
  }

  // 発火時に行を取り出して消す。削除済み (管理画面から取り消された) なら null
  takeReminder(id: number): ReminderRow | null {
    const row = this.db
      .query<Parameters<Store["toReminder"]>[0], [number]>("DELETE FROM reminders WHERE id = ? RETURNING *")
      .get(id);
    return row ? this.toReminder(row) : null;
  }

  deleteReminder(id: number, guildId: string): boolean {
    const res = this.db.query("DELETE FROM reminders WHERE id = ? AND guild_id = ?").run(id, guildId);
    return res.changes > 0;
  }

  listReminders(guildId: string): ReminderRow[] {
    return this.db
      .query<Parameters<Store["toReminder"]>[0], [string]>(
        "SELECT * FROM reminders WHERE guild_id = ? ORDER BY fire_at",
      )
      .all(guildId)
      .map((r) => this.toReminder(r));
  }

  listAllReminders(): ReminderRow[] {
    return this.db
      .query<Parameters<Store["toReminder"]>[0], []>("SELECT * FROM reminders")
      .all()
      .map((r) => this.toReminder(r));
  }

  countUserReminders(userId: string): number {
    const row = this.db
      .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM reminders WHERE user_id = ?")
      .get(userId);
    return row?.n ?? 0;
  }

  getCursor(): string | null {
    const row = this.db
      .query<{ value: string }, [string]>("SELECT value FROM cursors WHERE key = ?")
      .get(CURSOR_KEY);
    return row?.value ?? null;
  }

  setCursor(noteId: string) {
    this.db
      .query(
        "INSERT INTO cursors (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(CURSOR_KEY, noteId);
  }

  isForwarded(noteId: string, guildId: string): boolean {
    return (
      this.db
        .query("SELECT 1 FROM forwarded_notes WHERE note_id = ? AND guild_id = ?")
        .get(noteId, guildId) !== null
    );
  }

  markForwarded(noteId: string, guildId: string) {
    this.db
      .query("INSERT OR IGNORE INTO forwarded_notes (note_id, guild_id) VALUES (?, ?)")
      .run(noteId, guildId);
  }

  createSession(id: string, session: SessionRow, expiresAt: number) {
    this.db
      .query("INSERT INTO sessions (id, user, expires_at) VALUES (?, ?, ?)")
      .run(id, JSON.stringify(session), expiresAt);
  }

  getSession(id: string, now: number): SessionRow | null {
    const row = this.db
      .query<{ user: string }, [string, number]>("SELECT user FROM sessions WHERE id = ? AND expires_at > ?")
      .get(id, now);
    return row ? (JSON.parse(row.user) as SessionRow) : null;
  }

  deleteSession(id: string) {
    this.db.query("DELETE FROM sessions WHERE id = ?").run(id);
  }

  deleteExpiredSessions(now: number) {
    this.db.query("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  }
}
