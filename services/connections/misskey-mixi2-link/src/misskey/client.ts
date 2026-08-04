import type { entities } from "misskey-js";

export type Note = entities.Note;

export class MisskeyClient {
  constructor(
    private readonly origin: string,
    private readonly token: string,
  ) {}

  private async request<T>(endpoint: string, params: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.origin}/api/${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...params, i: this.token }),
    });
    if (!res.ok) {
      throw new Error(`misskey ${endpoint} failed: ${res.status} ${await res.text()}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  async createNote(params: { text: string | null; fileIds?: string[] }): Promise<Note> {
    const body: Record<string, unknown> = { visibility: "public" };
    if (params.text) body.text = params.text;
    if (params.fileIds && params.fileIds.length > 0) body.fileIds = params.fileIds;
    const res = await this.request<{ createdNote: Note }>("notes/create", body);
    return res.createdNote;
  }

  /** sinceId 以降の本人ノートを古い順で返す。 */
  async fetchUserNotes(userId: string, sinceId: string): Promise<Note[]> {
    const notes = await this.request<Note[]>("users/notes", {
      userId,
      sinceId,
      limit: 100,
      withReplies: true,
      withRenotes: true,
    });
    return notes.sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  /** 本人の最新ノート 1 件を返す (初回起動時のカーソル初期化用)。 */
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
    const user = await this.request<{ id: string }>("users/show", { username });
    return user.id;
  }

  async uploadToDrive(data: ArrayBuffer, name: string, contentType: string): Promise<{ id: string }> {
    const form = new FormData();
    form.append("i", this.token);
    form.append("name", name);
    form.append("file", new Blob([data], { type: contentType }), name);
    const res = await fetch(`${this.origin}/api/drive/files/create`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      throw new Error(`misskey drive/files/create failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as { id: string };
  }
}
