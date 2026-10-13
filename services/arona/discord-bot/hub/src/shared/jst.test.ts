import { describe, expect, test } from "bun:test";
import { formatJst, parseJst } from "./jst.ts";

// 2026-06-24 12:00 JST
const now = Date.UTC(2026, 5, 24, 3, 0);
const jst = (y: number, mo: number, d: number, h: number, mi: number) => Date.UTC(y, mo - 1, d, h - 9, mi);

describe("parseJst", () => {
  test("時刻のみで未来なら当日", () => {
    expect(parseJst("15:00", now)).toBe(jst(2026, 6, 24, 15, 0));
  });

  test("時刻のみで過去なら翌日", () => {
    expect(parseJst("09:30", now)).toBe(jst(2026, 6, 25, 9, 30));
  });

  test("現在と同じ時刻はそのまま返す", () => {
    expect(parseJst("12:00", now)).toBe(now);
  });

  test("日付つきで未来なら今年", () => {
    expect(parseJst("06/30 08:00", now)).toBe(jst(2026, 6, 30, 8, 0));
  });

  test("日付つきで過去なら翌年", () => {
    expect(parseJst("01/02 03:04", now)).toBe(jst(2027, 1, 2, 3, 4));
  });

  test("0 時台は JST の日付で解釈する (UTC では前日)", () => {
    expect(parseJst("06/25 00:30", now)).toBe(jst(2026, 6, 25, 0, 30));
  });

  test("存在しない日付・時刻は拒否する", () => {
    expect(parseJst("02/30 10:00", now)).toBeNull();
    expect(parseJst("25:00", now)).toBeNull();
    expect(parseJst("10:61", now)).toBeNull();
  });

  test("閏日は今年か翌年が閏年のときだけ解釈できる", () => {
    // 2026 年も翌年の 2027 年も閏年ではない
    expect(parseJst("02/29 10:00", now)).toBeNull();
    // 2027 年末なら、翌年の 2028 年が閏年
    expect(parseJst("02/29 10:00", Date.UTC(2027, 11, 31))).toBe(jst(2028, 2, 29, 10, 0));
  });

  test("未対応の形式は拒否する", () => {
    expect(parseJst("明日 10:00", now)).toBeNull();
    expect(parseJst("2026/06/30 10:00", now)).toBeNull();
  });
});

test("formatJst は JST の MM/DD HH:mm を返す", () => {
  expect(formatJst(jst(2026, 6, 5, 7, 8))).toBe("06/05 07:08");
});
