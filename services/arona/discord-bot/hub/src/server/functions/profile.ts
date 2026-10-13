import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getApp } from "../app.server.ts";
import { requireGuildAdmin } from "../authz.server.ts";
import { errorMessage } from "../log.server.ts";
import { profileBody } from "../../shared/features.ts";

const guild = z.object({ guildId: z.string().min(1) });

export const getProfile = createServerFn()
  .validator(guild)
  .handler(async ({ data }) => {
    await requireGuildAdmin(data.guildId);
    return getApp().gateway.getProfile(data.guildId);
  });

export const putProfile = createServerFn({ method: "POST" })
  .validator(guild.extend({ body: profileBody }))
  .handler(async ({ data }) => {
    await requireGuildAdmin(data.guildId);
    const { gateway } = getApp();
    try {
      await gateway.updateProfile(data.guildId, data.body);
    } catch (e) {
      // Discord 側の拒否 (権限不足・レート制限など) をそのまま伝える
      return { ok: false, message: errorMessage(e) } as const;
    }
    return { ok: true, profile: gateway.getProfile(data.guildId) } as const;
  });
