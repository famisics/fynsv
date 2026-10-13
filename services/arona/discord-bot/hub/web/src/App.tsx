import { Link, Route, Routes } from "react-router";
import { ApiError, getMe, logout } from "./client.ts";
import { useAsync } from "./hooks.ts";
import { GuildList } from "./pages/GuildList.tsx";
import { GuildPage } from "./pages/GuildPage.tsx";

export function App() {
  const me = useAsync(getMe, []);

  if (me.loading) return <p className="center">読み込み中…</p>;
  if (me.error instanceof ApiError && me.error.status === 401) {
    return (
      <main className="center">
        <h1>Discord Hub</h1>
        <p>サーバーの管理者として Discord でログインしてください。</p>
        <a className="button primary" href="/auth/login">
          Discord でログイン
        </a>
      </main>
    );
  }
  if (!me.data) return <p className="center error">{me.error?.message}</p>;

  return (
    <>
      <header>
        <Link to="/" className="brand">
          Discord Hub
        </Link>
        <span className="user">
          {me.data.avatarUrl && <img src={me.data.avatarUrl} alt="" />}
          {me.data.username}
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
        <Routes>
          <Route path="/" element={<GuildList />} />
          <Route path="/guilds/:id" element={<GuildPage />} />
        </Routes>
      </main>
    </>
  );
}
