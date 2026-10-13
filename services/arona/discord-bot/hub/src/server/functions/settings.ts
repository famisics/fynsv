import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getApp } from "../app.server.ts";
import { requireGuildAdmin } from "../authz.server.ts";
import { saveSettings } from "../guild-settings.server.ts";
import { loadSettings } from "../settings.server.ts";
import { featureNames } from "../../shared/features.ts";

const target = z.object({ guildId: z.string().min(1), feature: z.enum(featureNames) });

export const getSettings = createServerFn()
  .validator(target)
  .handler(async ({ data }) => {
    await requireGuildAdmin(data.guildId);
    return loadSettings(getApp().store, data.guildId, data.feature);
  });

export const putSettings = createServerFn({ method: "POST" })
  .validator(target.extend({ enabled: z.boolean(), config: z.unknown() }))
  .handler(async ({ data }) => {
    const session = await requireGuildAdmin(data.guildId);
    const { store, gateway } = getApp();
    return saveSettings({ store, gateway }, data.guildId, session.userId, data.feature, data);
  });
