import { type ReactNode, useEffect, useState } from "react";
import type { FeatureConfig, FeatureName } from "../../shared/features.ts";
import { type FeatureSettings, getSettings, putSettings } from "../../client.ts";

type Props<F extends FeatureName> = {
  guildId: string;
  feature: F;
  title: string;
  description: string;
  children: (config: FeatureConfig<F>, setConfig: (c: FeatureConfig<F>) => void) => ReactNode;
};

// 機能の有効・無効と設定を読み込んで保存する共通の枠
export function SettingsCard<F extends FeatureName>({ guildId, feature, title, description, children }: Props<F>) {
  const [settings, setSettings] = useState<FeatureSettings<F> | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getSettings(guildId, feature).then(setSettings, (e: Error) => setMessage({ text: e.message, error: true }));
  }, [guildId, feature]);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      setSettings(await putSettings(guildId, feature, settings));
      setMessage({ text: "保存しました", error: false });
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>{title}</h2>
        {settings && (
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
            />
            有効
          </label>
        )}
      </div>
      <p className="hint">{description}</p>
      {settings && children(settings.config, (config) => setSettings({ ...settings, config }))}
      <div className="actions">
        <button type="button" className="primary" disabled={!settings || saving} onClick={save}>
          保存
        </button>
        {message && <span className={message.error ? "error" : "ok"}>{message.text}</span>}
      </div>
    </section>
  );
}
