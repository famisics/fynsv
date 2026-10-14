import { useState } from "react";
import { deleteReminder, getReminders, saveReminder } from "../../api.ts";
import { useAsync } from "../../hooks.ts";
import type { ReminderBody } from "../../shared/features.ts";
import { formatJst, jstParts, parseJstInput, toJstInput } from "../../shared/jst.ts";
import { type Repeat, formatRepeat } from "../../shared/repeat.ts";
import { ChannelSelect } from "./ChannelSelect.tsx";
import { SettingsCard } from "./SettingsCard.tsx";

type Channel = { id: string; name: string };
type RepeatType = "none" | Repeat["type"];
type Draft = { channelId: string | null; at: string; message: string; repeat: RepeatType; days: number[] };

const emptyDraft: Draft = { channelId: null, at: "", message: "", repeat: "none", days: [] };

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function draftOf(r: { channelId: string; fireAt: number; message: string; repeat: Repeat | null }): Draft {
  return {
    channelId: r.channelId,
    at: toJstInput(r.fireAt),
    message: r.message,
    repeat: r.repeat?.type ?? "none",
    days: r.repeat?.type === "weekly" ? r.repeat.days : [],
  };
}

// 毎週で曜日を選んでいなければ、最初の日時の曜日にする。毎月の日付は、サーバー側でも最初の日時の日にそろえる
function toRepeat(draft: Draft, fireAt: number): Repeat | null {
  const { weekday, day } = jstParts(fireAt);
  if (draft.repeat === "daily") return { type: "daily" };
  if (draft.repeat === "weekly") return { type: "weekly", days: draft.days.length > 0 ? draft.days : [weekday] };
  if (draft.repeat === "monthly") return { type: "monthly", day };
  return null;
}

// 新規作成と編集で共通のフォーム
function ReminderForm({
  channels,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  channels: Channel[];
  initial: Draft;
  submitLabel: string;
  onSubmit: (body: ReminderBody) => Promise<void>;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const fireAt = parseJstInput(draft.at);
    if (!draft.channelId || fireAt === null || draft.message.trim() === "") {
      setError("チャンネル・日時 (日本時間)・メッセージをすべて入力してください");
      return;
    }
    setSaving(true);
    try {
      await onSubmit({ channelId: draft.channelId, fireAt, message: draft.message, repeat: toRepeat(draft, fireAt) });
      setError(null);
      setDraft(initial);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="reminder-form">
      <ChannelSelect channels={channels} value={draft.channelId} onChange={(channelId) => setDraft({ ...draft, channelId })} />
      <input type="datetime-local" value={draft.at} onChange={(e) => setDraft({ ...draft, at: e.target.value })} />
      <select value={draft.repeat} onChange={(e) => setDraft({ ...draft, repeat: e.target.value as RepeatType })}>
        <option value="none">繰り返さない</option>
        <option value="daily">毎日</option>
        <option value="weekly">毎週</option>
        <option value="monthly">毎月</option>
      </select>
      {draft.repeat === "weekly" && (
        <span className="checks">
          {WEEKDAYS.map((name, d) => (
            <label key={name}>
              <input
                type="checkbox"
                checked={draft.days.includes(d)}
                onChange={(e) =>
                  setDraft({ ...draft, days: e.target.checked ? [...draft.days, d] : draft.days.filter((x) => x !== d) })
                }
              />
              {name}
            </label>
          ))}
        </span>
      )}
      <input
        className="grow"
        type="text"
        maxLength={1000}
        placeholder="メッセージ"
        value={draft.message}
        onChange={(e) => setDraft({ ...draft, message: e.target.value })}
      />
      <button type="button" className="primary" disabled={saving} onClick={submit}>
        {submitLabel}
      </button>
      {onCancel && (
        <button type="button" onClick={onCancel}>
          キャンセル
        </button>
      )}
      {error && <span className="error">{error}</span>}
    </div>
  );
}

export function ReminderPanel({ guildId, channels }: { guildId: string; channels: Channel[] }) {
  const reminders = useAsync(() => getReminders(guildId), [guildId]);
  const [editingId, setEditingId] = useState<number | null>(null);

  return (
    <SettingsCard
      guildId={guildId}
      feature="reminder"
      title="リマインダー"
      description="スラッシュコマンド /remind と、この画面で予約した通知です。毎日・毎週・毎月の繰り返しは、取り消すまで続きます (毎月で日が無い月は末日)。無効にすると、このサーバーでは /remind を使えません (画面からの予約は、有効・無効に関わらず送られます)。"
    >
      {() => (
        <>
          <h3>予約中</h3>
          {reminders.data?.length === 0 && <p className="hint">予約はありません。</p>}
          <ul className="rows">
            {reminders.data?.map((r) => (
              <li key={r.id}>
                {editingId === r.id ? (
                  <ReminderForm
                    channels={channels}
                    initial={draftOf(r)}
                    submitLabel="保存"
                    onCancel={() => setEditingId(null)}
                    onSubmit={async (body) => {
                      await saveReminder(guildId, r.id, body);
                      setEditingId(null);
                      reminders.reload();
                    }}
                  />
                ) : (
                  <>
                    <span className="when">{formatJst(r.fireAt)}</span>
                    {r.repeat && <span className="where">{formatRepeat(r.repeat)}</span>}
                    <span className="where">#{channels.find((c) => c.id === r.channelId)?.name ?? "不明"}</span>
                    <span className="grow">{r.message}</span>
                    <button type="button" onClick={() => setEditingId(r.id)}>
                      編集
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await deleteReminder(guildId, r.id);
                        reminders.reload();
                      }}
                    >
                      取り消す
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          <h3>追加</h3>
          <ReminderForm
            channels={channels}
            initial={emptyDraft}
            submitLabel="追加"
            onSubmit={async (body) => {
              await saveReminder(guildId, null, body);
              reminders.reload();
            }}
          />
        </>
      )}
    </SettingsCard>
  );
}
