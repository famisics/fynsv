export const MIXI2_MAX_POST_LENGTH = 149;

/**
 * mixi2 の文字数上限に収まるよう整形する。超える場合は切り詰めて元ノートの URL を付ける。
 */
export function formatForMixi2(
  text: string,
  noteUrl: string,
  maxLength: number = MIXI2_MAX_POST_LENGTH,
): string {
  const chars = [...text];
  if (chars.length <= maxLength) return text;
  const budget = maxLength - [...noteUrl].length - 2; // "…" + 改行
  return `${chars.slice(0, budget).join("").trimEnd()}…\n${noteUrl}`;
}

function mentionRegExp(mention: string, flags: string): RegExp {
  const escaped = mention.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, flags);
}

/**
 * 本文に指定メンション (例: "@linkbot") が含まれるか判定する。
 * 部分一致 ("@linkbot2" など) は対象にしない。
 */
export function hasMention(text: string, mention: string): boolean {
  return mentionRegExp(mention, "u").test(text);
}

/**
 * 本文から指定メンション (例: "@linkbot") を除去する。
 */
export function stripMention(text: string, mention: string): string {
  return text
    .replace(mentionRegExp(mention, "gu"), "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
