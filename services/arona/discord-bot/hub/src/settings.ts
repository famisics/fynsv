import { type FeatureConfig, type FeatureName, featureDefs } from "./shared/features.ts";
import type { Store } from "./store.ts";

export type FeatureSettings<F extends FeatureName> = { enabled: boolean; config: FeatureConfig<F> };

// 未保存のギルドは機能ごとの既定値を返す
export function loadSettings<F extends FeatureName>(
  store: Store,
  guildId: string,
  feature: F,
): FeatureSettings<F> {
  const saved = store.getSetting(guildId, feature);
  const def = featureDefs[feature];
  if (!saved) return { enabled: def.enabled, config: def.default as FeatureConfig<F> };
  return { enabled: saved.enabled, config: def.schema.parse(saved.config) as FeatureConfig<F> };
}

// 機能が有効で保存済みのギルドの設定一覧 (rolesync など全ギルドを走査する機能向け)。
// 既定で有効な機能は未保存のギルドも対象だが、設定を持たない reminder にしか該当しないので含めない
export function listEnabled<F extends FeatureName>(
  store: Store,
  feature: F,
): { guildId: string; config: FeatureConfig<F> }[] {
  const schema = featureDefs[feature].schema;
  return store
    .listSettings(feature)
    .filter((s) => s.enabled)
    .map((s) => ({ guildId: s.guildId, config: schema.parse(s.config) as FeatureConfig<F> }));
}
