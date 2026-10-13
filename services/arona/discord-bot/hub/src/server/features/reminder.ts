import {
  ChannelType,
  type Client,
  Events,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { errorMessage, log } from "../log.server.ts";
import { loadSettings } from "../settings.server.ts";
import { formatJst, parseJst } from "../../shared/jst.ts";
import type { ReminderRow, Store } from "../store.server.ts";

// setTimeout は約 24.8 日を超えると即時発火してしまうので、それより先は刻んで待つ
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
const MAX_PENDING_PER_USER = 25;

export const remindCommand = new SlashCommandBuilder()
  .setName("remind")
  .setDescription("指定した時間(日本時間)にリマインダーを送信する")
  .setContexts(InteractionContextType.Guild)
  .addStringOption((o) =>
    o.setName("message").setDescription("リマインドするメッセージ").setRequired(true).setMaxLength(1000),
  )
  .addStringOption((o) =>
    o.setName("time").setDescription("リマインドする時刻 (例: 15:00, 06/24 09:30)").setRequired(true),
  )
  .addChannelOption((o) =>
    o
      .setName("channel")
      .setDescription("送信先チャンネル (省略時は現在のチャンネル)")
      .addChannelTypes(ChannelType.GuildText),
  );

async function fire(client: Client, store: Store, id: number) {
  const row = store.takeReminder(id);
  if (!row) return; // 管理画面から取り消された
  const channel = client.guilds.cache.get(row.guildId)?.channels.cache.get(row.channelId);
  if (!channel?.isSendable()) {
    log.warn("リマインダーの送信先チャンネルが見つかりません", { id, guildId: row.guildId });
    return;
  }
  try {
    await channel.send({
      content: `<@${row.userId}> リマインド: ${row.message}`,
      allowedMentions: { users: [row.userId] },
    });
  } catch (e) {
    log.error("リマインダー送信に失敗しました", { id, error: errorMessage(e) });
  }
}

export function schedule(client: Client, store: Store, row: ReminderRow) {
  const delay = row.fireAt - Date.now();
  if (delay > MAX_TIMEOUT_MS) {
    setTimeout(() => schedule(client, store, row), MAX_TIMEOUT_MS);
    return;
  }
  setTimeout(() => void fire(client, store, row.id), Math.max(delay, 0));
}

export function registerReminder(client: Client, store: Store) {
  // 再起動前の予約を張り直す。期限を過ぎていたものはすぐ送る
  client.once(Events.ClientReady, () => {
    for (const row of store.listAllReminders()) schedule(client, store, row);
  });

  client.on(Events.InteractionCreate, async (i) => {
    if (!i.isChatInputCommand() || i.commandName !== remindCommand.name || !i.inCachedGuild()) return;

    const reject = (content: string) => i.reply({ content, flags: MessageFlags.Ephemeral });

    if (!loadSettings(store, i.guildId, "reminder").enabled) {
      return reject("このサーバーではリマインダーが無効です");
    }

    const timeText = i.options.getString("time", true);
    const message = i.options.getString("message", true);
    const fireAt = parseJst(timeText, Date.now());
    if (fireAt === null) return reject(`無効な時刻形式です: ${timeText} (例: 15:00, 06/24 09:30)`);

    const channel = i.options.getChannel("channel", false, [ChannelType.GuildText]) ?? i.channel;
    if (!channel) return reject("送信先チャンネルを特定できません");
    // 他人が書き込めないチャンネルへ bot 経由で投稿できないようにする
    if (!channel.permissionsFor(i.user)?.has(PermissionFlagsBits.SendMessages)) {
      return reject("そのチャンネルに送信する権限がありません");
    }
    if (!channel.permissionsFor(i.client.user)?.has(PermissionFlagsBits.SendMessages)) {
      return reject("bot がそのチャンネルに送信する権限を持っていません");
    }
    if (store.countUserReminders(i.user.id) >= MAX_PENDING_PER_USER) {
      return reject(`予約できるリマインダーは ${MAX_PENDING_PER_USER} 件までです`);
    }

    const row = { guildId: i.guildId, channelId: channel.id, userId: i.user.id, message, fireAt };
    schedule(client, store, { ...row, id: store.addReminder(row) });

    const where = channel.id !== i.channelId ? ` (<#${channel.id}>)` : "";
    await i.reply(`${formatJst(fireAt)} (JST) にリマインドします${where}: ${message}`);
  });
}
