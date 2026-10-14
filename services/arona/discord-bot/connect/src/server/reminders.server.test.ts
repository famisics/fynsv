import { beforeEach, describe, expect, test } from "bun:test";
import type { Gateway, SendCheck } from "./discord.server.ts";
import { MAX_PENDING_PER_USER } from "./features/reminder.ts";
import { saveReminder } from "./reminders.server.ts";
import { type ReminderRow, Store } from "./store.server.ts";
import type { ReminderBody } from "../shared/features.ts";

const now = 1_000_000;
const body: ReminderBody = { channelId: "10000000000000001", message: "hello", fireAt: now + 60_000, repeat: null };

let store: Store;
let send: SendCheck;
let scheduled: ReminderRow[];

const save = (reminderId: number | null = null, userId = "user1", guildId = "g1", b = body) =>
  saveReminder(
    { store, gateway: { checkSendable: async () => send } as unknown as Gateway, onSaved: (r) => scheduled.push(r) },
    guildId,
    userId,
    b,
    reminderId,
    now,
  );

beforeEach(() => {
  store = new Store(":memory:");
  send = "ok";
  scheduled = [];
});

describe("新規作成", () => {
  test("保存してタイマーを張る", async () => {
    expect((await save()).ok).toBe(true);
    expect(store.listReminders("g1")).toHaveLength(1);
    expect(scheduled[0]).toMatchObject({ userId: "user1", message: "hello" });
  });

  test("過去の時刻は保存しない", async () => {
    expect((await save(null, "user1", "g1", { ...body, fireAt: now })).ok).toBe(false);
    expect(store.listReminders("g1")).toHaveLength(0);
  });

  test.each(["unknown_channel", "user_forbidden", "bot_forbidden"] as const)("送信できないチャンネル (%s) は保存しない", async (reason) => {
    send = reason;
    expect((await save()).ok).toBe(false);
    expect(store.listReminders("g1")).toHaveLength(0);
  });

  test("1 人の上限を超えると保存しない", async () => {
    for (let i = 0; i < MAX_PENDING_PER_USER; i++) await save();
    expect((await save()).ok).toBe(false);
    expect(store.countUserReminders("user1")).toBe(MAX_PENDING_PER_USER);
  });
});

describe("更新", () => {
  test("内容を書き換え、作成者はそのままにしてタイマーを張り直す", async () => {
    await save();
    const id = store.listReminders("g1")[0]?.id as number;
    expect((await save(id, "admin2", "g1", { ...body, message: "changed" })).ok).toBe(true);
    expect(store.listReminders("g1")[0]).toMatchObject({ message: "changed", userId: "user1" });
    expect(scheduled.at(-1)).toMatchObject({ id, message: "changed" });
  });

  test("別ギルドの予約や、送信済みで消えた予約は更新できない", async () => {
    await save();
    const id = store.listReminders("g1")[0]?.id as number;
    expect((await save(id, "user1", "g2")).ok).toBe(false);
    expect((await save(id + 1)).ok).toBe(false);
  });

  test("更新でも過去の時刻は保存しない", async () => {
    await save();
    const id = store.listReminders("g1")[0]?.id as number;
    expect((await save(id, "user1", "g1", { ...body, fireAt: now - 1 })).ok).toBe(false);
    expect(store.listReminders("g1")[0]?.fireAt).toBe(body.fireAt);
  });
});

describe("繰り返し", () => {
  // 2026-06-24 (水) 20:00 JST を最初の日時にする
  const wed = Date.UTC(2026, 5, 24, 11, 0);
  const at = (repeat: ReminderBody["repeat"]) => ({ ...body, fireAt: wed, repeat });
  const saveAt = (repeat: ReminderBody["repeat"]) =>
    saveReminder(
      { store, gateway: { checkSendable: async () => "ok" } as unknown as Gateway, onSaved: (r) => scheduled.push(r) },
      "g1",
      "user1",
      at(repeat),
      null,
      wed - 1,
    );

  test("毎月の日付は最初の日時の日になる", async () => {
    await saveAt({ type: "monthly", day: 1 });
    expect(store.listReminders("g1")[0]?.repeat).toEqual({ type: "monthly", day: 24 });
  });

  test("最初の日時の曜日が毎週の条件に合わなければ、次に合う日にずらす", async () => {
    await saveAt({ type: "weekly", days: [5] });
    expect(store.listReminders("g1")[0]?.fireAt).toBe(Date.UTC(2026, 5, 26, 11, 0));
  });
});
