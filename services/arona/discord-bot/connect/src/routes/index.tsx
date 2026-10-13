import { Link, createFileRoute } from "@tanstack/react-router";
import { getGuilds } from "../server/functions/guilds.ts";

export const Route = createFileRoute("/")({
  loader: () => getGuilds(),
  component: GuildList,
});

function GuildList() {
  const guilds = Route.useLoaderData();
  if (guilds.length === 0) {
    return <p>管理権限 (サーバー管理) を持つサーバーがありません。</p>;
  }

  return (
    <>
      <h1>サーバー</h1>
      <ul className="guilds">
        {guilds.map((g) => (
          <li key={g.id}>
            {g.iconUrl ? <img src={g.iconUrl} alt="" /> : <span className="icon-fallback">{g.name[0]}</span>}
            <span className="name">{g.name}</span>
            {g.joined ? (
              <Link className="button primary" to="/guilds/$id" params={{ id: g.id }}>
                設定
              </Link>
            ) : (
              <a className="button" href={g.inviteUrl ?? undefined}>
                bot を招待
              </a>
            )}
          </li>
        ))}
      </ul>
      <p className="hint">招待後は、この画面を再読み込みすると「設定」に変わります。</p>
    </>
  );
}
