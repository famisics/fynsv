import { definePlugin } from "nitro";
import { startBot, stopBot } from "../server/app.server.ts";
import { errorMessage, log } from "../server/log.server.ts";

// bot は Web アプリと同じプロセスで動かす。サーバー起動時に 1 回だけ接続する。
// 環境変数の不足や接続の失敗は起動時に気づけるよう、プロセスごと落とす
export default definePlugin((nitroApp) => {
  startBot().catch((e) => {
    log.error("bot の起動に失敗しました", { error: errorMessage(e) });
    process.exit(1);
  });
  nitroApp.hooks.hook("close", stopBot);
});
