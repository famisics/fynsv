import { SettingsCard } from "./SettingsCard.tsx";

export function RolesyncPanel({ guildId, roles }: { guildId: string; roles: { id: string; name: string }[] }) {
  return (
    <SettingsCard
      guildId={guildId}
      feature="rolesync"
      title="ロール自動付与"
      description="ソースロールのいずれかを持つメンバーに、ターゲットロールを 15 分ごとに付与します。bot のロールは、ターゲットロールより上に置いてください。"
    >
      {(config, setConfig) => (
        <>
          {config.rules.map((rule, i) => {
            const update = (patch: Partial<typeof rule>) =>
              setConfig({ rules: config.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: ルールに識別子が無く、並べ替えもしない
              <fieldset key={i}>
                <legend>ルール {i + 1}</legend>
                <p className="label">ソースロール (いずれか)</p>
                <div className="checks">
                  {roles.map((r) => (
                    <label key={r.id}>
                      <input
                        type="checkbox"
                        checked={rule.sourceRoleIds.includes(r.id)}
                        onChange={(e) =>
                          update({
                            sourceRoleIds: e.target.checked
                              ? [...rule.sourceRoleIds, r.id]
                              : rule.sourceRoleIds.filter((id) => id !== r.id),
                          })
                        }
                      />
                      {r.name}
                    </label>
                  ))}
                </div>
                <label className="label">
                  ターゲットロール
                  <select value={rule.targetRoleId} onChange={(e) => update({ targetRoleId: e.target.value })}>
                    <option value="">選択してください</option>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={() => setConfig({ rules: config.rules.filter((_, j) => j !== i) })}>
                  このルールを削除
                </button>
              </fieldset>
            );
          })}
          <button
            type="button"
            onClick={() => setConfig({ rules: [...config.rules, { sourceRoleIds: [], targetRoleId: "" }] })}
          >
            ルールを追加
          </button>
        </>
      )}
    </SettingsCard>
  );
}
