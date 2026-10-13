import { ChannelSelect } from "./ChannelSelect.tsx";
import { SettingsCard } from "./SettingsCard.tsx";

export function WelcomePanel({ guildId, channels }: { guildId: string; channels: { id: string; name: string }[] }) {
  return (
    <SettingsCard
      guildId={guildId}
      feature="welcome"
      title="参加・退出メッセージ"
      description="メンバーの参加と退出を、指定したチャンネルに知らせます。メッセージを空にした側は送りません。{user} は参加時はメンション、退出時はユーザー名、{server} はサーバー名に置き換わります。"
    >
      {(config, setConfig) => (
        <>
          <label className="label">
            送信先チャンネル
            <ChannelSelect
              channels={channels}
              value={config.channelId}
              onChange={(channelId) => setConfig({ ...config, channelId })}
            />
          </label>
          <label className="label">
            参加時のメッセージ
            <textarea
              rows={3}
              value={config.joinMessage}
              onChange={(e) => setConfig({ ...config, joinMessage: e.target.value })}
            />
          </label>
          <label className="label">
            退出時のメッセージ
            <textarea
              rows={3}
              value={config.leaveMessage}
              onChange={(e) => setConfig({ ...config, leaveMessage: e.target.value })}
            />
          </label>
        </>
      )}
    </SettingsCard>
  );
}
