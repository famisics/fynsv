"use client";

import { fmtTime } from "@/lib/format";
import { fmtUptime, uptimeColor } from "@/lib/uptime";
import { useHistory } from "./history-provider";

export function ServiceUptime({ serviceId }: { serviceId: string }) {
  const { uptime, loading } = useHistory();
  const summary = uptime[serviceId] ?? { ratio: null, buckets: [] };

  return (
    <div
      className="flex min-w-0 items-center gap-3 transition-opacity"
      style={{ opacity: loading ? 0.5 : 1 }}
    >
      <div className="flex h-6 min-w-0 flex-1 gap-px">
        {summary.buckets.map((b) => (
          <div
            key={b.start}
            className="flex-1 rounded-[1px] hover:opacity-70"
            style={{ backgroundColor: uptimeColor(b.ratio) }}
            title={`${fmtTime(b.start)} – ${fmtTime(b.end)}: ${fmtUptime(b.ratio)}`}
          />
        ))}
      </div>
      <span className="w-16 shrink-0 text-right text-xs tabular-nums text-zinc-300">
        {fmtUptime(summary.ratio)}
      </span>
    </div>
  );
}
