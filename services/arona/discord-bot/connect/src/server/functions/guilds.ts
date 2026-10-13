import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getApp } from "../app.server.ts";
import { checkGuildAccess, currentSession } from "../access.server.ts";
import { listGuilds } from "../guild-settings.server.ts";

// 未ログインの画面でもルートの loader は走るので、例外にせず空で返す (ログイン画面はルート側で出す)
export const getGuilds = createServerFn().handler(async () => {
  const session = currentSession();
  if (!session) return [];
  const { config, gateway } = getApp();
  return listGuilds(session, config.DISCORD_CLIENT_ID, gateway);
});

// 設定画面を開くのに必要なチャンネルとロール。bot 未参加・権限なしは例外にせず状態で返す
export const getGuildRefs = createServerFn()
  .validator(z.object({ guildId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const result = await checkGuildAccess(data.guildId);
    if (result.access !== "ok") return { status: result.access } as const;
    const { gateway } = getApp();
    return {
      status: "ok",
      channels: gateway.listChannels(data.guildId),
      roles: gateway.listRoles(data.guildId),
    } as const;
  });
