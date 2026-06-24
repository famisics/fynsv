export interface Config {
  misskeyOrigin: string;
  misskeyPublicOrigin: string;
  /** 本人のスクリーンネーム。起動時に実ユーザー ID へ解決する */
  misskeyUserId: string;
  misskeyUserToken: string;
  misskeyBotToken: string;
  /** Misskey bot のスクリーンネームから組み立てたメンション表記。これを含む本人ノートだけ転送する (例: "@uiroid") */
  misskeyBotMention: string;
  mixi2ClientId: string;
  mixi2ClientSecret: string;
  /** bot のスクリーンネームから組み立てたメンション表記 (例: "@linkbot") */
  mixi2BotMention: string;
  /** 本人のスクリーンネーム。メンション元の検証用 */
  mixi2UserId: string;
  tursoDatabaseUrl: string;
  /** file: URL のローカル DB では不要 */
  tursoAuthToken?: string;
  dryRun: boolean;
}

const REQUIRED = [
  "MISSKEY_ORIGIN",
  "MISSKEY_PUBLIC_ORIGIN",
  "MISSKEY_USER_ID",
  "MISSKEY_USER_TOKEN",
  "MISSKEY_BOT_TOKEN",
  "MISSKEY_BOT_ID",
  "MIXI2_CLIENT_ID",
  "MIXI2_CLIENT_SECRET",
  "MIXI2_BOT_ID",
  "MIXI2_USER_ID",
  "TURSO_DATABASE_URL",
] as const;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const missing = REQUIRED.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`missing environment variables: ${missing.join(", ")}`);
  }
  return {
    misskeyOrigin: env.MISSKEY_ORIGIN!.replace(/\/$/, ""),
    misskeyPublicOrigin: env.MISSKEY_PUBLIC_ORIGIN!.replace(/\/$/, ""),
    misskeyUserId: env.MISSKEY_USER_ID!,
    misskeyUserToken: env.MISSKEY_USER_TOKEN!,
    misskeyBotToken: env.MISSKEY_BOT_TOKEN!,
    misskeyBotMention: `@${env.MISSKEY_BOT_ID!.replace(/^@/, "")}`,
    mixi2ClientId: env.MIXI2_CLIENT_ID!,
    mixi2ClientSecret: env.MIXI2_CLIENT_SECRET!,
    mixi2BotMention: `@${env.MIXI2_BOT_ID!.replace(/^@/, "")}`,
    mixi2UserId: env.MIXI2_USER_ID!.replace(/^@/, ""),
    tursoDatabaseUrl: env.TURSO_DATABASE_URL!,
    tursoAuthToken: env.TURSO_AUTH_TOKEN || undefined,
    dryRun: env.DRY_RUN === "1",
  };
}
