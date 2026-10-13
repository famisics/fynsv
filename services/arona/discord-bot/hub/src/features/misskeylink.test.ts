import { describe, expect, test } from "bun:test";
import type { Note } from "../misskey.ts";
import { formatMessage, shouldForwardNote } from "./misskeylink.ts";

const note = (patch: Partial<Note> = {}): Note => ({
  id: "n1",
  userId: "me",
  text: "hello",
  cw: null,
  replyId: null,
  renoteId: null,
  visibility: "public",
  files: [],
  tags: ["fynsv"],
  ...patch,
});

describe("shouldForwardNote", () => {
  test("本人の公開ノートでタグが一致すれば転送する", () => {
    expect(shouldForwardNote(note(), "me", "fynsv")).toBe(true);
  });

  test("ハッシュタグは # つき・大文字でも一致する", () => {
    expect(shouldForwardNote(note(), "me", "#FynSV")).toBe(true);
    expect(shouldForwardNote(note({ tags: ["FynSV"] }), "me", "fynsv")).toBe(true);
  });

  test.each([
    ["他人のノート", { userId: "other" }],
    ["リプライ", { replyId: "x" }],
    ["リノート", { renoteId: "x" }],
    ["非公開", { visibility: "home" }],
    ["CW つき", { cw: "warning" }],
    ["タグ不一致", { tags: ["other"] }],
  ])("%s は転送しない", (_, patch) => {
    expect(shouldForwardNote(note(patch), "me", "fynsv")).toBe(false);
  });

  test("ハッシュタグが未設定なら転送しない", () => {
    expect(shouldForwardNote(note(), "me", "")).toBe(false);
    expect(shouldForwardNote(note(), "me", "#")).toBe(false);
  });
});

describe("formatMessage", () => {
  test("本文と画像 URL を改行でつなぐ。画像以外は含めない", () => {
    const text = formatMessage(
      note({
        files: [
          { type: "image/png", url: "https://example.com/a.png" },
          { type: "video/mp4", url: "https://example.com/b.mp4" },
          { type: "image/png", url: null },
        ],
      }),
    );
    expect(text).toBe("hello\nhttps://example.com/a.png");
  });
});
