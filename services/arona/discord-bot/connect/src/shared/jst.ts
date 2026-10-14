export const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

export function jstToEpoch(year: number, month: number, day: number, hour: number, minute: number): number | null {
  const utc = Date.UTC(year, month - 1, day, hour, minute);
  const d = new Date(utc);
  // 2/30 や 25:00 のような桁あふれを Date が繰り上げていないか確かめる
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day ||
    d.getUTCHours() !== hour ||
    d.getUTCMinutes() !== minute
  ) {
    return null;
  }
  return utc - JST_OFFSET_MS;
}

// "MM/DD HH:MM" と "HH:MM" を JST として解釈し、epoch ms を返す。
// 現在より前なら、日付つきは翌年、時刻のみは翌日として扱う
export function parseJst(input: string, nowMs: number): number | null {
  const text = input.trim();
  const now = new Date(nowMs + JST_OFFSET_MS);
  const year = now.getUTCFullYear();

  const full = /^(\d{1,2})\/(\d{1,2}) (\d{1,2}):(\d{2})$/.exec(text);
  if (full) {
    const [, month, day, hour, minute] = full.map(Number) as [number, number, number, number, number];
    for (const y of [year, year + 1]) {
      const t = jstToEpoch(y, month, day, hour, minute);
      if (t !== null && t >= nowMs) return t;
    }
    return null;
  }

  const hm = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (hm) {
    const [, hour, minute] = hm.map(Number) as [number, number, number];
    const t = jstToEpoch(year, now.getUTCMonth() + 1, now.getUTCDate(), hour, minute);
    if (t === null) return null;
    return t >= nowMs ? t : t + DAY_MS;
  }

  return null;
}

export function formatJst(epochMs: number): string {
  const d = new Date(epochMs + JST_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

// <input type="datetime-local"> の値 ("YYYY-MM-DDTHH:mm") を JST として解釈する
export function parseJstInput(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  return jstToEpoch(y, mo, d, h, mi);
}

export function toJstInput(epochMs: number): string {
  return new Date(epochMs + JST_OFFSET_MS).toISOString().slice(0, 16);
}

// JST での暦の要素。weekday は 0 (日) 〜 6 (土)
export function jstParts(epochMs: number) {
  const d = new Date(epochMs + JST_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekday: d.getUTCDay(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}
