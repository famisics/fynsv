import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "./store.server.ts";

const reminder = { guildId: "g1", channelId: "c1", userId: "u1", message: "m", fireAt: 1000, repeat: null };

describe("reminders", () => {
  test("updateReminder は同じギルドの予約だけ書き換える", () => {
    const store = new Store(":memory:");
    const id = store.addReminder(reminder);
    expect(store.updateReminder(id, "g2", { channelId: "c2", message: "x", fireAt: 1, repeat: null })).toBe(false);
    expect(store.updateReminder(id, "g1", { channelId: "c2", message: "x", fireAt: 2000, repeat: null })).toBe(true);
    expect(store.listReminders("g1")[0]).toMatchObject({ channelId: "c2", message: "x", fireAt: 2000, userId: "u1" });
  });

  test("繰り返しは保存・更新・読み出しで形が保たれ、setFireAt で次回に進む", () => {
    const store = new Store(":memory:");
    const id = store.addReminder({ ...reminder, repeat: { type: "weekly", days: [1, 3] } });
    expect(store.getReminder(id)?.repeat).toEqual({ type: "weekly", days: [1, 3] });
    store.setFireAt(id, 5000);
    expect(store.getReminder(id)).toMatchObject({ fireAt: 5000, repeat: { type: "weekly", days: [1, 3] } });
    store.updateReminder(id, "g1", { channelId: "c1", message: "m", fireAt: 5000, repeat: null });
    expect(store.getReminder(id)?.repeat).toBeNull();
  });

  test("deleteReminderById の後は getReminder が null", () => {
    const store = new Store(":memory:");
    const id = store.addReminder(reminder);
    store.deleteReminderById(id);
    expect(store.getReminder(id)).toBeNull();
  });

  test("deleteReminder は別ギルドの予約を消さない", () => {
    const store = new Store(":memory:");
    const id = store.addReminder(reminder);
    expect(store.deleteReminder(id, "other")).toBe(false);
    expect(store.listReminders("g1")).toHaveLength(1);
    expect(store.deleteReminder(id, "g1")).toBe(true);
  });

  test("ユーザーごとの件数を数える", () => {
    const store = new Store(":memory:");
    store.addReminder(reminder);
    store.addReminder({ ...reminder, userId: "u2" });
    expect(store.countUserReminders("u1")).toBe(1);
  });
});

test("セッションは期限が切れると取得できない", () => {
  const store = new Store(":memory:");
  store.createSession("s", { userId: "u", username: "n", avatarUrl: null, guilds: [] }, 2000);
  expect(store.getSession("s", 1999)?.userId).toBe("u");
  expect(store.getSession("s", 2000)).toBeNull();
});

test("転送済みの記録はノートとギルドの組ごとに持つ", () => {
  const store = new Store(":memory:");
  store.markForwarded("n1", "g1");
  expect(store.isForwarded("n1", "g1")).toBe(true);
  expect(store.isForwarded("n1", "g2")).toBe(false);
});

describe("マイグレーション", () => {
  test("repeat 列が無い既存の DB を開くと列を足し、既存の予約は繰り返し無しになる", () => {
    const path = join(mkdtempSync(join(tmpdir(), "store-")), "old.db");
    const old = new Database(path, { create: true });
    old.run(`CREATE TABLE reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL,
      user_id TEXT NOT NULL, message TEXT NOT NULL, fire_at INTEGER NOT NULL)`);
    old.run("INSERT INTO reminders (guild_id, channel_id, user_id, message, fire_at) VALUES ('g1','c1','u1','m',1000)");
    old.close();

    const store = new Store(path);
    expect(store.listReminders("g1")[0]).toMatchObject({ message: "m", repeat: null });
    // 2 回目に開いても列の追加で失敗しない
    expect(() => new Store(path)).not.toThrow();
  });
});
