import { describe, expect, it } from "bun:test";
import { BridgeStore } from "../src/store.js";

describe("BridgeStore", () => {
  it("記録した source_id は処理済みになる", async () => {
    const store = await BridgeStore.open(":memory:");
    expect(await store.isProcessed("misskey->mixi2", "n1")).toBe(false);
    await store.record("misskey->mixi2", "n1", "p1");
    expect(await store.isProcessed("misskey->mixi2", "n1")).toBe(true);
  });

  it("方向が違えば別の記録になる", async () => {
    const store = await BridgeStore.open(":memory:");
    await store.record("misskey->mixi2", "id1", "t1");
    expect(await store.isProcessed("mixi2->misskey", "id1")).toBe(false);
  });

  it("同じ source_id の二重記録はエラーにならない", async () => {
    const store = await BridgeStore.open(":memory:");
    await store.record("misskey->mixi2", "n1", "p1");
    expect(store.record("misskey->mixi2", "n1", "p2")).resolves.toBeUndefined();
  });

  it("カーソルの保存と上書き", async () => {
    const store = await BridgeStore.open(":memory:");
    expect(await store.getCursor("misskey_last_note_id")).toBeNull();
    await store.setCursor("misskey_last_note_id", "a");
    await store.setCursor("misskey_last_note_id", "b");
    expect(await store.getCursor("misskey_last_note_id")).toBe("b");
  });
});
