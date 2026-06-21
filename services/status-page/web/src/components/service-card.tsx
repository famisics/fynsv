import Link from "next/link";
import { formatLatency, percent } from "@/lib/format";
import type {
  ResourceSnapshot,
  ServiceCategory,
  ServiceCheck,
} from "@/lib/types";
import { StatusIndicator } from "./status-indicator";

function Bar({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-8 text-[10px] uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-zinc-400"
          style={{ width: `${Math.min(100, value ?? 0)}%` }}
        />
      </div>
      <span className="w-9 text-right text-[10px] tabular-nums text-zinc-400">
        {value === null ? "—" : `${Math.round(value)}%`}
      </span>
    </div>
  );
}

export function ServiceCard({
  check,
  resource,
  meta,
}: {
  check: ServiceCheck;
  resource: ResourceSnapshot | null;
  meta: { name: string; category: ServiceCategory };
}) {
  const cpu = resource?.cpu_percent ?? null;
  const mem = percent(
    resource?.mem_used_bytes ?? null,
    resource?.mem_total_bytes ?? null,
  );

  return (
    <Link
      href={`/history/${check.service_id}`}
      className="block rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 transition-colors hover:border-zinc-700 hover:bg-zinc-900"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <StatusIndicator status={check.status} />
          <span className="font-medium text-zinc-100">{meta.name}</span>
        </div>
        <span className="text-sm tabular-nums text-zinc-400">
          {formatLatency(check.latency_ms)}
        </span>
      </div>
      <div className="mt-4 space-y-1.5">
        <Bar label="CPU" value={cpu} />
        <Bar label="MEM" value={mem} />
      </div>
    </Link>
  );
}
