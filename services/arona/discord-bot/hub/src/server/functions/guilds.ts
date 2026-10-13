import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getApp } from "../app.server.ts";
import { checkGuildAccess, requireSession } from "../authz.server.ts";
import { listGuilds } from "../guild-settings.server.ts";

export const getGuilds = createServerFn().handler(async () => {
  const { config, gateway } = getApp();
  return listGuilds(requireSession(), config.DISCORD_CLIENT_ID, gateway);
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
