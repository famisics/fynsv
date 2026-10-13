import { ChannelSelect } from "./ChannelSelect.tsx";
import { SettingsCard } from "./SettingsCard.tsx";

export function MisskeyPanel({ guildId, channels }: { guildId: string; channels: { id: string; name: string }[] }) {
  return (
    <SettingsCard
      guildId={guildId}
      feature="misskeylink"
      title="Misskey 転送"
      description="運営アカウントの Misskey 投稿のうち、公開・CW なし・リプライとリノート以外で、指定したハッシュタグを含むものを転送します。"
    >
      {(config, setConfig) => (
        <>
          <label className="label">
            転送先チャンネル
            <ChannelSelect
              channels={channels}
              value={config.channelId}
              onChange={(channelId) => setConfig({ ...config, channelId })}
            />
          </label>
          <label className="label">
            ハッシュタグ (# は省略可)
            <input value={config.hashtag} onChange={(e) => setConfig({ ...config, hashtag: e.target.value })} />
          </label>
        </>
      )}
    </SettingsCard>
  );
}
