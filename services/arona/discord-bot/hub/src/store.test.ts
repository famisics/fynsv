import { describe, expect, test } from "bun:test";
import { Store } from "./store.ts";

const reminder = { guildId: "g1", channelId: "c1", userId: "u1", message: "m", fireAt: 1000 };

describe("reminders", () => {
  test("takeReminder は 1 回だけ取り出せる", () => {
    const store = new Store(":memory:");
    const id = store.addReminder(reminder);
    expect(store.takeReminder(id)?.message).toBe("m");
    expect(store.takeReminder(id)).toBeNull();
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
