import { type Client, Events } from "discord.js";
import { errorMessage, log } from "../log.ts";
import { listEnabled } from "../settings.ts";
import type { FeatureConfig } from "../shared/features.ts";
import type { Store } from "../store.ts";

const INTERVAL_MS = 15 * 60 * 1000;
const PAGE_SIZE = 1000;

type Rule = FeatureConfig<"rolesync">["rules"][number];

// メンバーが持つロールのうち、ソースロールがあってターゲットロールが無いルールのターゲットを返す
export function rolesToAdd(memberRoleIds: readonly string[], rules: readonly Rule[]): string[] {
  const owned = new Set(memberRoleIds);
  return rules
    .filter((r) => !owned.has(r.targetRoleId) && r.sourceRoleIds.some((id) => owned.has(id)))
    .map((r) => r.targetRoleId);
}

async function syncGuild(client: Client, guildId: string, rules: Rule[]): Promise<number> {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return 0;
  let added = 0;
  let after: string | undefined;
  for (;;) {
    const page = await guild.members.list({ limit: PAGE_SIZE, after });
    if (page.size === 0) break;
    for (const member of page.values()) {
      after = member.id;
      for (const roleId of rolesToAdd([...member.roles.cache.keys()], rules)) {
        try {
          await member.roles.add(roleId);
          added++;
        } catch (e) {
          log.error("ロール同期: ロール付与に失敗しました", {
            guildId,
            member: member.id,
            role: roleId,
            error: errorMessage(e),
          });
        }
      }
    }
    if (page.size < PAGE_SIZE) break;
  }
  return added;
}

export function registerRolesync(client: Client, store: Store) {
  const run = async () => {
    for (const { guildId, config } of listEnabled(store, "rolesync")) {
      if (config.rules.length === 0) continue;
      try {
        const added = await syncGuild(client, guildId, config.rules);
        if (added > 0) log.info("ロール同期: ロールを付与しました", { guildId, count: added });
      } catch (e) {
        log.error("ロール同期: メンバー一覧の取得に失敗しました", { guildId, error: errorMessage(e) });
      }
    }
  };

  // 前回の実行が終わってから次を待つ (実行時間が間隔を超えても重ならない)
  const loop = async () => {
    await run();
    setTimeout(() => void loop(), INTERVAL_MS);
  };
  client.once(Events.ClientReady, () => void loop());
}
