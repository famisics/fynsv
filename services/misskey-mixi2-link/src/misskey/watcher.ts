import * as Misskey from "misskey-js";
import { log } from "../log.js";
import type { Note } from "./client.js";

/**
 * homeTimeline ストリームを購読し、本人のノートだけを順番にハンドラへ渡す。
 * ハンドラは直列に実行され、失敗してもストリームは止めない。
 */
export class MisskeyWatcher {
  private stream?: Misskey.Stream;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly opts: {
      origin: string;
      token: string;
      userId: string;
      onNote: (note: Note) => Promise<void>;
    },
  ) {}

  start(): void {
    this.stream = new Misskey.Stream(
      this.opts.origin,
      { token: this.opts.token },
      { WebSocket: globalThis.WebSocket as never },
    );
    this.stream.on("_connected_", () => log("info", "misskey stream connected"));
    this.stream.on("_disconnected_", () => log("warn", "misskey stream disconnected"));

    const channel = this.stream.useChannel("homeTimeline", { withRenotes: true });
    channel.on("note", (note: Note) => {
      if (note.userId !== this.opts.userId) return;
      this.queue = this.queue.then(async () => {
        try {
          await this.opts.onNote(note);
        } catch (err) {
          log("error", "misskey note handler failed", { noteId: note.id, error: String(err) });
        }
      });
    });
  }

  stop(): void {
    this.stream?.close();
  }
}
