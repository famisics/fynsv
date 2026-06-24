import { describe, expect, it } from "bun:test";
import { formatForMixi2, hasMention, stripMention, MIXI2_MAX_POST_LENGTH } from "../src/bridge/text.js";

const URL = "https://misskey.example.com/notes/abcdef123";

describe("formatForMixi2", () => {
  it("上限以下はそのまま返す", () => {
    expect(formatForMixi2("こんにちは", URL)).toBe("こんにちは");
  });

  it("ちょうど上限はそのまま返す", () => {
    const text = "あ".repeat(MIXI2_MAX_POST_LENGTH);
    expect(formatForMixi2(text, URL)).toBe(text);
  });

  it("上限超は切り詰めて URL を付け、全体が上限に収まる", () => {
    const text = "あ".repeat(200);
    const result = formatForMixi2(text, URL);
    expect(result).toContain("…");
    expect(result.endsWith(URL)).toBe(true);
    expect([...result].length).toBeLessThanOrEqual(MIXI2_MAX_POST_LENGTH);
  });

  it("コードポイントで数える (絵文字でも切り詰め位置が壊れない)", () => {
    const text = "🎉".repeat(200);
    const result = formatForMixi2(text, URL);
    expect([...result].length).toBeLessThanOrEqual(MIXI2_MAX_POST_LENGTH);
    expect(result).not.toContain("�");
  });
});

describe("hasMention", () => {
  it.each(["@uiroid です", "やあ @uiroid", "前 @uiroid 後", "@uiroid"])(
    "メンションを含む: %s",
    (text) => {
      expect(hasMention(text, "@uiroid")).toBe(true);
    },
  );

  it.each(["こんにちは", "@uiroidbot です", "メール uiroid@example.com"])(
    "メンションを含まない: %s",
    (text) => {
      expect(hasMention(text, "@uiroid")).toBe(false);
    },
  );
});

describe("stripMention", () => {
  it("末尾のメンションを除去する", () => {
    expect(stripMention("今日はいい天気 @linkbot", "@linkbot")).toBe("今日はいい天気");
  });

  it("先頭のメンションを除去する", () => {
    expect(stripMention("@linkbot 今日はいい天気", "@linkbot")).toBe("今日はいい天気");
  });

  it("文中のメンションを除去して空白を詰める", () => {
    expect(stripMention("今日は @linkbot いい天気", "@linkbot")).toBe("今日は いい天気");
  });

  it("メンションのみなら空文字になる", () => {
    expect(stripMention("@linkbot", "@linkbot")).toBe("");
  });

  it("部分一致 (@linkbot2 など) は除去しない", () => {
    expect(stripMention("hi @linkbot2", "@linkbot")).toBe("hi @linkbot2");
  });
});
