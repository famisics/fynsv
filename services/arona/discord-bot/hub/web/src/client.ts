import { hc } from "hono/client";
import type { ApiType } from "../../src/web/api.ts";
import type { FeatureConfig, FeatureName, ProfileBody } from "../../src/shared/features.ts";

const api = hc<ApiType>("/api");

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function toError(res: { status: number; json(): Promise<unknown> }): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
  return new ApiError(res.status, body?.error ?? "unknown", body?.message ?? `HTTP ${res.status}`);
}

export type FeatureSettings<F extends FeatureName> = { enabled: boolean; config: FeatureConfig<F> };

export async function getMe() {
  const res = await api.me.$get();
  if (!res.ok) throw await toError(res);
  return res.json();
}

export async function logout() {
  await fetch("/auth/logout", { method: "POST" });
}

export async function getGuilds() {
  const res = await api.guilds.$get();
  if (!res.ok) throw await toError(res);
  return res.json();
}

export async function getChannels(id: string) {
  const res = await api.guilds[":id"].channels.$get({ param: { id } });
  if (!res.ok) throw await toError(res);
  return res.json();
}

export async function getRoles(id: string) {
  const res = await api.guilds[":id"].roles.$get({ param: { id } });
  if (!res.ok) throw await toError(res);
  return res.json();
}

// 機能名ごとの戻り値の型は API 側では絞れないので、ここで FeatureConfig に合わせる
export async function getSettings<F extends FeatureName>(id: string, feature: F) {
  const res = await api.guilds[":id"].settings[":feature"].$get({ param: { id, feature } });
  if (!res.ok) throw await toError(res);
  return (await res.json()) as unknown as FeatureSettings<F>;
}

export async function putSettings<F extends FeatureName>(id: string, feature: F, body: FeatureSettings<F>) {
  const res = await api.guilds[":id"].settings[":feature"].$put({ param: { id, feature }, json: body });
  if (!res.ok) throw await toError(res);
  return (await res.json()) as unknown as FeatureSettings<F>;
}

export async function getReminders(id: string) {
  const res = await api.guilds[":id"].reminders.$get({ param: { id } });
  if (!res.ok) throw await toError(res);
  return res.json();
}

export async function deleteReminder(id: string, reminderId: number) {
  const res = await api.guilds[":id"].reminders[":reminderId"].$delete({
    param: { id, reminderId: String(reminderId) },
  });
  if (!res.ok) throw await toError(res);
}

export async function getProfile(id: string) {
  const res = await api.guilds[":id"].profile.$get({ param: { id } });
  if (!res.ok) throw await toError(res);
  return res.json();
}

export async function putProfile(id: string, body: ProfileBody) {
  const res = await api.guilds[":id"].profile.$put({ param: { id }, json: body });
  if (!res.ok) throw await toError(res);
  return res.json();
}
