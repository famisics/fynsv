import { log } from "../log.js";
import type { MisskeyClient, Note } from "../misskey/client.js";
import type { Mixi2Client } from "../mixi2/client.js";
import { withRetry } from "../retry.js";
import type { BridgeStore } from "../store.js";
import { imageFiles, shouldForwardNote } from "./filters.js";
import { formatForMixi2, stripMention } from "./text.js";

const DIRECTION = "misskey->mixi2" as const;
const CURSOR_KEY = "misskey_last_note_id";
const MIXI2_MAX_MEDIA = 4;

export class MisskeyToMixi2 {
  constructor(
    private readonly deps: {
      store: BridgeStore;
      misskey: MisskeyClient;
      mixi2: Mixi2Client;
      misskeyUserId: string;
      /** この bot 宛てメンションを含むノートだけ転送する (例: "@uiroid") */
      misskeyBotMention: string;
      misskeyPublicOrigin: string;
      dryRun: boolean;
    },
  ) {}

  /** カーソルが無い初回は転送せず最新ノートに合わせ、以降の起動では停止中のノートを拾う。 */
  async backfill(): Promise<void> {
    const { store, misskey, misskeyUserId, dryRun } = this.deps;
    const cursor = await store.getCursor(CURSOR_KEY);
    if (cursor == null) {
      if (dryRun) return;
      const latest = await misskey.fetchLatestNote(misskeyUserId);
      if (latest) await store.setCursor(CURSOR_KEY, latest.id);
      log("info", "misskey cursor initialized", { noteId: latest?.id ?? null });
      return;
    }
    const notes = await misskey.fetchUserNotes(misskeyUserId, cursor);
    if (notes.length > 0) log("info", "misskey backfill", { count: notes.length });
    for (const note of notes) {
      await this.handleNote(note);
    }
  }

  async handleNote(note: Note): Promise<void> {
    const { store, mixi2, misskeyUserId, misskeyBotMention, misskeyPublicOrigin, dryRun } = this.deps;

    if (
      (await store.isProcessed(DIRECTION, note.id)) ||
      !shouldForwardNote(note, misskeyUserId, misskeyBotMention)
    ) {
      await this.advanceCursor(note.id);
      return;
    }

    const images = imageFiles(note);
    const body = stripMention(note.text ?? "", misskeyBotMention);
    if (!body && images.length === 0) {
      await this.advanceCursor(note.id);
      return;
    }
    if (images.length > MIXI2_MAX_MEDIA) {
      log("warn", "too many images, extra ones dropped", {
        noteId: note.id,
        dropped: images.length - MIXI2_MAX_MEDIA,
      });
    }
    const noteUrl = `${misskeyPublicOrigin}/notes/${note.id}`;
    const text = formatForMixi2(body, noteUrl);

    if (dryRun) {
      log("info", "[dry-run] would post to mixi2", { noteId: note.id, text, images: images.length });
      return;
    }

    try {
      const mediaIds: string[] = [];
      for (const image of images.slice(0, MIXI2_MAX_MEDIA)) {
        const mediaId = await withRetry(async () => {
          const res = await fetch(image.url);
          if (!res.ok) throw new Error(`image fetch failed: ${res.status}`);
          return mixi2.uploadImage(await res.arrayBuffer(), image.type);
        });
        mediaIds.push(mediaId);
      }
      const post = await withRetry(() => mixi2.createPost(text, mediaIds));
      await store.record(DIRECTION, note.id, post.postId);
      log("info", "forwarded misskey -> mixi2", { noteId: note.id, postId: post.postId });
    } catch (err) {
      log("error", "forward misskey -> mixi2 failed, skipped", {
        noteId: note.id,
        error: String(err),
      });
    }
    await this.advanceCursor(note.id);
  }

  private async advanceCursor(noteId: string): Promise<void> {
    if (this.deps.dryRun) return;
    const current = await this.deps.store.getCursor(CURSOR_KEY);
    if (current == null || current < noteId) {
      await this.deps.store.setCursor(CURSOR_KEY, noteId);
    }
  }
}
