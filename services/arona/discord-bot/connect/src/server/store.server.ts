import { type SQLQueryBindings, Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Repeat } from "../shared/repeat.ts";

export type ReminderRow = {
  id: number;
  guildId: string;
  channelId: string;
  userId: string;
  message: string;
  fireAt: number;
  repeat: Repeat | null;
};

export type SessionRow = {
  userId: string;
  username: string;
  avatarUrl: string | null;
  // ログイン時に取得した、管理権限を持つギルド (表示用。操作の認可には使わない)
  guilds: SessionGuild[];
};

export type SessionGuild = { id: string; name: string; iconUrl: string | null };

type DbReminder = {
  id: number;
  guild_id: string;
  channel_id: string;
  user_id: string;
  message: string;
  fire_at: number;
  repeat: string | null;
};

const CURSOR_KEY = "misskey_last_note_id";

export class Store {
  private db: Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true, strict: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT NOT NULL,
      feature  TEXT NOT NULL,
      enabled  INTEGER NOT NULL,
      config   TEXT NOT NULL,
      PRIMARY KEY (guild_id, feature)
    )`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS reminders (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id   TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      message    TEXT NOT NULL,
      fire_at    INTEGER NOT NULL,
      repeat     TEXT
    )`);
    // repeat 列を足す前に作られた DB には、列を後から足す
    if (!this.many<{ name: string }>("PRAGMA table_info(reminders)").some((c) => c.name === "repeat")) {
      this.db.exec("ALTER TABLE reminders ADD COLUMN repeat TEXT");
    }
    this.db.exec(`CREATE TABLE IF NOT EXISTS cursors (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS forwarded_notes (
      note_id  TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      PRIMARY KEY (note_id, guild_id)
    )`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      user       TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )`);
  }

  // 呼び出し側で行の形を指定する
  private one<T>(sql: string, ...params: SQLQueryBindings[]): T | null {
    return this.db.prepare(sql).get(...params) as T | null;
  }

  private many<T>(sql: string, ...params: SQLQueryBindings[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  getSetting(guildId: string, feature: string): { enabled: boolean; config: unknown } | null {
    const row = this.one<{ enabled: number; config: string }>(
      "SELECT enabled, config FROM guild_settings WHERE guild_id = ? AND feature = ?",
      guildId,
      feature,
    );
    return row ? { enabled: row.enabled === 1, config: JSON.parse(row.config) } : null;
  }

  setSetting(guildId: string, feature: string, enabled: boolean, config: unknown) {
    this.db
      .prepare(
        `INSERT INTO guild_settings (guild_id, feature, enabled, config) VALUES (?, ?, ?, ?)
         ON CONFLICT(guild_id, feature) DO UPDATE SET enabled = excluded.enabled, config = excluded.config`,
      )
      .run(guildId, feature, enabled ? 1 : 0, JSON.stringify(config));
  }

  // 保存済みの行だけを返す。未保存のギルドは既定値の扱いになるので含まれない
  listSettings(feature: string): { guildId: string; enabled: boolean; config: unknown }[] {
    return this.many<{ guild_id: string; enabled: number; config: string }>(
      "SELECT guild_id, enabled, config FROM guild_settings WHERE feature = ?",
      feature,
    ).map((r) => ({ guildId: r.guild_id, enabled: r.enabled === 1, config: JSON.parse(r.config) }));
  }

  addReminder(r: Omit<ReminderRow, "id">): number {
    const res = this.db
      .prepare(
        "INSERT INTO reminders (guild_id, channel_id, user_id, message, fire_at, repeat) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(r.guildId, r.channelId, r.userId, r.message, r.fireAt, r.repeat && JSON.stringify(r.repeat));
    return Number(res.lastInsertRowid);
  }

  private toReminder(r: DbReminder): ReminderRow {
    return {
      id: r.id,
      guildId: r.guild_id,
      channelId: r.channel_id,
      userId: r.user_id,
      message: r.message,
      fireAt: r.fire_at,
      repeat: r.repeat ? (JSON.parse(r.repeat) as Repeat) : null,
    };
  }

  // 発火時に読む。削除済み (管理画面から取り消された) なら null
  getReminder(id: number): ReminderRow | null {
    const row = this.one<DbReminder>("SELECT * FROM reminders WHERE id = ?", id);
    return row ? this.toReminder(row) : null;
  }

  // 繰り返しの予約を、次の発火時刻に進める
  setFireAt(id: number, fireAt: number) {
    this.db.prepare("UPDATE reminders SET fire_at = ? WHERE id = ?").run(fireAt, id);
  }

  deleteReminderById(id: number) {
    this.db.prepare("DELETE FROM reminders WHERE id = ?").run(id);
  }

  updateReminder(
    id: number,
    guildId: string,
    fields: Pick<ReminderRow, "channelId" | "message" | "fireAt" | "repeat">,
  ): boolean {
    const res = this.db
      .prepare("UPDATE reminders SET channel_id = ?, message = ?, fire_at = ?, repeat = ? WHERE id = ? AND guild_id = ?")
      .run(fields.channelId, fields.message, fields.fireAt, fields.repeat && JSON.stringify(fields.repeat), id, guildId);
    return res.changes > 0;
  }

  deleteReminder(id: number, guildId: string): boolean {
    const res = this.db.prepare("DELETE FROM reminders WHERE id = ? AND guild_id = ?").run(id, guildId);
    return res.changes > 0;
  }

  listReminders(guildId: string): ReminderRow[] {
    return this.many<DbReminder>("SELECT * FROM reminders WHERE guild_id = ? ORDER BY fire_at", guildId).map((r) =>
      this.toReminder(r),
    );
  }

  listAllReminders(): ReminderRow[] {
    return this.many<DbReminder>("SELECT * FROM reminders").map((r) => this.toReminder(r));
  }

  countUserReminders(userId: string): number {
    const row = this.one<{ n: number }>("SELECT COUNT(*) AS n FROM reminders WHERE user_id = ?", userId);
    return row?.n ?? 0;
  }

  getCursor(): string | null {
    return this.one<{ value: string }>("SELECT value FROM cursors WHERE key = ?", CURSOR_KEY)?.value ?? null;
  }

  setCursor(noteId: string) {
    this.db
      .prepare(
        "INSERT INTO cursors (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(CURSOR_KEY, noteId);
  }

  isForwarded(noteId: string, guildId: string): boolean {
    return (
      this.one("SELECT 1 FROM forwarded_notes WHERE note_id = ? AND guild_id = ?", noteId, guildId) !== null
    );
  }

  markForwarded(noteId: string, guildId: string) {
    this.db
      .prepare("INSERT OR IGNORE INTO forwarded_notes (note_id, guild_id) VALUES (?, ?)")
      .run(noteId, guildId);
  }

  createSession(id: string, session: SessionRow, expiresAt: number) {
    this.db
      .prepare("INSERT INTO sessions (id, user, expires_at) VALUES (?, ?, ?)")
      .run(id, JSON.stringify(session), expiresAt);
  }

  getSession(id: string, now: number): SessionRow | null {
    const row = this.one<{ user: string }>("SELECT user FROM sessions WHERE id = ? AND expires_at > ?", id, now);
    return row ? (JSON.parse(row.user) as SessionRow) : null;
  }

  deleteSession(id: string) {
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }

  deleteExpiredSessions(now: number) {
    this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  }
}
