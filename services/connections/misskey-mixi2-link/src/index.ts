import { MisskeyToMixi2 } from "./bridge/misskeyToMixi2.js";
import { Mixi2ToMisskey } from "./bridge/mixi2ToMisskey.js";
import { loadConfig } from "./config.js";
import { log } from "./log.js";
import { MisskeyClient } from "./misskey/client.js";
import { MisskeyWatcher } from "./misskey/watcher.js";
import { Mixi2Client } from "./mixi2/client.js";
import { Mixi2Watcher } from "./mixi2/watcher.js";
import { BridgeStore } from "./store.js";

const config = loadConfig();
const store = await BridgeStore.open(config.tursoDatabaseUrl, config.tursoAuthToken);
const mixi2 = new Mixi2Client(config.mixi2ClientId, config.mixi2ClientSecret);
const misskeyUser = new MisskeyClient(config.misskeyOrigin, config.misskeyUserToken);
const misskeyBot = new MisskeyClient(config.misskeyOrigin, config.misskeyBotToken);

const misskeyUserId = await misskeyUser.resolveUserId(config.misskeyUserId);
log("info", "starting", {
  mixi2BotMention: config.mixi2BotMention,
  misskeyBotMention: config.misskeyBotMention,
  misskeyUserId,
  dryRun: config.dryRun,
});

const misskeyToMixi2 = new MisskeyToMixi2({
  store,
  misskey: misskeyUser,
  mixi2,
  misskeyUserId,
  misskeyBotMention: config.misskeyBotMention,
  misskeyPublicOrigin: config.misskeyPublicOrigin,
  dryRun: config.dryRun,
});
const mixi2ToMisskey = new Mixi2ToMisskey({
  store,
  misskeyBot,
  ownerName: config.mixi2UserId,
  botMention: config.mixi2BotMention,
  dryRun: config.dryRun,
});

try {
  await misskeyToMixi2.backfill();
} catch (err) {
  log("error", "backfill failed, continuing with streams", { error: String(err) });
}

const misskeyWatcher = new MisskeyWatcher({
  origin: config.misskeyOrigin,
  token: config.misskeyUserToken,
  userId: misskeyUserId,
  onNote: (note) => misskeyToMixi2.handleNote(note),
});
misskeyWatcher.start();

const mixi2Watcher = new Mixi2Watcher({
  authenticator: mixi2.authenticator,
  onMentionedPost: (event) => mixi2ToMisskey.handleMentionedPost(event),
});
void mixi2Watcher.start();

function shutdown(signal: string): void {
  log("info", "shutting down", { signal });
  misskeyWatcher.stop();
  mixi2Watcher.stop();
  mixi2.close();
  store.close();
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
