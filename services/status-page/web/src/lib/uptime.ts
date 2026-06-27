import { RANGE_MS } from "./history";
import type { TimeRange } from "./types";

export const SAMPLE_INTERVAL_MS = 60_000;

export const BUCKET_COUNTS: Record<TimeRange, number> = {
  "24h": 48,
  "7d": 84,
  "30d": 90,
};

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
  counts: number[],
  range: TimeRange,
  now: number,
  firstEverMs: number | null,
): UptimeSummary {
  const windowMs = RANGE_MS[range];
  const start = now - windowMs;
  const count = BUCKET_COUNTS[range];
  const bucketMs = windowMs / count;

  const buckets: UptimeBucket[] = [];
  let expectedTotal = 0;
  let actualTotal = 0;

  for (let i = 0; i < count; i++) {
    const bs = start + i * bucketMs;
    const be = start + (i + 1) * bucketMs;

    if (firstEverMs === null || firstEverMs >= be) {
      buckets.push({ start: bs, end: be, ratio: null });
      continue;
    }

    const effStart = Math.max(bs, firstEverMs);
    const expected = (be - effStart) / SAMPLE_INTERVAL_MS;
    const ratio = expected > 0 ? Math.min(1, counts[i] / expected) : 1;
    buckets.push({ start: bs, end: be, ratio });
    expectedTotal += expected;
    actualTotal += counts[i];
  }

  const ratio =
    expectedTotal > 0 ? Math.min(1, actualTotal / expectedTotal) : null;
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
