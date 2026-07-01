import { ServiceHistoryChart } from "@/components/service-history-chart";
import { ServiceUptime } from "@/components/service-uptime";
import { StatusIndicator } from "@/components/status-indicator";
import { formatBytes, percent, relativeTime } from "@/lib/format";
import type {
  ResourceSnapshot,
  ServiceCategory,
  ServiceCheck,
  TimeRange,
} from "@/lib/types";
import type { UptimeSummary } from "@/lib/uptime";

export function ServiceSection({
  check,
  latestResource,
  meta,
  uptimeSummaries,
}: {
  check: ServiceCheck;
  latestResource: ResourceSnapshot | null;
  meta: { name: string; category: ServiceCategory };
  uptimeSummaries: Record<TimeRange, UptimeSummary>;
}) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-center gap-2.5">
        <StatusIndicator status={check.status} />
        <span className="font-medium text-zinc-100">{meta.name}</span>
        <span className="text-xs text-zinc-500">
          {relativeTime(check.checked_at)}
          {check.error ? ` · ${check.error}` : ""}
        </span>
      </div>

      {latestResource && (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat
            label="CPU"
            value={`${Math.round(latestResource.cpu_percent ?? 0)}%`}
          />
          <Stat
            label="Memory"
            value={`${formatBytes(latestResource.mem_used_bytes)} / ${formatBytes(latestResource.mem_total_bytes)}`}
          />
          <Stat
            label="Disk"
            value={`${formatBytes(latestResource.disk_used_bytes)} / ${formatBytes(latestResource.disk_total_bytes)}`}
          />
          <Stat
            label="Mem %"
            value={`${Math.round(percent(latestResource.mem_used_bytes, latestResource.mem_total_bytes) ?? 0)}%`}
          />
        </div>
      )}

      <div className="mt-4">
        <ServiceUptime summaries={uptimeSummaries} />
      </div>

      <ServiceHistoryChart serviceId={check.service_id} />
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div className="mt-1 text-sm tabular-nums text-zinc-200">{value}</div>
    </div>
  );
}
