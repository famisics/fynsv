import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getApp } from "../app.server.ts";
import { requireGuildAdmin } from "../authz.server.ts";

const guild = z.object({ guildId: z.string().min(1) });

export const getReminders = createServerFn()
  .validator(guild)
  .handler(async ({ data }) => {
    await requireGuildAdmin(data.guildId);
    return getApp().store.listReminders(data.guildId);
  });

export const deleteReminder = createServerFn({ method: "POST" })
  .validator(guild.extend({ reminderId: z.number().int() }))
  .handler(async ({ data }) => {
    await requireGuildAdmin(data.guildId);
    return { deleted: getApp().store.deleteReminder(data.reminderId, data.guildId) };
  });
