import { Link, useParams } from "react-router";
import { ApiError, getChannels, getRoles } from "../client.ts";
import { useAsync } from "../hooks.ts";
import { MisskeyPanel } from "../panels/MisskeyPanel.tsx";
import { ProfilePanel } from "../panels/ProfilePanel.tsx";
import { ReminderPanel } from "../panels/ReminderPanel.tsx";
import { RolesyncPanel } from "../panels/RolesyncPanel.tsx";
import { WelcomePanel } from "../panels/WelcomePanel.tsx";

export function GuildPage() {
  const { id = "" } = useParams();
  const refs = useAsync(async () => ({ channels: await getChannels(id), roles: await getRoles(id) }), [id]);

  if (refs.loading) return <p>読み込み中…</p>;
  if (!refs.data) {
    const e = refs.error;
    const text =
      e instanceof ApiError && e.status === 404
        ? "bot がこのサーバーに参加していません。"
        : e instanceof ApiError && e.status === 403
          ? "このサーバーを管理する権限がありません。"
          : e?.message;
    return (
      <>
        <p className="error">{text}</p>
        <Link to="/">サーバー一覧へ戻る</Link>
      </>
    );
  }

  const { channels, roles } = refs.data;
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
