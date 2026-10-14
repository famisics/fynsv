import { z } from "zod";
import { DAY_MS, JST_OFFSET_MS, jstParts } from "./jst.ts";

// 繰り返し無しは null。時刻は予約の fireAt (JST) の時刻をそのまま使う
export const repeatSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("daily") }),
  // days は 0 (日) 〜 6 (土)
  z.object({ type: z.literal("weekly"), days: z.array(z.number().int().min(0).max(6)).min(1).max(7) }),
  // 存在しない日 (31 日など) の月は末日に送る
  z.object({ type: z.literal("monthly"), day: z.number().int().min(1).max(31) }),
]);
export type Repeat = z.infer<typeof repeatSchema>;

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export function formatRepeat(repeat: Repeat | null): string {
  if (!repeat) return "";
  if (repeat.type === "daily") return "毎日";
  if (repeat.type === "weekly") return `毎週 ${repeat.days.map((d) => WEEKDAYS[d]).join("・")}`;
  return `毎月 ${repeat.day} 日`;
}

function matches(repeat: Repeat, year: number, month: number, day: number, weekday: number): boolean {
  if (repeat.type === "daily") return true;
  if (repeat.type === "weekly") return repeat.days.includes(weekday);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day === Math.min(repeat.day, lastDay);
}

// base の時刻 (JST) で、after より後になる最初の発火時刻を返す
export function nextOccurrence(repeat: Repeat, base: number, after: number): number {
  const { hour, minute } = jstParts(base);
  const timeOfDay = (hour * 60 + minute) * 60_000;
  const firstDay = Math.floor((Math.max(base, after) + JST_OFFSET_MS) / DAY_MS) * DAY_MS - JST_OFFSET_MS;
  for (let i = 0; ; i++) {
    const midnight = firstDay + i * DAY_MS;
    const t = midnight + timeOfDay;
    const p = jstParts(midnight);
    if (t > after && matches(repeat, p.year, p.month, p.day, p.weekday)) return t;
  }
}

// 画面や /remind から受けた繰り返しを、保存する形にそろえる。
// 毎月の日付は最初の日時の日にそろえ、毎週の曜日は重複を除いて並べる
export function normalizeRepeat(repeat: Repeat | null, fireAt: number): Repeat | null {
  if (!repeat) return null;
  if (repeat.type === "weekly") return { type: "weekly", days: [...new Set(repeat.days)].sort() };
  if (repeat.type === "monthly") return { type: "monthly", day: jstParts(fireAt).day };
  return repeat;
}

// 最初の日時が繰り返しの条件に合わないとき (曜日が違うなど) は、次に合う日時にずらす
export function alignFirstFire(repeat: Repeat | null, fireAt: number): number {
  return repeat ? nextOccurrence(repeat, fireAt, fireAt - 1) : fireAt;
}
