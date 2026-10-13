import { errorMessage, log } from "./log.ts";

export type NoteFile = { type: string; url: string | null };

// 転送に必要な Misskey のノートの項目だけ
export type Note = {
  id: string;
  userId: string;
  text: string | null;
  cw: string | null;
  replyId: string | null;
  renoteId: string | null;
  visibility: string;
  files: NoteFile[];
  tags: string[];
};

export class MisskeyClient {
  constructor(
    private origin: string,
    private token: string,
  ) {}

  private async request<T>(endpoint: string, params: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.origin}/api/${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...params, i: this.token }),
    });
    if (!res.ok) throw new Error(`misskey ${endpoint} failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  // sinceId より後の本人のノートを古い順に返す
  async fetchUserNotes(userId: string, sinceId: string): Promise<Note[]> {
    const notes = await this.request<Note[]>("users/notes", {
      userId,
      sinceId,
      limit: 100,
      withReplies: true,
      withRenotes: true,
    });
    return notes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  async fetchLatestNote(userId: string): Promise<Note | null> {
    const notes = await this.request<Note[]>("users/notes", {
      userId,
      limit: 1,
      withReplies: true,
      withRenotes: true,
    });
    return notes[0] ?? null;
  }

  async resolveUserId(username: string): Promise<string> {
    const res = await this.request<{ id: string }>("users/show", { username });
    return res.id;
  }
}

const RECONNECT_DELAY_MS = 3000;

// homeTimeline を購読し、本人のノートを 1 件ずつ到着順に onNote へ渡す。
// onNote が失敗してもログに残すだけで購読は止めない
export class MisskeyWatcher {
  private ws: WebSocket | null = null;
  private stopped = false;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private origin: string,
    private token: string,
    private userId: string,
    private onNote: (note: Note) => Promise<void>,
  ) {}

  start() {
    this.connect();
  }

  stop() {
    this.stopped = true;
    this.ws?.close();
  }

  private connect() {
    const wsOrigin = this.origin.replace(/^http/, "ws");
    const ws = new WebSocket(`${wsOrigin}/streaming?i=${encodeURIComponent(this.token)}&_t=${Date.now()}`);
    this.ws = ws;
    const connId = "home";

    ws.onopen = () => {
      log.info("misskey stream connected");
      ws.send(
        JSON.stringify({
          type: "connect",
          body: { channel: "homeTimeline", id: connId, params: { withRenotes: true } },
        }),
      );
    };
    ws.onmessage = (ev) => {
      const note = this.parseNote(String(ev.data), connId);
      if (note) this.enqueue(note);
    };
    ws.onclose = () => {
      if (this.stopped) return;
      log.warn("misskey stream disconnected");
      setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
    };
    ws.onerror = () => {
      // 切断は onclose 側で再接続する
    };
  }

  private parseNote(raw: string, connId: string): Note | null {
    let msg: { type?: string; body?: { id?: string; type?: string; body?: Note } };
    try {
      msg = JSON.parse(raw);
    } catch {
      return null;
    }
    if (msg.type !== "channel" || msg.body?.id !== connId || msg.body.type !== "note") return null;
    const note = msg.body.body;
    return note && note.userId === this.userId ? note : null;
  }

  private enqueue(note: Note) {
    this.chain = this.chain.then(() =>
      this.onNote(note).catch((e) =>
        log.error("misskey note handler failed", { noteId: note.id, error: errorMessage(e) }),
      ),
    );
  }
}
