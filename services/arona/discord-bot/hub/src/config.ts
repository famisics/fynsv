import { z } from "zod";

const schema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_CLIENT_SECRET: z.string().min(1),
  PUBLIC_URL: z.url().transform((u) => u.replace(/\/$/, "")),
  PORT: z.coerce.number().int().default(8091),
  DB_PATH: z.string().min(1),
  MISSKEY_ORIGIN: z.url().transform((u) => u.replace(/\/$/, "")),
  MISSKEY_USER_ID: z.string().min(1),
  MISSKEY_USER_TOKEN: z.string().min(1),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    const keys = result.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`環境変数が不足または不正です: ${keys}`);
  }
  return result.data;
}
