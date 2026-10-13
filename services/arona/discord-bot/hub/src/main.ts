import { Client, Events, GatewayIntentBits } from "discord.js";
import { loadConfig } from "./config.ts";
import { createGateway } from "./discord.ts";
import { registerMisskeyLink } from "./features/misskeylink.ts";
import { registerReminder, remindCommand } from "./features/reminder.ts";
import { registerRolesync } from "./features/rolesync.ts";
import { registerWelcome } from "./features/welcome.ts";
import { log } from "./log.ts";
import { MisskeyClient } from "./misskey.ts";
import { Store } from "./store.ts";
import { createApp } from "./web/app.ts";

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

await client.login(config.DISCORD_TOKEN);

const server = Bun.serve({
  port: config.PORT,
  fetch: createApp({ config, store, gateway: createGateway(client) }).fetch,
});
log.info("web ui listening", { port: server.port });

const shutdown = async () => {
  await server.stop();
  await client.destroy();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
