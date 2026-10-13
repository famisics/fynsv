import { PermissionFlagsBits } from "discord.js";
import type { Config } from "./config.server.ts";
import { readCookie, serializeCookie } from "./cookie.server.ts";
import { log } from "./log.server.ts";
import type { SessionGuild, Store } from "./store.server.ts";

export const SESSION_COOKIE = "session";
const STATE_COOKIE = "oauth_state";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const API = "https://discord.com/api/v10";

type DiscordUser = { id: string; username: string; global_name: string | null; avatar: string | null };
type DiscordGuild = { id: string; name: string; icon: string | null; owner: boolean; permissions: string };

function randomToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
}

function canManage(g: DiscordGuild): boolean {
  const perms = BigInt(g.permissions);
  return g.owner || (perms & (PermissionFlagsBits.ManageGuild | PermissionFlagsBits.Administrator)) !== 0n;
}

async function discordGet<T>(path: string, accessToken: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`discord ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

const isSecure = (config: Config) => config.PUBLIC_URL.startsWith("https://");
const redirectUri = (config: Config) => `${config.PUBLIC_URL}/auth/callback`;

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(null, { status: 302, headers });
}

export function handleLogin(config: Config): Response {
  const state = randomToken();
  const params = new URLSearchParams({
    client_id: config.DISCORD_CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri(config),
    scope: "identify guilds",
    state,
  });
  return redirect(`https://discord.com/oauth2/authorize?${params}`, [
    serializeCookie(STATE_COOKIE, state, { path: "/auth", maxAge: 600, secure: isSecure(config) }),
  ]);
}

export async function handleCallback(request: Request, config: Config, store: Store): Promise<Response> {
  const secure = isSecure(config);
  const expected = readCookie(request, STATE_COOKIE);
  const clearState = serializeCookie(STATE_COOKIE, "", { path: "/auth", maxAge: 0, secure });
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code || !expected || url.searchParams.get("state") !== expected) {
    return new Response("不正なリクエストです", { status: 400, headers: { "set-cookie": clearState } });
  }

  const tokenRes = await fetch(`${API}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.DISCORD_CLIENT_ID,
      client_secret: config.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(config),
    }),
  });
  if (!tokenRes.ok) {
    log.error("OAuth2 のトークン交換に失敗しました", { status: tokenRes.status, body: await tokenRes.text() });
    return new Response("Discord でのログインに失敗しました", { status: 502, headers: { "set-cookie": clearState } });
  }
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const [user, guilds] = await Promise.all([
    discordGet<DiscordUser>("/users/@me", access_token),
    discordGet<DiscordGuild[]>("/users/@me/guilds", access_token),
  ]);
  const manageable: SessionGuild[] = guilds.filter(canManage).map((g) => ({
    id: g.id,
    name: g.name,
    iconUrl: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64` : null,
  }));

  const now = Date.now();
  store.deleteExpiredSessions(now);
  const sessionId = randomToken();
  store.createSession(
    sessionId,
    {
      userId: user.id,
      username: user.global_name ?? user.username,
      avatarUrl: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64` : null,
      guilds: manageable,
    },
    now + SESSION_TTL_MS,
  );
  return redirect("/", [
    clearState,
    serializeCookie(SESSION_COOKIE, sessionId, { path: "/", maxAge: SESSION_TTL_MS / 1000, secure }),
  ]);
}

// ブラウザ以外や別サイトからのログアウトを受けない。Origin が公開 URL と一致するときだけ処理する
export function handleLogout(request: Request, config: Config, store: Store): Response {
  if (request.headers.get("origin") !== new URL(config.PUBLIC_URL).origin) {
    return new Response("forbidden", { status: 403 });
  }
  const id = readCookie(request, SESSION_COOKIE);
  if (id) store.deleteSession(id);
  return new Response(null, {
    status: 204,
    headers: { "set-cookie": serializeCookie(SESSION_COOKIE, "", { path: "/", maxAge: 0, secure: isSecure(config) }) },
  });
}
