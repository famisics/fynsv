import { beforeEach, describe, expect, test } from "bun:test";
import type { Gateway } from "./discord.server.ts";
import { listGuilds, saveSettings } from "./guild-settings.server.ts";
import { loadSettings } from "./settings.server.ts";
import { Store } from "./store.server.ts";

// user1 は 2000...2 のロールだけ付与できる
const gatewayStub = {
  hasGuild: (id) => id === "g1",
  listChannels: () => [{ id: "10000000000000001", name: "general" }],
  listRoles: () => [
    { id: "20000000000000001", name: "a" },
    { id: "20000000000000002", name: "b" },
  ],
  canGrantRole: async (_, userId, roleId) => userId === "user1" && roleId === "20000000000000002",
} satisfies Partial<Gateway>;
const gateway = gatewayStub as unknown as Gateway;

let store: Store;

beforeEach(() => {
  store = new Store(":memory:");
});

const save = (feature: "welcome" | "rolesync", config: unknown, enabled = true) =>
  saveSettings({ store, gateway }, "g1", "user1", feature, { enabled, config });

const rolesync = (source: string, target: string) => ({ rules: [{ sourceRoleIds: [source], targetRoleId: target }] });

describe("ギルド一覧", () => {
  test("bot 未参加なら招待 URL を返す", () => {
    const session = {
      userId: "user1",
      username: "u",
      avatarUrl: null,
      guilds: [
        { id: "g1", name: "G1", iconUrl: null },
        { id: "g3", name: "G3", iconUrl: null },
      ],
    };
    const [joined, notJoined] = listGuilds(session, "client", gateway);
    expect(joined?.inviteUrl).toBeNull();
    expect(notJoined?.inviteUrl).toContain("client_id=client");
  });
});

describe("設定の保存", () => {
  test("不正な設定は保存されない", async () => {
    const res = await save("welcome", { channelId: "not-a-snowflake", joinMessage: "", leaveMessage: "" });
    expect(res.ok).toBe(false);
    expect(store.getSetting("g1", "welcome")).toBeNull();
  });

  test("他サーバーのチャンネルは拒否する", async () => {
    const res = await save("welcome", { channelId: "99999999999999999", joinMessage: "hi", leaveMessage: "" });
    expect(res.ok).toBe(false);
  });

  test("他サーバーのロールを含む rolesync は拒否する", async () => {
    expect((await save("rolesync", rolesync("20000000000000001", "99999999999999999"))).ok).toBe(false);
  });

  test("自分が付与できないロールはターゲットにできない", async () => {
    const res = await save("rolesync", rolesync("20000000000000002", "20000000000000001"));
    expect(res.ok).toBe(false);
    expect(store.getSetting("g1", "rolesync")).toBeNull();
  });

  test("保存済みのルールのターゲットは再検証しない", async () => {
    const rules = rolesync("20000000000000002", "20000000000000001");
    store.setSetting("g1", "rolesync", true, rules);
    expect((await save("rolesync", rules, false)).ok).toBe(true);
  });

  test("正しい設定は保存され、読み出せる", async () => {
    expect((await save("rolesync", rolesync("20000000000000001", "20000000000000002"))).ok).toBe(true);
    expect(loadSettings(store, "g1", "rolesync").enabled).toBe(true);
  });

  test("未保存の機能は既定値を返す", () => {
    expect(loadSettings(store, "g1", "reminder")).toEqual({ enabled: true, config: {} });
  });
});
