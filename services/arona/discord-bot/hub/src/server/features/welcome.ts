import { type Client, Events, type Guild } from "discord.js";
import { errorMessage, log } from "../log.server.ts";
import { loadSettings } from "../settings.server.ts";
import type { Store } from "../store.server.ts";

export function renderTemplate(template: string, vars: { user: string; server: string }): string {
  return template.replaceAll("{user}", vars.user).replaceAll("{server}", vars.server);
}

async function send(store: Store, guild: Guild, kind: "join" | "leave", user: { id: string; username: string }) {
  const { enabled, config } = loadSettings(store, guild.id, "welcome");
  const template = kind === "join" ? config.joinMessage : config.leaveMessage;
  if (!enabled || !config.channelId || template === "") return;

  const channel = guild.channels.cache.get(config.channelId);
  if (!channel?.isSendable()) return;
  const content = renderTemplate(template, {
    user: kind === "join" ? `<@${user.id}>` : user.username,
    server: guild.name,
  });
  try {
    await channel.send({ content, allowedMentions: { users: kind === "join" ? [user.id] : [] } });
  } catch (e) {
    log.error("ウェルカムメッセージの送信に失敗しました", { guildId: guild.id, kind, error: errorMessage(e) });
  }
}

export function registerWelcome(client: Client, store: Store) {
  client.on(Events.GuildMemberAdd, (m) => void send(store, m.guild, "join", m.user));
  client.on(Events.GuildMemberRemove, (m) => void send(store, m.guild, "leave", m.user));
}
