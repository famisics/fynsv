import { type Client, Events } from "discord.js";
import type { Config } from "../config.server.ts";
import { errorMessage, log } from "../log.server.ts";
import { type MisskeyClient, MisskeyWatcher, type Note } from "../misskey.server.ts";
import { listEnabled } from "../settings.server.ts";
import type { Store } from "../store.server.ts";

// Misskey のタグ正規化 (小文字・先頭の # なし) に合わせる
export function normalizeHashtag(hashtag: string): string {
  return hashtag.replace(/^#/, "").toLowerCase();
}

// 本人の公開ノートで、リプライ・リノート・CW のいずれでもなく、設定のハッシュタグを含むものだけ転送する
export function shouldForwardNote(note: Note, selfUserId: string, hashtag: string): boolean {
  if (note.userId !== selfUserId) return false;
  if (note.replyId !== null || note.renoteId !== null) return false;
  if (note.visibility !== "public" || note.cw !== null) return false;
  const tag = normalizeHashtag(hashtag);
  if (tag === "") return false;
  return note.tags.some((t) => t.toLowerCase() === tag);
}

export function formatMessage(note: Note): string {
  const lines: string[] = [];
  if (note.text) lines.push(note.text);
  for (const f of note.files) {
    if (f.url && f.type.startsWith("image/")) lines.push(f.url);
  }
  return lines.join("\n");
}

class Bridge {
  constructor(
    private client: Client,
    private store: Store,
    private misskey: MisskeyClient,
    private userId: string,
  ) {}

  // 前回のカーソル以降の取りこぼしを転送する。初回はカーソルを最新に合わせるだけで、過去分は送らない
  async backfill() {
    const cursor = this.store.getCursor();
    if (cursor === null) {
      const latest = await this.misskey.fetchLatestNote(this.userId);
      if (latest) this.store.setCursor(latest.id);
      log.info("misskey cursor initialized", { noteId: latest?.id ?? null });
      return;
    }
    const notes = await this.misskey.fetchUserNotes(this.userId, cursor);
    if (notes.length > 0) log.info("misskey backfill", { count: notes.length });
    for (const note of notes) await this.handleNote(note);
  }

  // 転送に失敗しても、条件に合わなくても、カーソルは必ず進める
  async handleNote(note: Note) {
    for (const { guildId, config } of listEnabled(this.store, "misskeylink")) {
      if (!config.channelId || !shouldForwardNote(note, this.userId, config.hashtag)) continue;
      if (this.store.isForwarded(note.id, guildId)) continue;
      const channel = this.client.guilds.cache.get(guildId)?.channels.cache.get(config.channelId);
      if (!channel?.isSendable()) {
        log.warn("転送先チャンネルが見つかりません", { noteId: note.id, guildId });
        continue;
      }
      try {
        await channel.send({ content: formatMessage(note), allowedMentions: { parse: [] } });
        this.store.markForwarded(note.id, guildId);
        log.info("forwarded misskey note to discord", { noteId: note.id, guildId });
      } catch (e) {
        log.error("forward misskey note to discord failed, skipped", {
          noteId: note.id,
          guildId,
          error: errorMessage(e),
        });
      }
    }
    const cursor = this.store.getCursor();
    if (cursor === null || cursor < note.id) this.store.setCursor(note.id);
  }
}

export function registerMisskeyLink(client: Client, store: Store, config: Config, misskey: MisskeyClient) {
  client.once(Events.ClientReady, async () => {
    try {
      const userId = await misskey.resolveUserId(config.MISSKEY_USER_ID);
      const bridge = new Bridge(client, store, misskey, userId);
      await bridge.backfill();
      new MisskeyWatcher(config.MISSKEY_ORIGIN, config.MISSKEY_USER_TOKEN, userId, (n) =>
        bridge.handleNote(n),
      ).start();
    } catch (e) {
      log.error("misskey 連携の起動に失敗しました", { error: errorMessage(e) });
    }
  });
}
