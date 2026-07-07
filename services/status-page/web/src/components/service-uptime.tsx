"use client";

import { fmtTime } from "@/lib/format";
import { fmtUptime, uptimeColor } from "@/lib/uptime";
import { useHistory } from "./history-provider";

export function ServiceUptime({ serviceId }: { serviceId: string }) {
  const { range, uptime, loading } = useHistory();
  const summary = uptime[serviceId] ?? { ratio: null, buckets: [] };

  return (
    <div
      className="flex items-center gap-2 transition-opacity"
      style={{ opacity: loading ? 0.5 : 1 }}
    >
      <span className="w-8 shrink-0 text-[11px] text-zinc-500">{range}</span>
      <div className="flex h-5 flex-1 gap-0.5">
        {summary.buckets.map((b) => (
          <div
            key={b.start}
            className="flex-1 rounded-xs"
            style={{ backgroundColor: uptimeColor(b.ratio) }}
            title={`${fmtTime(b.start)} – ${fmtTime(b.end)}: ${fmtUptime(b.ratio)}`}
          />
        ))}
      </div>
      <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-zinc-400">
        {fmtUptime(summary.ratio)}
      </span>
    </div>
  );
}
