import { Client, Events, GatewayIntentBits } from "discord.js";
import { type Config, loadConfig } from "./config.server.ts";
import { type Gateway, createGateway } from "./discord.server.ts";
import { registerMisskeyLink } from "./features/misskeylink.ts";
import { registerReminder, remindCommand } from "./features/reminder.ts";
import { registerRolesync } from "./features/rolesync.ts";
import { registerWelcome } from "./features/welcome.ts";
import { log } from "./log.server.ts";
import { MisskeyClient } from "./misskey.server.ts";
import { Store } from "./store.server.ts";

export type App = { config: Config; store: Store; client: Client; gateway: Gateway };

// dev の HMR でモジュールが再評価されても bot が二重に起動しないよう、globalThis に持つ
const APP_KEY = Symbol.for("fynsv.hub.app");
const globals = globalThis as { [APP_KEY]?: App };

function createApp(): App {
  const config = loadConfig();
  const store = new Store(config.DB_PATH);
  // GuildMembers は特権 Intent。rolesync のメンバー走査と参加・退出の通知に必要
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

  registerReminder(client, store);
  registerRolesync(client, store);
  registerWelcome(client, store);
  registerMisskeyLink(client, store, config, new MisskeyClient(config.MISSKEY_ORIGIN, config.MISSKEY_USER_TOKEN));

  client.once(Events.ClientReady, async (c) => {
    // グローバルコマンドを一括で置き換える (ここに無いコマンドは消える)
    await c.application.commands.set([remindCommand.toJSON()]);
    log.info("bot ready", { user: c.user.tag, guilds: c.guilds.cache.size });
  });

  return { config, store, client, gateway: createGateway(client) };
}

export function getApp(): App {
  return (globals[APP_KEY] ??= createApp());
}

export async function startBot() {
  const { client, config } = getApp();
  if (client.isReady()) return;
  await client.login(config.DISCORD_TOKEN);
}

export async function stopBot() {
  await globals[APP_KEY]?.client.destroy();
}
