import { ChannelType, type Client, PermissionFlagsBits, Routes } from "discord.js";
import type { ProfileBody } from "./shared/features.ts";

export type GuildAccess = "ok" | "no_guild" | "forbidden";

export type BotProfile = { nick: string | null; avatarUrl: string | null };

// Web API が Discord に対して行う操作。テストでは差し替える
export interface Gateway {
  hasGuild(guildId: string): boolean;
  checkAccess(guildId: string, userId: string): Promise<GuildAccess>;
  listChannels(guildId: string): { id: string; name: string }[];
  listRoles(guildId: string): { id: string; name: string }[];
  canGrantRole(guildId: string, userId: string, roleId: string): Promise<boolean>;
  getProfile(guildId: string): BotProfile;
  updateProfile(guildId: string, body: ProfileBody): Promise<void>;
}

export function createGateway(client: Client): Gateway {
  const guildOf = (guildId: string) => {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw new Error(`guild not found: ${guildId}`);
    return guild;
  };

  return {
    hasGuild: (guildId) => client.guilds.cache.has(guildId),

    // セッションの内容は信用せず、毎回 bot 側から見たメンバーの権限で判定する
    async checkAccess(guildId, userId) {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) return "no_guild";
      const member = await guild.members.fetch(userId).catch(() => null);
      return member?.permissions.has(PermissionFlagsBits.ManageGuild) ? "ok" : "forbidden";
    },

    listChannels: (guildId) =>
      guildOf(guildId)
        .channels.cache.filter(
          (c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement,
        )
        .map((c) => ({ id: c.id, name: c.name })),

    listRoles: (guildId) =>
      guildOf(guildId)
        .roles.cache.filter((r) => r.id !== guildId && !r.managed)
        .sort((a, b) => b.position - a.position)
        .map((r) => ({ id: r.id, name: r.name })),

    // 自分より上位のロールや、自分が持たない権限を含むロールを、bot 経由で付与させない
    async canGrantRole(guildId, userId, roleId) {
      const guild = guildOf(guildId);
      const role = guild.roles.cache.get(roleId);
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!role || !member) return false;
      if (guild.ownerId === userId) return true;
      return (
        member.permissions.has(PermissionFlagsBits.ManageRoles) &&
        role.position < member.roles.highest.position &&
        member.permissions.has(role.permissions)
      );
    },

    getProfile: (guildId) => {
      const me = guildOf(guildId).members.me;
      return { nick: me?.nickname ?? null, avatarUrl: me?.avatarURL({ size: 128 }) ?? null };
    },

    // discord.js の editMe は bio / banner に対応していない版があるので REST を直接呼ぶ
    async updateProfile(guildId, body) {
      await client.rest.patch(Routes.guildMember(guildId, "@me"), { body });
    },
  };
}
