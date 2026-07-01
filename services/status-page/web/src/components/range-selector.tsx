"use client";

import type { TimeRange } from "@/lib/types";

const RANGES: TimeRange[] = ["24h", "7d", "30d"];

export function RangeSelector({
  current,
  onChange,
  disabled,
}: {
  current: TimeRange;
  onChange: (range: TimeRange) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex rounded-lg border border-zinc-800 p-0.5">
      {RANGES.map((r) => (
        <button
          key={r}
          type="button"
          disabled={disabled}
          onClick={() => onChange(r)}
          className={`rounded-md px-3 py-1 text-sm transition-colors disabled:opacity-50 ${
            r === current
              ? "bg-zinc-700 text-zinc-100"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          {r}
        </button>
      ))}
    </div>
  );
}
