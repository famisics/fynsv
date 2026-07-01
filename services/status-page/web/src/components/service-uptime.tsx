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
    <div className="space-y-4">
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
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-xs">
        <span className="text-zinc-400">{label}</span>
        <span className="tabular-nums text-zinc-300">
          {fmtUptime(summary.ratio)} uptime
        </span>
      </div>
      <div className="flex h-7 gap-0.5">
        {summary.buckets.map((b) => (
          <div
            key={b.start}
            className="flex-1 rounded-xs"
            style={{ backgroundColor: uptimeColor(b.ratio) }}
            title={`${fmtTime(b.start)} – ${fmtTime(b.end)}: ${fmtUptime(b.ratio)}`}
          />
        ))}
      </div>
    </div>
  );
}
