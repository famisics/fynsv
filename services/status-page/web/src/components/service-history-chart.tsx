"use client";

import { ResourceChart } from "@/components/charts/resource-chart";
import { percent } from "@/lib/format";
import { RANGE_MS } from "@/lib/history";
import type { ResourceSnapshot } from "@/lib/types";
import { useHistory } from "./history-provider";

const METRICS = [
  {
    label: "CPU",
    color: "#38bdf8",
    value: (r: ResourceSnapshot) => r.cpu_percent,
  },
  {
    label: "Memory",
    color: "#a78bfa",
    value: (r: ResourceSnapshot) =>
      percent(r.mem_used_bytes, r.mem_total_bytes),
  },
  {
    label: "Disk",
    color: "#f472b6",
    value: (r: ResourceSnapshot) =>
      percent(r.disk_used_bytes, r.disk_total_bytes),
  },
];

export function ServiceHistoryChart({ serviceId }: { serviceId: string }) {
  const { range, resources, gaps, loading } = useHistory();
  const serviceResources = resources.get(serviceId) ?? [];
  const end = Date.now();
  const domain: [number, number] = [end - RANGE_MS[range], end];

  if (serviceResources.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-zinc-600">
        No data in range.
      </p>
    );
  }

  return (
    <div
      className="grid gap-4 transition-opacity sm:grid-cols-3"
      style={{ opacity: loading ? 0.5 : 1 }}
    >
      {METRICS.map((m) => {
        const points = serviceResources.map((r) => ({
          time: Date.parse(r.recorded_at),
          value: m.value(r),
        }));
        const values = points
          .map((p) => p.value)
          .filter((v): v is number => v !== null);
        const avg =
          values.length > 0
            ? values.reduce((a, b) => a + b, 0) / values.length
            : null;
        const max = values.length > 0 ? Math.max(...values) : null;
        return (
          <div key={m.label}>
            <div className="mb-1 flex items-baseline justify-between text-xs">
              <span className="flex items-center gap-1.5 text-zinc-300">
                <span
                  className="inline-block size-2 rounded-sm"
                  style={{ backgroundColor: m.color }}
                />
                {m.label}
              </span>
              <span className="tabular-nums text-zinc-500">
                avg {fmtPct(avg)} · max {fmtPct(max)}
              </span>
            </div>
            <ResourceChart
              points={points}
              label={m.label}
              color={m.color}
              domain={domain}
              gaps={gaps}
            />
          </div>
        );
      })}
    </div>
  );
}

function fmtPct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v)}%`;
}
