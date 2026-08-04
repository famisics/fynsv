import { describe, expect, it } from "bun:test";
import { imageFiles, shouldForwardNote, type MisskeyNoteLike } from "../src/bridge/filters.js";

const SELF = "user-self";
const MENTION = "@uiroid";

function note(overrides: Partial<MisskeyNoteLike> = {}): MisskeyNoteLike {
  return {
    id: "note1",
    userId: SELF,
    text: "@uiroid hello",
    visibility: "public",
    ...overrides,
  };
}

describe("shouldForwardNote", () => {
  it("転送する: メンション付きの本人の公開テキストノート", () => {
    expect(shouldForwardNote(note(), SELF, MENTION)).toBe(true);
  });

  it("転送する: メンションのみのノート (画像なしでも対象)", () => {
    expect(shouldForwardNote(note({ text: "@uiroid" }), SELF, MENTION)).toBe(true);
  });

  it.each<[string, Partial<MisskeyNoteLike>]>([
    ["メンションなし", { text: "hello" }],
    ["部分一致のメンション", { text: "@uiroidbot hello" }],
    ["テキストなし (画像のみ)", { text: null, files: [{ type: "image/png", url: "https://x/a.png" }] }],
    ["他人のノート", { userId: "someone-else" }],
    ["リプライ", { replyId: "parent" }],
    ["リノート", { renoteId: "orig", text: null }],
    ["引用リノート", { renoteId: "orig" }],
    ["ホーム限定", { visibility: "home" }],
    ["フォロワー限定", { visibility: "followers" }],
    ["ダイレクト", { visibility: "specified" }],
    ["CW 付き", { cw: "注意" }],
    ["テキストも画像もない", { text: null }],
    ["テキストなしで非画像ファイルのみ", { text: null, files: [{ type: "video/mp4", url: "https://x/a.mp4" }] }],
  ])("転送しない: %s", (_label, overrides) => {
    expect(shouldForwardNote(note(overrides), SELF, MENTION)).toBe(false);
  });
});

describe("imageFiles", () => {
  it("画像だけを返し、URL のないファイルは除く", () => {
    const n = note({
      files: [
        { type: "image/jpeg", url: "https://x/a.jpg" },
        { type: "video/mp4", url: "https://x/b.mp4" },
        { type: "image/png", url: null },
      ],
    });
    expect(imageFiles(n)).toEqual([{ type: "image/jpeg", url: "https://x/a.jpg" }]);
  });

  it("files が無ければ空配列", () => {
    expect(imageFiles(note())).toEqual([]);
  });
});
