import { HeadContent, Link, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { logout } from "../client.ts";
import { getMe } from "../server/functions/session.ts";
import styles from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1.0" },
      { title: "Discord Hub 管理画面" },
    ],
    links: [{ rel: "stylesheet", href: styles }],
  }),
  loader: () => getMe(),
  component: RootComponent,
});

function RootComponent() {
  const me = Route.useLoaderData();

  return (
    <html lang="ja">
      <head>
        <HeadContent />
      </head>
      <body>
        {me ? (
          <>
            <header>
              <Link to="/" className="brand">
                Discord Hub
              </Link>
              <span className="user">
                {me.avatarUrl && <img src={me.avatarUrl} alt="" />}
                {me.username}
              </span>
              <button
                type="button"
                onClick={async () => {
                  await logout();
                  location.href = "/";
                }}
              >
                ログアウト
              </button>
            </header>
            <main>
              <Outlet />
            </main>
          </>
        ) : (
          <main className="center">
            <h1>Discord Hub</h1>
            <p>サーバーの管理者として Discord でログインしてください。</p>
            <a className="button primary" href="/auth/login">
              Discord でログイン
            </a>
          </main>
        )}
        <Scripts />
      </body>
    </html>
  );
}
