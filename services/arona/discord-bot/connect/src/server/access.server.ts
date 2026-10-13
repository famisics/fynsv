import { getRequest } from "@tanstack/react-start/server";
import { getApp } from "./app.server.ts";
import { SESSION_COOKIE } from "./auth.server.ts";
import { readCookie } from "./cookie.server.ts";
import type { SessionRow } from "./store.server.ts";

export function currentSession(): SessionRow | null {
  const id = readCookie(getRequest(), SESSION_COOKIE);
  return id ? getApp().store.getSession(id, Date.now()) : null;
}

export type GuildAccessResult = { access: "ok"; session: SessionRow } | { access: "no_guild" | "forbidden" };

// セッションの内容は信用せず、毎回 bot 側から見たメンバーの権限で判定する
export async function checkGuildAccess(guildId: string): Promise<GuildAccessResult> {
  const session = currentSession();
  if (!session) return { access: "forbidden" };
  const access = await getApp().gateway.checkAccess(guildId, session.userId);
  return access === "ok" ? { access, session } : { access };
}

// 書き込み・読み出しの前に呼び、管理権限が無ければ例外にする
export async function requireGuildAdmin(guildId: string): Promise<SessionRow> {
  const result = await checkGuildAccess(guildId);
  if (result.access !== "ok") throw new Error(result.access);
  return result.session;
}
