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
