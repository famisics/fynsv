import Link from "next/link";
import { LatencyChart } from "@/components/charts/latency-chart";
import { ResourceChart } from "@/components/charts/resource-chart";
import { RangeSelector } from "@/components/range-selector";
import { StatusIndicator } from "@/components/status-indicator";
import {
  getHistory,
  getLatestSnapshot,
  getServiceMeta,
} from "@/lib/db";
import {
  formatBytes,
  formatLatency,
  percent,
  relativeTime,
} from "@/lib/format";
import { findGaps, GAP_THRESHOLD_MS, RANGE_MS } from "@/lib/history";
import { parseRange } from "@/lib/types";

export const revalidate = 30;

export default async function HistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ serviceId: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { serviceId } = await params;
  const { range: rawRange } = await searchParams;
  const range = parseRange(rawRange);

  const [allMeta, { checks, resources }, latestSnapshot] = await Promise.all([
    getServiceMeta(),
    getHistory(serviceId, range),
    getLatestSnapshot(),
  ]);

  const meta = allMeta?.[serviceId] ?? {
    name: serviceId,
    category: "internal" as const,
  };
  const latest =
    latestSnapshot.checks.find((c) => c.service_id === serviceId) ?? null;
  const latestResource = resources.at(-1) ?? null;

  const end = Date.now();
  const domain: [number, number] = [end - RANGE_MS[range], end];
  const gaps = findGaps(
    checks.map((c) => Date.parse(c.checked_at)),
    GAP_THRESHOLD_MS,
    end,
  );

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      <Link
        href="/"
        className="text-sm text-zinc-500 transition-colors hover:text-zinc-300"
      >
        ← All services
      </Link>

      <header className="mt-4 mb-8 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {latest && <StatusIndicator status={latest.status} size={14} />}
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {meta.name}
            </h1>
            {latest && (
              <p className="text-sm text-zinc-500">
                {formatLatency(latest.latency_ms)} ·{" "}
                {relativeTime(latest.checked_at)}
                {latest.error ? ` · ${latest.error}` : ""}
              </p>
            )}
          </div>
        </div>
        <RangeSelector current={range} />
      </header>

      {latestResource && (
        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
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

      <Section title="Response time">
        {checks.length > 0 ? (
          <LatencyChart data={checks} domain={domain} gaps={gaps} />
        ) : (
          <Empty />
        )}
      </Section>

      <Section title="Resource usage">
        {resources.length > 0 ? (
          <ResourceChart
            data={resources}
            metrics={["cpu", "memory", "disk"]}
            domain={domain}
            gaps={gaps}
          />
        ) : (
          <Empty />
        )}
      </Section>
    </main>
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

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8 rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
      <h2 className="mb-4 text-sm font-medium text-zinc-300">{title}</h2>
      {children}
    </section>
  );
}

function Empty() {
  return (
    <p className="py-12 text-center text-sm text-zinc-600">No data in range.</p>
  );
}
