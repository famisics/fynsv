"use client";

import { ResourceChart } from "@/components/charts/resource-chart";
import { RANGE_MS } from "@/lib/history";
import { useHistory } from "./history-provider";

export function ServiceHistoryChart({ serviceId }: { serviceId: string }) {
  const { range, resources, gaps, loading } = useHistory();
  const serviceResources = resources.get(serviceId) ?? [];
  const end = Date.now();
  const domain: [number, number] = [end - RANGE_MS[range], end];

  return (
    <div
      className="mt-4 transition-opacity"
      style={{ opacity: loading ? 0.5 : 1 }}
    >
      {serviceResources.length > 0 ? (
        <ResourceChart
          data={serviceResources}
          metrics={["cpu", "memory", "disk"]}
          domain={domain}
          gaps={gaps}
        />
      ) : (
        <p className="py-8 text-center text-sm text-zinc-600">
          No data in range.
        </p>
      )}
    </div>
  );
}
