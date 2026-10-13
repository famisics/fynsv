import { useState } from "react";
import type { ProfileBody } from "../../shared/features.ts";
import { getProfile, putProfile } from "../../api.ts";
import { useAsync } from "../../hooks.ts";

// Discord に送れる画像の大きさ (base64 で 8MB 未満) に収まる元ファイルの上限
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

function readAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// null は「元に戻す」、undefined は「変更しない」
type ImageField = { file?: File; reset: boolean };

export function ProfilePanel({ guildId }: { guildId: string }) {
  const profile = useAsync(() => getProfile(guildId), [guildId]);
  const [nick, setNick] = useState<string | null>(null);
  const [bio, setBio] = useState("");
  const [avatar, setAvatar] = useState<ImageField>({ reset: false });
  const [banner, setBanner] = useState<ImageField>({ reset: false });
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  const nickValue = nick ?? profile.data?.nick ?? "";

  const toImage = async (f: ImageField) =>
    f.reset ? null : f.file ? await readAsDataUri(f.file) : undefined;

  const save = async () => {
    setSaving(true);
    try {
      const body: ProfileBody = {
        nick: nick === null ? undefined : nick === "" ? null : nick,
        bio: bio === "" ? undefined : bio,
        avatar: await toImage(avatar),
        banner: await toImage(banner),
      };
      await putProfile(guildId, body);
      setNick(null);
      setBio("");
      setAvatar({ reset: false });
      setBanner({ reset: false });
      profile.reload();
      setMessage({ text: "保存しました", error: false });
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    } finally {
      setSaving(false);
    }
  };

  const picker = (label: string, value: ImageField, set: (f: ImageField) => void) => (
    <div className="label">
      {label}
      <input
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && file.size > MAX_IMAGE_BYTES) {
            setMessage({ text: "画像は 6MB 以下にしてください", error: true });
            e.target.value = "";
            return;
          }
          set({ file, reset: false });
        }}
      />
      <label className="inline">
        <input
          type="checkbox"
          checked={value.reset}
          onChange={(e) => set({ file: undefined, reset: e.target.checked })}
        />
        初期状態に戻す
      </label>
    </div>
  );

  return (
    <section className="card">
      <div className="card-head">
        <h2>bot の見た目</h2>
      </div>
      <p className="hint">
        このサーバーの中だけで、bot の名前と画像を変えます。アプリ自体の名前 (スラッシュコマンド一覧の表示) は変わりません。入力した項目だけが更新されます。
      </p>
      {profile.data?.avatarUrl && <img className="avatar" src={profile.data.avatarUrl} alt="現在のアイコン" />}
      <label className="label">
        ニックネーム
        <input maxLength={32} value={nickValue} onChange={(e) => setNick(e.target.value)} />
      </label>
      <label className="label">
        自己紹介
        <textarea rows={3} maxLength={400} value={bio} onChange={(e) => setBio(e.target.value)} />
      </label>
      {picker("アイコン", avatar, setAvatar)}
      {picker("バナー", banner, setBanner)}
      <div className="actions">
        <button type="button" className="primary" disabled={saving} onClick={save}>
          保存
        </button>
        {message && <span className={message.error ? "error" : "ok"}>{message.text}</span>}
      </div>
    </section>
  );
}
