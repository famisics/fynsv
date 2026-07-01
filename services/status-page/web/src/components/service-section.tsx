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
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <StatusIndicator status={check.status} />
        <span className="font-medium text-zinc-100">{meta.name}</span>
        <span className="text-xs text-zinc-500">
          {relativeTime(check.checked_at)}
          {check.error ? ` · ${check.error}` : ""}
        </span>

        {latestResource && (
          <span className="ml-auto flex flex-wrap items-center gap-x-3 text-xs tabular-nums text-zinc-400">
            <StatItem
              label="CPU"
              value={`${Math.round(latestResource.cpu_percent ?? 0)}%`}
            />
            <StatItem
              label="MEM"
              value={`${formatBytes(latestResource.mem_used_bytes)} / ${formatBytes(latestResource.mem_total_bytes)}`}
            />
            <StatItem
              label="DISK"
              value={`${formatBytes(latestResource.disk_used_bytes)} / ${formatBytes(latestResource.disk_total_bytes)}`}
            />
            <StatItem
              label="MEM%"
              value={`${Math.round(percent(latestResource.mem_used_bytes, latestResource.mem_total_bytes) ?? 0)}%`}
            />
          </span>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-[360px_1fr]">
        <ServiceUptime summaries={uptimeSummaries} />
        <ServiceHistoryChart serviceId={check.service_id} />
      </div>
    </section>
  );
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="text-zinc-600">{label}</span>{" "}
      <span className="text-zinc-300">{value}</span>
    </span>
  );
}
