import { describe, expect, test } from "bun:test";
import { type Repeat, alignFirstFire, formatRepeat, nextOccurrence, normalizeRepeat } from "./repeat.ts";

const jst = (y: number, mo: number, d: number, h: number, mi: number) => Date.UTC(y, mo - 1, d, h - 9, mi);

describe("nextOccurrence", () => {
  test("毎日は翌日の同じ時刻", () => {
    const base = jst(2026, 6, 24, 9, 30);
    expect(nextOccurrence({ type: "daily" }, base, base)).toBe(jst(2026, 6, 25, 9, 30));
  });

  test("停止中に何日か過ぎていても、現在より後の最初の時刻に進む", () => {
    const base = jst(2026, 6, 24, 9, 30);
    const after = jst(2026, 6, 28, 12, 0);
    expect(nextOccurrence({ type: "daily" }, base, after)).toBe(jst(2026, 6, 29, 9, 30));
  });

  test("0 時台は JST の日付で進む", () => {
    const base = jst(2026, 6, 24, 0, 10);
    expect(nextOccurrence({ type: "daily" }, base, base)).toBe(jst(2026, 6, 25, 0, 10));
  });

  test("毎週は指定した曜日のうち次のもの (2026-06-24 は水曜)", () => {
    const base = jst(2026, 6, 24, 20, 0);
    const mwf: Repeat = { type: "weekly", days: [1, 3, 5] };
    expect(nextOccurrence(mwf, base, base)).toBe(jst(2026, 6, 26, 20, 0));
    expect(nextOccurrence(mwf, jst(2026, 6, 26, 20, 0), jst(2026, 6, 26, 20, 0))).toBe(jst(2026, 6, 29, 20, 0));
  });

  test("毎週で 1 曜日だけなら 1 週間後", () => {
    const base = jst(2026, 6, 24, 20, 0);
    expect(nextOccurrence({ type: "weekly", days: [3] }, base, base)).toBe(jst(2026, 7, 1, 20, 0));
  });

  test("毎月は翌月の同じ日", () => {
    const base = jst(2026, 6, 15, 8, 0);
    expect(nextOccurrence({ type: "monthly", day: 15 }, base, base)).toBe(jst(2026, 7, 15, 8, 0));
  });

  test("毎月 31 日は、31 日の無い月は末日に送り、次の月は 31 日に戻る", () => {
    const monthly = { type: "monthly", day: 31 } as const;
    expect(nextOccurrence(monthly, jst(2026, 3, 31, 8, 0), jst(2026, 3, 31, 8, 0))).toBe(jst(2026, 4, 30, 8, 0));
    expect(nextOccurrence(monthly, jst(2026, 4, 30, 8, 0), jst(2026, 4, 30, 8, 0))).toBe(jst(2026, 5, 31, 8, 0));
  });

  test("毎月 29 日は、うるう年でない 2 月は 28 日", () => {
    const monthly = { type: "monthly", day: 29 } as const;
    expect(nextOccurrence(monthly, jst(2026, 1, 29, 8, 0), jst(2026, 1, 29, 8, 0))).toBe(jst(2026, 2, 28, 8, 0));
    expect(nextOccurrence(monthly, jst(2028, 1, 29, 8, 0), jst(2028, 1, 29, 8, 0))).toBe(jst(2028, 2, 29, 8, 0));
  });

  test("年をまたぐ", () => {
    const monthly = { type: "monthly", day: 31 } as const;
    expect(nextOccurrence(monthly, jst(2026, 12, 31, 23, 0), jst(2026, 12, 31, 23, 0))).toBe(jst(2027, 1, 31, 23, 0));
  });
});

describe("normalizeRepeat / alignFirstFire", () => {
  test("毎月の日付は最初の日時の日にそろう", () => {
    expect(normalizeRepeat({ type: "monthly", day: 1 }, jst(2026, 6, 20, 9, 0))).toEqual({ type: "monthly", day: 20 });
  });

  test("毎週の曜日は重複を除いて並べる", () => {
    expect(normalizeRepeat({ type: "weekly", days: [5, 1, 5, 3] }, 0)).toEqual({ type: "weekly", days: [1, 3, 5] });
  });

  test("最初の日時の曜日が条件に合わなければ、次に合う日にずらす", () => {
    const wed = jst(2026, 6, 24, 20, 0);
    expect(alignFirstFire({ type: "weekly", days: [5] }, wed)).toBe(jst(2026, 6, 26, 20, 0));
    expect(alignFirstFire({ type: "weekly", days: [3] }, wed)).toBe(wed);
    expect(alignFirstFire(null, wed)).toBe(wed);
  });
});

test("formatRepeat", () => {
  expect(formatRepeat(null)).toBe("");
  expect(formatRepeat({ type: "daily" })).toBe("毎日");
  expect(formatRepeat({ type: "weekly", days: [1, 3] })).toBe("毎週 月・水");
  expect(formatRepeat({ type: "monthly", day: 31 })).toBe("毎月 31 日");
});
