"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { TimeRange } from "@/lib/types";

const RANGES: TimeRange[] = ["24h", "7d", "30d"];

export function RangeSelector({ current }: { current: TimeRange }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function select(range: TimeRange) {
    const params = new URLSearchParams(searchParams);
    params.set("range", range);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="inline-flex rounded-lg border border-zinc-800 p-0.5">
      {RANGES.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => select(r)}
          className={`rounded-md px-3 py-1 text-sm transition-colors ${
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
