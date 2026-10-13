import { PermissionFlagsBits, PermissionsBitField } from "discord.js";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie } from "hono/cookie";
import { validator } from "hono/validator";
import type { Config } from "../config.ts";
import type { Gateway } from "../discord.ts";
import { loadSettings } from "../settings.ts";
import {
  type FeatureConfig,
  type FeatureName,
  featureDefs,
  featureSettingsBody,
  isFeatureName,
  profileBody,
} from "../shared/features.ts";
import type { SessionRow, Store } from "../store.ts";
import { SESSION_COOKIE } from "./auth.ts";

export type Deps = { config: Config; store: Store; gateway: Gateway };

type Env = { Variables: { session: SessionRow } };

// bot の招待時に要求する権限
const INVITE_PERMISSIONS = new PermissionsBitField([
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ChangeNickname,
]).bitfield.toString();

function inviteUrl(clientId: string, guildId: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: "bot applications.commands",
    permissions: INVITE_PERMISSIONS,
    guild_id: guildId,
    disable_guild_select: "true",
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

// 設定が参照するチャンネル・ロールが、そのギルドのものかを確かめる (他サーバーの ID を指定させない)。
// rolesync は bot の権限でロールを付与するので、設定した本人が付与できるロールに限る。
// 保存済みのルールのターゲットは、他の管理者が作ったものでも再検証しない
async function invalidReference(
  feature: FeatureName,
  config: unknown,
  deps: Deps,
  guildId: string,
  userId: string,
): Promise<string | null> {
  const { gateway, store } = deps;
  if (feature === "welcome" || feature === "misskeylink") {
    const { channelId } = config as FeatureConfig<"welcome">;
    if (channelId && !gateway.listChannels(guildId).some((c) => c.id === channelId)) {
      return "このサーバーに存在しないチャンネルです";
    }
  }
  if (feature === "rolesync") {
    const known = new Set(gateway.listRoles(guildId).map((r) => r.id));
    const saved = new Set(loadSettings(store, guildId, "rolesync").config.rules.map((r) => r.targetRoleId));
    for (const rule of (config as FeatureConfig<"rolesync">).rules) {
      if (![...rule.sourceRoleIds, rule.targetRoleId].every((id) => known.has(id))) {
        return "このサーバーに存在しない (または付与できない) ロールが含まれています";
      }
      if (!saved.has(rule.targetRoleId) && !(await gateway.canGrantRole(guildId, userId, rule.targetRoleId))) {
        return "あなたの最上位ロールより上のロール、またはあなたが持たない権限を含むロールは、ターゲットにできません (ロール管理権限が必要です)";
      }
    }
  }
  return null;
}

export function createApi(deps: Deps) {
  const { config, store, gateway } = deps;
  return new Hono<Env>()
    .use(async (c, next) => {
      const id = getCookie(c, SESSION_COOKIE);
      const session = id ? store.getSession(id, Date.now()) : null;
      if (!session) return c.json({ error: "unauthorized" as const }, 401);
      c.set("session", session);
      await next();
    })
    .get("/me", (c) => {
      const { userId, username, avatarUrl } = c.var.session;
      return c.json({ id: userId, username, avatarUrl });
    })
    .get("/guilds", (c) =>
      c.json(
        c.var.session.guilds.map((g) => {
          const joined = gateway.hasGuild(g.id);
          return { ...g, joined, inviteUrl: joined ? null : inviteUrl(config.DISCORD_CLIENT_ID, g.id) };
        }),
      ),
    )
    .use("/guilds/:id/*", async (c, next) => {
      const access = await gateway.checkAccess(c.req.param("id"), c.var.session.userId);
      if (access === "no_guild") return c.json({ error: "bot_not_in_guild" as const }, 404);
      if (access === "forbidden") return c.json({ error: "forbidden" as const }, 403);
      await next();
    })
    .get("/guilds/:id/channels", (c) => c.json(gateway.listChannels(c.req.param("id"))))
    .get("/guilds/:id/roles", (c) => c.json(gateway.listRoles(c.req.param("id"))))
    .get("/guilds/:id/settings/:feature", (c) => {
      const feature = c.req.param("feature");
      if (!isFeatureName(feature)) return c.json({ error: "unknown_feature" as const }, 404);
      return c.json(loadSettings(store, c.req.param("id"), feature));
    })
    .put(
      "/guilds/:id/settings/:feature",
      validator("json", (value, c) => {
        const body = featureSettingsBody.safeParse(value);
        return body.success ? body.data : c.json({ error: "invalid_body" as const, message: "リクエストが不正です" }, 400);
      }),
      async (c) => {
        const guildId = c.req.param("id");
        const feature = c.req.param("feature");
        if (!isFeatureName(feature)) return c.json({ error: "unknown_feature" as const }, 404);

        const body = c.req.valid("json");
        const config = featureDefs[feature].schema.safeParse(body.config);
        if (!config.success) return c.json({ error: "invalid_config" as const, message: "設定の形式が不正です" }, 400);
        const refError = await invalidReference(feature, config.data, deps, guildId, c.var.session.userId);
        if (refError) return c.json({ error: "invalid_reference" as const, message: refError }, 400);

        store.setSetting(guildId, feature, body.enabled, config.data);
        return c.json(loadSettings(store, guildId, feature));
      },
    )
    .get("/guilds/:id/reminders", (c) => c.json(store.listReminders(c.req.param("id"))))
    .delete("/guilds/:id/reminders/:reminderId", (c) => {
      const deleted = store.deleteReminder(Number(c.req.param("reminderId")), c.req.param("id"));
      return deleted ? c.body(null, 204) : c.json({ error: "not_found" as const }, 404);
    })
    .get("/guilds/:id/profile", (c) => c.json(gateway.getProfile(c.req.param("id"))))
    .put(
      "/guilds/:id/profile",
      bodyLimit({ maxSize: 17 * 1024 * 1024, onError: (c) => c.json({ error: "too_large" as const }, 413) }),
      validator("json", (value, c) => {
        const body = profileBody.safeParse(value);
        return body.success ? body.data : c.json({ error: "invalid_body" as const, message: "リクエストが不正です" }, 400);
      }),
      async (c) => {
        const guildId = c.req.param("id");
        try {
          await gateway.updateProfile(guildId, c.req.valid("json"));
        } catch (e) {
          // Discord 側の拒否 (権限不足・レート制限など) をそのまま伝える
          return c.json({ error: "discord_error" as const, message: e instanceof Error ? e.message : String(e) }, 502);
        }
        return c.json(gateway.getProfile(guildId));
      },
    );
}

export type ApiType = ReturnType<typeof createApi>;
