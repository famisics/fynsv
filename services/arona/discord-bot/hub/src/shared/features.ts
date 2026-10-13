import { z } from "zod";

const snowflake = z.string().regex(/^\d{17,20}$/);

// 機能ごとの設定。bot・API・画面の 3 か所がこのスキーマを共有する
export const featureDefs = {
  reminder: {
    enabled: true,
    schema: z.object({}),
    default: {},
  },
  rolesync: {
    enabled: false,
    schema: z.object({
      rules: z
        .array(
          z.object({
            sourceRoleIds: z.array(snowflake).min(1).max(25),
            targetRoleId: snowflake,
          }),
        )
        .max(20),
    }),
    default: { rules: [] },
  },
  welcome: {
    enabled: false,
    // {user} は参加時はメンション、退出時はユーザー名。{server} はサーバー名。空文字の側は送らない
    schema: z.object({
      channelId: snowflake.nullable(),
      joinMessage: z.string().max(1000),
      leaveMessage: z.string().max(1000),
    }),
    default: { channelId: null, joinMessage: "", leaveMessage: "" },
  },
  misskeylink: {
    enabled: false,
    schema: z.object({
      channelId: snowflake.nullable(),
      hashtag: z.string().max(100),
    }),
    default: { channelId: null, hashtag: "" },
  },
} as const;

export type FeatureName = keyof typeof featureDefs;
export const featureNames = Object.keys(featureDefs) as FeatureName[];
export type FeatureConfig<F extends FeatureName> = z.infer<(typeof featureDefs)[F]["schema"]>;

export function isFeatureName(name: string): name is FeatureName {
  return name in featureDefs;
}

// 保存形式。PUT で受け取る本体も同じ形
export const featureSettingsBody = z.object({ enabled: z.boolean(), config: z.unknown() });

const dataUri = z.string().regex(/^data:image\/(png|jpeg|gif|webp);base64,/).max(8_000_000);

// undefined は変更なし、null は初期状態に戻す
export const profileBody = z.object({
  nick: z.string().max(32).nullable().optional(),
  bio: z.string().max(400).nullable().optional(),
  avatar: dataUri.nullable().optional(),
  banner: dataUri.nullable().optional(),
});
export type ProfileBody = z.infer<typeof profileBody>;

// ギルド一覧の 1 件。管理画面に表示する
export type GuildSummary = {
  id: string;
  name: string;
  iconUrl: string | null;
  joined: boolean;
  inviteUrl: string | null;
};
