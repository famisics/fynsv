import type { Gateway } from "./discord.server.ts";
import { MAX_PENDING_PER_USER } from "./features/reminder.ts";
import type { ReminderRow, Store } from "./store.server.ts";
import type { ReminderBody } from "../shared/features.ts";
import { alignFirstFire, normalizeRepeat } from "../shared/repeat.ts";

export type SaveReminderResult = { ok: true } | { ok: false; message: string };

type Deps = {
  store: Store;
  gateway: Gateway;
  // 保存した予約のタイマーを張り直す
  onSaved: (row: ReminderRow) => void;
};

const SEND_ERRORS = {
  unknown_channel: "このサーバーに存在しない (またはテキストチャンネルではない) チャンネルです",
  user_forbidden: "あなたがそのチャンネルに送信する権限がありません",
  bot_forbidden: "bot がそのチャンネルに送信する権限を持っていません",
} as const;

// reminderId があれば更新、なければ新規作成。作成者 (メンションされる人) は、更新では変えない
export async function saveReminder(
  { store, gateway, onSaved }: Deps,
  guildId: string,
  userId: string,
  body: ReminderBody,
  reminderId: number | null,
  now: number,
): Promise<SaveReminderResult> {
  if (body.fireAt <= now) return { ok: false, message: "過去の時刻は指定できません" };

  const send = await gateway.checkSendable(guildId, body.channelId, userId);
  if (send !== "ok") return { ok: false, message: SEND_ERRORS[send] };

  // 毎週・毎月の条件に合わない最初の日時は、次に合う日時にずらして保存する
  const repeat = normalizeRepeat(body.repeat, body.fireAt);
  const fields = { channelId: body.channelId, message: body.message, fireAt: alignFirstFire(repeat, body.fireAt), repeat };

  if (reminderId === null) {
    if (store.countUserReminders(userId) >= MAX_PENDING_PER_USER) {
      return { ok: false, message: `予約できるリマインダーは 1 人 ${MAX_PENDING_PER_USER} 件までです` };
    }
    const row = { guildId, userId, ...fields };
    onSaved({ ...row, id: store.addReminder(row) });
    return { ok: true };
  }

  const existing = store.listReminders(guildId).find((r) => r.id === reminderId);
  if (!existing || !store.updateReminder(reminderId, guildId, fields)) {
    return { ok: false, message: "リマインダーが見つかりません (すでに送信された可能性があります)" };
  }
  onSaved({ ...existing, ...fields });
  return { ok: true };
}
