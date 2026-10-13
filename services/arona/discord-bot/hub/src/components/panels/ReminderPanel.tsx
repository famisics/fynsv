import { formatJst } from "../../shared/jst.ts";
import { deleteReminder, getReminders } from "../../client.ts";
import { useAsync } from "../../hooks.ts";
import { SettingsCard } from "./SettingsCard.tsx";

export function ReminderPanel({ guildId, channels }: { guildId: string; channels: { id: string; name: string }[] }) {
  const reminders = useAsync(() => getReminders(guildId), [guildId]);

  return (
    <SettingsCard
      guildId={guildId}
      feature="reminder"
      title="リマインダー"
      description="スラッシュコマンド /remind で予約された通知です。無効にすると、このサーバーでは /remind を使えません。"
    >
      {() => (
        <>
          <h3>予約中</h3>
          {reminders.data?.length === 0 && <p className="hint">予約はありません。</p>}
          <ul className="rows">
            {reminders.data?.map((r) => (
              <li key={r.id}>
                <span className="when">{formatJst(r.fireAt)}</span>
                <span className="where">#{channels.find((c) => c.id === r.channelId)?.name ?? "不明"}</span>
                <span className="grow">{r.message}</span>
                <button
                  type="button"
                  onClick={async () => {
                    await deleteReminder(guildId, r.id);
                    reminders.reload();
                  }}
                >
                  取り消す
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </SettingsCard>
  );
}
