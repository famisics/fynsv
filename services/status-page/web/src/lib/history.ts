import type { TimeRange } from "./types";

export const RANGE_MS: Record<TimeRange, number> = {
  "24h": 86_400_000,
  "7d": 604_800_000,
  "30d": 2_592_000_000,
};

export const GAP_THRESHOLD_MS = 180_000;

export interface Gap {
  start: number;
  end: number;
}

export function findGaps(
  timestampsMs: number[],
  thresholdMs: number,
  end?: number,
): Gap[] {
  const gaps: Gap[] = [];
  for (let i = 1; i < timestampsMs.length; i++) {
    if (timestampsMs[i] - timestampsMs[i - 1] > thresholdMs) {
      gaps.push({ start: timestampsMs[i - 1], end: timestampsMs[i] });
    }
  }
  if (end !== undefined && timestampsMs.length > 0) {
    const last = timestampsMs[timestampsMs.length - 1];
    if (end - last > thresholdMs) {
      gaps.push({ start: last, end });
    }
  }
  return gaps;
}
