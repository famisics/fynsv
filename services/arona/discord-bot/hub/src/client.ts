import type { FeatureConfig, FeatureName, ProfileBody } from "./shared/features.ts";
import { getProfile as getProfileFn, putProfile as putProfileFn } from "./server/functions/profile.ts";
import { deleteReminder as deleteReminderFn, getReminders as getRemindersFn } from "./server/functions/reminders.ts";
import { getSettings as getSettingsFn, putSettings as putSettingsFn } from "./server/functions/settings.ts";

export type FeatureSettings<F extends FeatureName> = { enabled: boolean; config: FeatureConfig<F> };

// 機能名ごとの戻り値の型は Server Function では絞れないので、ここで FeatureConfig に合わせる
export async function getSettings<F extends FeatureName>(guildId: string, feature: F) {
  return (await getSettingsFn({ data: { guildId, feature } })) as FeatureSettings<F>;
}

export async function putSettings<F extends FeatureName>(guildId: string, feature: F, body: FeatureSettings<F>) {
  const res = await putSettingsFn({ data: { guildId, feature, ...body } });
  if (!res.ok) throw new Error(res.message);
  return res.settings as FeatureSettings<F>;
}

export const getReminders = (guildId: string) => getRemindersFn({ data: { guildId } });

export async function deleteReminder(guildId: string, reminderId: number) {
  await deleteReminderFn({ data: { guildId, reminderId } });
}

export const getProfile = (guildId: string) => getProfileFn({ data: { guildId } });

export async function putProfile(guildId: string, body: ProfileBody) {
  const res = await putProfileFn({ data: { guildId, body } });
  if (!res.ok) throw new Error(res.message);
  return res.profile;
}

export async function logout() {
  await fetch("/auth/logout", { method: "POST" });
}
