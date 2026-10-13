import { beforeEach, describe, expect, test } from "bun:test";
import type { Config } from "../config.ts";
import type { Gateway } from "../discord.ts";
import { Store } from "../store.ts";
import { createApi } from "./api.ts";

const config = { DISCORD_CLIENT_ID: "client" } as Config;

// g1: user1 が管理者 / g2: user1 は一般メンバー / それ以外: bot 未参加
const gateway: Gateway = {
  hasGuild: (id) => id === "g1" || id === "g2",
  checkAccess: async (guildId, userId) => {
    if (guildId !== "g1" && guildId !== "g2") return "no_guild";
    return guildId === "g1" && userId === "user1" ? "ok" : "forbidden";
  },
  listChannels: () => [{ id: "10000000000000001", name: "general" }],
  listRoles: () => [
    { id: "20000000000000001", name: "a" },
    { id: "20000000000000002", name: "b" },
  ],
  // user1 は 2000...2 のロールだけ付与できる
  canGrantRole: async (_, userId, roleId) => userId === "user1" && roleId === "20000000000000002",
  getProfile: () => ({ nick: null, avatarUrl: null }),
  updateProfile: async () => {},
};

let store: Store;
let api: ReturnType<typeof createApi>;
const headers = { cookie: "session=sid", "content-type": "application/json" };

beforeEach(() => {
  store = new Store(":memory:");
  store.createSession(
    "sid",
    { userId: "user1", username: "u", avatarUrl: null, guilds: [{ id: "g1", name: "G1", iconUrl: null }] },
    Date.now() + 60_000,
  );
  api = createApi({ config, store, gateway });
});

const put = (path: string, body: unknown) =>
  api.request(path, { method: "PUT", headers, body: JSON.stringify(body) });

describe("認可", () => {
  test("セッションが無ければ 401", async () => {
    expect((await api.request("/me")).status).toBe(401);
    expect((await api.request("/guilds/g1/roles", { headers: { cookie: "session=nope" } })).status).toBe(401);
  });

  test("管理権限があれば 200", async () => {
    expect((await api.request("/guilds/g1/roles", { headers })).status).toBe(200);
  });

  test("管理権限が無ければ 403", async () => {
    expect((await api.request("/guilds/g2/roles", { headers })).status).toBe(403);
  });

  test("bot が参加していないギルドは 404", async () => {
    expect((await api.request("/guilds/g3/roles", { headers })).status).toBe(404);
  });

  test("ギルド一覧は bot 未参加なら招待 URL を返す", async () => {
    store.createSession(
      "sid2",
      {
        userId: "user1",
        username: "u",
        avatarUrl: null,
        guilds: [
          { id: "g1", name: "G1", iconUrl: null },
          { id: "g3", name: "G3", iconUrl: null },
        ],
      },
      Date.now() + 60_000,
    );
    const res = await api.request("/guilds", { headers: { cookie: "session=sid2" } });
    const [joined, notJoined] = (await res.json()) as { joined: boolean; inviteUrl: string | null }[];
    expect(joined?.inviteUrl).toBeNull();
    expect(notJoined?.inviteUrl).toContain("client_id=client");
  });
});

describe("設定の保存", () => {
  test("未知の機能は 404", async () => {
    expect((await put("/guilds/g1/settings/nope", { enabled: true, config: {} })).status).toBe(404);
  });

  test("不正な設定は 400 で保存されない", async () => {
    const res = await put("/guilds/g1/settings/welcome", {
      enabled: true,
      config: { channelId: "not-a-snowflake", joinMessage: "", leaveMessage: "" },
    });
    expect(res.status).toBe(400);
    expect(store.getSetting("g1", "welcome")).toBeNull();
  });

  test("他サーバーのチャンネルは 400", async () => {
    const res = await put("/guilds/g1/settings/welcome", {
      enabled: true,
      config: { channelId: "99999999999999999", joinMessage: "hi", leaveMessage: "" },
    });
    expect(res.status).toBe(400);
  });

  test("他サーバーのロールを含む rolesync は 400", async () => {
    const res = await put("/guilds/g1/settings/rolesync", {
      enabled: true,
      config: { rules: [{ sourceRoleIds: ["20000000000000001"], targetRoleId: "99999999999999999" }] },
    });
    expect(res.status).toBe(400);
  });

  test("自分が付与できないロールはターゲットにできない", async () => {
    const res = await put("/guilds/g1/settings/rolesync", {
      enabled: true,
      config: { rules: [{ sourceRoleIds: ["20000000000000002"], targetRoleId: "20000000000000001" }] },
    });
    expect(res.status).toBe(400);
    expect(store.getSetting("g1", "rolesync")).toBeNull();
  });

  test("保存済みのルールのターゲットは再検証しない", async () => {
    store.setSetting("g1", "rolesync", true, {
      rules: [{ sourceRoleIds: ["20000000000000002"], targetRoleId: "20000000000000001" }],
    });
    const res = await put("/guilds/g1/settings/rolesync", {
      enabled: false,
      config: { rules: [{ sourceRoleIds: ["20000000000000002"], targetRoleId: "20000000000000001" }] },
    });
    expect(res.status).toBe(200);
  });

  test("正しい設定は保存され、読み出せる", async () => {
    const res = await put("/guilds/g1/settings/rolesync", {
      enabled: true,
      config: { rules: [{ sourceRoleIds: ["20000000000000001"], targetRoleId: "20000000000000002" }] },
    });
    expect(res.status).toBe(200);
    const got = await api.request("/guilds/g1/settings/rolesync", { headers });
    expect(((await got.json()) as { enabled: boolean }).enabled).toBe(true);
  });

  test("未保存の機能は既定値を返す", async () => {
    const res = await api.request("/guilds/g1/settings/reminder", { headers });
    expect(await res.json()).toEqual({ enabled: true, config: {} });
  });
});

describe("リマインダーの取り消し", () => {
  test("別ギルドの予約は消せない", async () => {
    const id = store.addReminder({ guildId: "g2", channelId: "c", userId: "u", message: "m", fireAt: 1 });
    const res = await api.request(`/guilds/g1/reminders/${id}`, { method: "DELETE", headers });
    expect(res.status).toBe(404);
    expect(store.listReminders("g2")).toHaveLength(1);
  });
});
