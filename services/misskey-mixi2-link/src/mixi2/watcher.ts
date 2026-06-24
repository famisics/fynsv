import {
  EventReason,
  EventType,
  StreamWatcher,
  type Authenticator,
  type PostCreatedEvent,
} from "mixi2-js";
import { EventDeduplicator, EventRouter, ReasonFilter, streamAddress } from "mixi2-js/helpers";
import { log } from "../log.js";

const RECONNECT_DELAY_MS = 15_000;

/**
 * mixi2 の gRPC ストリームを購読し、bot 宛てメンション (POST_MENTIONED) の
 * PostCreatedEvent だけをハンドラへ渡す。切断時は再接続し続ける。
 */
export class Mixi2Watcher {
  private watcher?: StreamWatcher;
  private stopped = false;

  constructor(
    private readonly opts: {
      authenticator: Authenticator;
      onMentionedPost: (event: PostCreatedEvent) => Promise<void>;
    },
  ) {}

  async start(): Promise<void> {
    const router = new EventRouter().on(EventType.POST_CREATED, async (event) => {
      const postCreated = event.postCreatedEvent;
      if (!postCreated) return;
      try {
        await this.opts.onMentionedPost(postCreated);
      } catch (err) {
        log("error", "mixi2 mention handler failed", {
          postId: postCreated.post?.postId,
          error: String(err),
        });
      }
    });
    const handler = new EventDeduplicator(new ReasonFilter(router, [EventReason.POST_MENTIONED]));

    while (!this.stopped) {
      this.watcher = new StreamWatcher({ streamAddress, authenticator: this.opts.authenticator });
      try {
        log("info", "mixi2 stream connecting");
        await this.watcher.watch(handler);
      } catch (err) {
        log("error", "mixi2 stream failed", { error: String(err) });
      }
      if (this.stopped) break;
      log("warn", "mixi2 stream ended, reconnecting", { delayMs: RECONNECT_DELAY_MS });
      await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY_MS));
    }
  }

  stop(): void {
    this.stopped = true;
    this.watcher?.stop();
  }
}
