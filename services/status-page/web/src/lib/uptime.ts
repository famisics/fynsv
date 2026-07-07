import { RANGE_MS } from "./history";
import type { TimeRange } from "./types";

export const SAMPLE_INTERVAL_MS = 60_000;
export const ROLLUP_BUCKET_MS = 1_800_000;

export const BUCKET_COUNTS: Record<TimeRange, number> = {
  "24h": 48,
  "7d": 84,
  "30d": 90,
};

// 表示ウィンドウを 30 分境界に整列させる (rollups_30m のバケットと一致させるため)
export function alignedWindow(
  range: TimeRange,
  now: number,
): { start: number; end: number } {
  const end = Math.ceil(now / ROLLUP_BUCKET_MS) * ROLLUP_BUCKET_MS;
  return { start: end - RANGE_MS[range], end };
}

export interface UptimeBucket {
  start: number;
  end: number;
  ratio: number | null;
}

export interface UptimeSummary {
  ratio: number | null;
  buckets: UptimeBucket[];
}

export function computeUptimeFromCounts(
  upCounts: number[],
  range: TimeRange,
  now: number,
  firstEverMs: number | null,
): UptimeSummary {
  const { start } = alignedWindow(range, now);
  const count = BUCKET_COUNTS[range];
  const bucketMs = RANGE_MS[range] / count;

  const buckets: UptimeBucket[] = [];
  let expectedTotal = 0;
  let upTotal = 0;

  for (let i = 0; i < count; i++) {
    const bs = start + i * bucketMs;
    const be = start + (i + 1) * bucketMs;
    const effEnd = Math.min(be, now);

    if (firstEverMs === null || firstEverMs >= effEnd) {
      buckets.push({ start: bs, end: be, ratio: null });
      continue;
    }

    const effStart = Math.max(bs, firstEverMs);
    const expected = (effEnd - effStart) / SAMPLE_INTERVAL_MS;
    if (expected <= 0) {
      buckets.push({ start: bs, end: be, ratio: null });
      continue;
    }
    const ratio = Math.min(1, upCounts[i] / expected);
    buckets.push({ start: bs, end: be, ratio });
    expectedTotal += expected;
    upTotal += upCounts[i];
  }

  const ratio = expectedTotal > 0 ? Math.min(1, upTotal / expectedTotal) : null;
  return { ratio, buckets };
}

export function uptimeColor(ratio: number | null): string {
  if (ratio === null) return "#3f3f46";
  return `hsl(${ratio * 120} 65% 45%)`;
}

export function fmtUptime(ratio: number | null): string {
  if (ratio === null) return "—";
  return `${(ratio * 100).toFixed(2)}%`;
}
