import { hasMention } from "./text.js";

export interface MisskeyNoteLike {
  id: string;
  userId: string;
  text: string | null;
  cw?: string | null;
  replyId?: string | null;
  renoteId?: string | null;
  visibility: string;
  files?: { type: string; url: string | null }[];
}

export function imageFiles(note: MisskeyNoteLike): { type: string; url: string }[] {
  return (note.files ?? []).filter(
    (f): f is { type: string; url: string } => f.url != null && f.type.startsWith("image/"),
  );
}

export function shouldForwardNote(
  note: MisskeyNoteLike,
  selfUserId: string,
  mention: string,
): boolean {
  if (note.userId !== selfUserId) return false;
  if (note.replyId != null) return false;
  if (note.renoteId != null) return false;
  if (note.visibility !== "public") return false;
  if (note.cw != null) return false;
  if (!note.text || !hasMention(note.text, mention)) return false;
  return true;
}
