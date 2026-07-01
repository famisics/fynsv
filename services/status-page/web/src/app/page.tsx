import { AutoRefresh } from "@/components/auto-refresh";
import {
  GlobalRangeSelector,
  HistoryProvider,
} from "@/components/history-provider";
import { ServiceSection } from "@/components/service-section";
import {
  getAllServicesHistory,
  getAllServicesUptime,
  getLatestSnapshot,
  getServiceMeta,
} from "@/lib/db";
import { isStale, relativeTime } from "@/lib/format";
import {
  type ResourceSnapshot,
  type ServiceCategory,
  type TimeRange,
  VALID_RANGES,
} from "@/lib/types";
import type { UptimeSummary } from "@/lib/uptime";

export const revalidate = 60;

const CATEGORY_LABEL: Record<ServiceCategory, string> = {
  public: "Public",
  internal: "Internal",
};

const EMPTY_UPTIME: UptimeSummary = { ratio: null, buckets: [] };

export default async function Home() {
  const [
    { checks, resources },
    meta,
    uptimeMaps,
    { resources: history24h, gaps },
  ] = await Promise.all([
    getLatestSnapshot(),
    getServiceMeta(),
    Promise.all(VALID_RANGES.map((range) => getAllServicesUptime(range))),
    getAllServicesHistory("24h"),
  ]);
  const uptimeByRange = new Map(
    VALID_RANGES.map((range, i) => [range, uptimeMaps[i]]),
  );

  const lookup = (serviceId: string) =>
    meta?.[serviceId] ?? { name: serviceId, category: "internal" as const };

  const resourceById = new Map<string, ResourceSnapshot>(
    resources.map((r) => [r.service_id, r]),
  );

  const uptimeFor = (serviceId: string): Record<TimeRange, UptimeSummary> =>
    Object.fromEntries(
      VALID_RANGES.map((range) => [
        range,
        uptimeByRange.get(range)?.get(serviceId) ?? EMPTY_UPTIME,
      ]),
    ) as Record<TimeRange, UptimeSummary>;

  const newest = checks.reduce<string | null>((acc, c) => {
    return acc === null || c.checked_at > acc ? c.checked_at : acc;
  }, null);
  const stale = newest !== null && isStale(newest);

  const grouped = { public: [], internal: [] } as Record<
    ServiceCategory,
    typeof checks
  >;
  for (const c of checks) {
    grouped[lookup(c.service_id).category].push(c);
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <AutoRefresh />
      <header className="mb-8 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">FYNSV Status</h1>
        {newest !== null && (
          <span className="text-xs text-zinc-500">
            Updated {relativeTime(newest)}
          </span>
        )}
      </header>

      {stale && (
        <div className="mb-6 rounded-lg border border-yellow-900/60 bg-yellow-950/40 px-4 py-3 text-sm text-yellow-300">
          Data may be stale — the most recent check is{" "}
          {newest && relativeTime(newest)}.
        </div>
      )}

      {checks.length === 0 && (
        <p className="text-sm text-zinc-500">No check data available yet.</p>
      )}

      <HistoryProvider
        initialRange="24h"
        initialResources={history24h}
        initialGaps={gaps}
      >
        <div className="mb-6 flex justify-end">
          <GlobalRangeSelector />
        </div>

        {(["public", "internal"] as ServiceCategory[]).map((cat) =>
          grouped[cat].length === 0 ? null : (
            <section key={cat} className="mb-10">
              <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500">
                {CATEGORY_LABEL[cat]}
              </h2>
              <div className="space-y-6">
                {grouped[cat].map((check) => (
                  <ServiceSection
                    key={check.service_id}
                    check={check}
                    latestResource={resourceById.get(check.service_id) ?? null}
                    meta={lookup(check.service_id)}
                    uptimeSummaries={uptimeFor(check.service_id)}
                  />
                ))}
              </div>
            </section>
          ),
        )}
      </HistoryProvider>
    </main>
  );
}
