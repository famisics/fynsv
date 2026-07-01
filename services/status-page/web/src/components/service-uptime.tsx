import { fmtTime } from "@/lib/format";
import type { TimeRange } from "@/lib/types";
import { fmtUptime, type UptimeSummary, uptimeColor } from "@/lib/uptime";

const ROWS: { range: TimeRange; label: string }[] = [
  { range: "24h", label: "24h" },
  { range: "7d", label: "7d" },
  { range: "30d", label: "30d" },
];

export function ServiceUptime({
  summaries,
}: {
  summaries: Record<TimeRange, UptimeSummary>;
}) {
  return (
    <div className="space-y-1.5">
      {ROWS.map(({ range, label }) => (
        <UptimeRow key={range} label={label} summary={summaries[range]} />
      ))}
    </div>
  );
}

function UptimeRow({
  label,
  summary,
}: {
  label: string;
  summary: UptimeSummary;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-8 shrink-0 text-[11px] text-zinc-500">{label}</span>
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
