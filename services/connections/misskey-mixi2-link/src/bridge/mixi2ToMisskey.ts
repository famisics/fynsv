import type { PostCreatedEvent } from "mixi2-js";
import { log } from "../log.js";
import type { MisskeyClient } from "../misskey/client.js";
import { withRetry } from "../retry.js";
import type { BridgeStore } from "../store.js";
import { stripMention } from "./text.js";

const DIRECTION = "mixi2->misskey" as const;

export class Mixi2ToMisskey {
  constructor(
    private readonly deps: {
      store: BridgeStore;
      misskeyBot: MisskeyClient;
      /** 本人のスクリーンネーム (@ なし)。イベントの issuer (投稿者) と照合する */
      ownerName: string;
      /** bot 宛てメンション表記 (例: "@linkbot") */
      botMention: string;
      dryRun: boolean;
    },
  ) {}

  async handleMentionedPost(event: PostCreatedEvent): Promise<void> {
    const { store, misskeyBot, ownerName, botMention, dryRun } = this.deps;
    const post = event.post;
    if (!post || post.isDeleted) return;
    if (event.issuer?.name !== ownerName) {
      log("info", "mention from non-owner ignored", {
        postId: post.postId,
        issuer: event.issuer?.name ?? null,
      });
      return;
    }
    if (await store.isProcessed(DIRECTION, post.postId)) return;

    const text = stripMention(post.text ?? "", botMention);
    const images = post.postMediaList.flatMap((m) => (m.image ? [m.image] : []));
    if (!text && images.length === 0) return;

    if (dryRun) {
      log("info", "[dry-run] would post to misskey", { postId: post.postId, text, images: images.length });
      return;
    }

    const fileIds: string[] = [];
    for (const [i, image] of images.entries()) {
      const file = await withRetry(async () => {
        const res = await fetch(image.largeImageUrl);
        if (!res.ok) throw new Error(`image fetch failed: ${res.status}`);
        const ext = image.largeImageMimeType.split("/")[1] ?? "jpg";
        return misskeyBot.uploadToDrive(
          await res.arrayBuffer(),
          `mixi2-${post.postId}-${i}.${ext}`,
          image.largeImageMimeType,
        );
      });
      fileIds.push(file.id);
    }
    const note = await withRetry(() =>
      misskeyBot.createNote({ text: text || null, fileIds }),
    );
    await store.record(DIRECTION, post.postId, note.id);
    log("info", "forwarded mixi2 -> misskey", { postId: post.postId, noteId: note.id });
  }
}
