import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireGuildAdmin } from "../access.server.ts";
import { getApp } from "../app.server.ts";
import { cancelReminder, schedule } from "../features/reminder.ts";
import { saveReminder } from "../reminders.server.ts";
import { reminderBody } from "../../shared/features.ts";

const guild = z.object({ guildId: z.string().min(1) });

export const getReminders = createServerFn()
  .validator(guild)
  .handler(async ({ data }) => {
    await requireGuildAdmin(data.guildId);
    return getApp().store.listReminders(data.guildId);
  });

// reminderId が無ければ新規作成、あれば更新
export const putReminder = createServerFn({ method: "POST" })
  .validator(guild.extend({ reminderId: z.number().int().nullable(), body: reminderBody }))
  .handler(async ({ data }) => {
    const session = await requireGuildAdmin(data.guildId);
    const { store, gateway, client } = getApp();
    return saveReminder(
      { store, gateway, onSaved: (row) => (cancelReminder(row.id), schedule(client, store, row)) },
      data.guildId,
      session.userId,
      data.body,
      data.reminderId,
      Date.now(),
    );
  });

export const deleteReminder = createServerFn({ method: "POST" })
  .validator(guild.extend({ reminderId: z.number().int() }))
  .handler(async ({ data }) => {
    await requireGuildAdmin(data.guildId);
    const deleted = getApp().store.deleteReminder(data.reminderId, data.guildId);
    if (deleted) cancelReminder(data.reminderId);
    return { deleted };
  });
