import { PermissionFlagsBits, PermissionsBitField } from "discord.js";
import type { Gateway } from "./discord.server.ts";
import { type FeatureSettings, loadSettings } from "./settings.server.ts";
import {
  type FeatureConfig,
  type FeatureName,
  type GuildSummary,
  featureDefs,
} from "../shared/features.ts";
import type { SessionRow, Store } from "./store.server.ts";

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

export function listGuilds(session: SessionRow, clientId: string, gateway: Gateway): GuildSummary[] {
  return session.guilds.map((g) => {
    const joined = gateway.hasGuild(g.id);
    return { ...g, joined, inviteUrl: joined ? null : inviteUrl(clientId, g.id) };
  });
}

// 設定が参照するチャンネル・ロールが、そのギルドのものかを確かめる (他サーバーの ID を指定させない)。
// rolesync は bot の権限でロールを付与するので、設定した本人が付与できるロールに限る。
// 保存済みのルールのターゲットは、他の管理者が作ったものでも再検証しない
export async function invalidReference(
  feature: FeatureName,
  config: unknown,
  gateway: Gateway,
  store: Store,
  guildId: string,
  userId: string,
): Promise<string | null> {
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

export type SaveResult<F extends FeatureName> =
  | { ok: true; settings: FeatureSettings<F> }
  | { ok: false; message: string };

export async function saveSettings<F extends FeatureName>(
  deps: { gateway: Gateway; store: Store },
  guildId: string,
  userId: string,
  feature: F,
  body: { enabled: boolean; config: unknown },
): Promise<SaveResult<F>> {
  const config = featureDefs[feature].schema.safeParse(body.config);
  if (!config.success) return { ok: false, message: "設定の形式が不正です" };
  const refError = await invalidReference(feature, config.data, deps.gateway, deps.store, guildId, userId);
  if (refError) return { ok: false, message: refError };
  deps.store.setSetting(guildId, feature, body.enabled, config.data);
  return { ok: true, settings: loadSettings(deps.store, guildId, feature) };
}
