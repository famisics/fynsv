import { Link, createFileRoute } from "@tanstack/react-router";
import { MisskeyPanel } from "../components/panels/MisskeyPanel.tsx";
import { ProfilePanel } from "../components/panels/ProfilePanel.tsx";
import { ReminderPanel } from "../components/panels/ReminderPanel.tsx";
import { RolesyncPanel } from "../components/panels/RolesyncPanel.tsx";
import { WelcomePanel } from "../components/panels/WelcomePanel.tsx";
import { getGuildRefs } from "../server/functions/guilds.ts";

export const Route = createFileRoute("/guilds/$id")({
  loader: ({ params }) => getGuildRefs({ data: { guildId: params.id } }),
  component: GuildPage,
});

function GuildPage() {
  const { id } = Route.useParams();
  const refs = Route.useLoaderData();

  if (refs.status !== "ok") {
    return (
      <>
        <p className="error">
          {refs.status === "no_guild"
            ? "bot がこのサーバーに参加していません。"
            : "このサーバーを管理する権限がありません。"}
        </p>
        <Link to="/">サーバー一覧へ戻る</Link>
      </>
    );
  }

  const { channels, roles } = refs;
  return (
    <>
      <p>
        <Link to="/">← サーバー一覧</Link>
      </p>
      <ProfilePanel guildId={id} />
      <ReminderPanel guildId={id} channels={channels} />
      <RolesyncPanel guildId={id} roles={roles} />
      <WelcomePanel guildId={id} channels={channels} />
      <MisskeyPanel guildId={id} channels={channels} />
    </>
  );
}
