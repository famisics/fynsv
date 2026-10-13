import { PermissionFlagsBits } from "discord.js";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Config } from "../config.ts";
import { log } from "../log.ts";
import type { SessionGuild, Store } from "../store.ts";

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

export function createAuthRoutes(config: Config, store: Store) {
  const secure = config.PUBLIC_URL.startsWith("https://");
  const redirectUri = `${config.PUBLIC_URL}/auth/callback`;

  return new Hono()
    .get("/login", (c) => {
      const state = randomToken();
      setCookie(c, STATE_COOKIE, state, { httpOnly: true, secure, sameSite: "Lax", path: "/auth", maxAge: 600 });
      const params = new URLSearchParams({
        client_id: config.DISCORD_CLIENT_ID,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: "identify guilds",
        state,
      });
      return c.redirect(`https://discord.com/oauth2/authorize?${params}`);
    })
    .get("/callback", async (c) => {
      const expected = getCookie(c, STATE_COOKIE);
      deleteCookie(c, STATE_COOKIE, { path: "/auth" });
      const code = c.req.query("code");
      if (!code || !expected || c.req.query("state") !== expected) return c.text("不正なリクエストです", 400);

      const tokenRes = await fetch(`${API}/oauth2/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.DISCORD_CLIENT_ID,
          client_secret: config.DISCORD_CLIENT_SECRET,
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        }),
      });
      if (!tokenRes.ok) {
        log.error("OAuth2 のトークン交換に失敗しました", { status: tokenRes.status, body: await tokenRes.text() });
        return c.text("Discord でのログインに失敗しました", 502);
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
      setCookie(c, SESSION_COOKIE, sessionId, {
        httpOnly: true,
        secure,
        sameSite: "Lax",
        path: "/",
        maxAge: SESSION_TTL_MS / 1000,
      });
      return c.redirect("/");
    })
    .post("/logout", (c) => {
      const id = getCookie(c, SESSION_COOKIE);
      if (id) store.deleteSession(id);
      deleteCookie(c, SESSION_COOKIE, { path: "/" });
      return c.body(null, 204);
    });
}
