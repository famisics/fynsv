import { AutoRefresh } from "@/components/auto-refresh";
import {
  GlobalRangeSelector,
  HistoryProvider,
} from "@/components/history-provider";
import { ServiceRow } from "@/components/service-row";
import {
  getAllServicesHistory,
  getAllServicesUptime,
  getLatestSnapshot,
  getServiceMeta,
} from "@/lib/db";
import { isStale, relativeTime } from "@/lib/format";
import type {
  ResourceSnapshot,
  ServiceCategory,
  ServiceCheck,
} from "@/lib/types";

export const revalidate = 60;

const CATEGORY_LABEL: Record<ServiceCategory, string> = {
  public: "Public",
  internal: "Internal",
};

export default async function Home() {
  const [
    { checks, resources },
    meta,
    uptime24h,
    { resources: history24h, gaps },
  ] = await Promise.all([
    getLatestSnapshot(),
    getServiceMeta(),
    getAllServicesUptime("24h"),
    getAllServicesHistory("24h"),
  ]);

  const lookup = (serviceId: string) =>
    meta?.[serviceId] ?? { name: serviceId, category: "internal" as const };

  const resourceById = new Map<string, ResourceSnapshot>(
    resources.map((r) => [r.service_id, r]),
  );

  const newest = checks.reduce<string | null>((acc, c) => {
    return acc === null || c.checked_at > acc ? c.checked_at : acc;
  }, null);
  const stale = newest !== null && isStale(newest);

  // 監視を止めたサービス。履歴は残っているので、一覧の下に畳んで出す
  const pastServices = Object.entries(meta ?? {}).filter(
    ([, m]) => m.enabled === false,
  );

  const grouped = { public: [], internal: [] } as Record<
    ServiceCategory,
    typeof checks
  >;
  for (const c of checks) {
    grouped[lookup(c.service_id).category].push(c);
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
      <AutoRefresh />
      <header className="mb-6 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">FYNSV Status</h1>
        {newest !== null && (
          <span className="text-xs text-zinc-500">
            Updated {relativeTime(newest)}
          </span>
        )}
      </header>

      {checks.length === 0 ? (
        <p className="text-sm text-zinc-500">No check data available yet.</p>
      ) : (
        <OverallBanner
          checks={checks}
          nameOf={(id) => lookup(id).name}
          stale={stale}
          newest={newest}
        />
      )}

      <HistoryProvider
        initialRange="24h"
        initialResources={history24h}
        initialGaps={gaps}
        initialUptime={uptime24h}
      >
        <div className="mt-8 mb-3 flex items-center justify-between gap-4">
          <p className="text-xs text-zinc-500">
            Uptime · click a service for resource history
          </p>
          <GlobalRangeSelector />
        </div>

        {(["public", "internal"] as ServiceCategory[]).map((cat) =>
          grouped[cat].length === 0 ? null : (
            <section key={cat} className="mb-8">
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
                {CATEGORY_LABEL[cat]}
              </h2>
              <div className="divide-y divide-zinc-800/80 overflow-hidden rounded-lg border border-zinc-800">
                {grouped[cat].map((check) => (
                  <ServiceRow
                    key={check.service_id}
                    serviceId={check.service_id}
                    name={lookup(check.service_id).name}
                    check={check}
                    latestResource={resourceById.get(check.service_id) ?? null}
                  />
                ))}
              </div>
            </section>
          ),
        )}

        {pastServices.length > 0 && (
          <details className="mb-8">
            <summary className="cursor-pointer select-none text-xs font-medium uppercase tracking-wider text-zinc-500">
              過去のサービス ({pastServices.length})
            </summary>
            <div className="mt-2 divide-y divide-zinc-800/80 overflow-hidden rounded-lg border border-zinc-800">
              {pastServices.map(([id, m]) => (
                <ServiceRow
                  key={id}
                  serviceId={id}
                  name={m.name}
                  check={null}
                  latestResource={null}
                />
              ))}
            </div>
          </details>
        )}
      </HistoryProvider>
    </main>
  );
}

// 全体の状態を一文で示す。止まっているサービスがあれば名前を出す
function OverallBanner({
  checks,
  nameOf,
  stale,
  newest,
}: {
  checks: ServiceCheck[];
  nameOf: (id: string) => string;
  stale: boolean;
  newest: string | null;
}) {
  const down = checks.filter((c) => c.status === "down");
  const degraded = checks.filter((c) => c.status === "degraded");

  const tone = stale
    ? "border-zinc-700 bg-zinc-900 text-zinc-300"
    : down.length > 0
      ? "border-red-900/70 bg-red-950/40 text-red-200"
      : degraded.length > 0
        ? "border-yellow-900/70 bg-yellow-950/40 text-yellow-200"
        : "border-green-900/70 bg-green-950/30 text-green-200";

  const title = stale
    ? "Status unknown"
    : down.length > 0
      ? `${down.length} of ${checks.length} services down`
      : degraded.length > 0
        ? `${degraded.length} of ${checks.length} services degraded`
        : "All systems operational";

  const affected = [...down, ...degraded].map((c) => nameOf(c.service_id));

  return (
    <div className={`rounded-lg border px-5 py-4 ${tone}`}>
      <p className="font-medium">{title}</p>
      {stale && newest && (
        <p className="mt-1 text-sm opacity-80">
          Data may be stale — the most recent check is {relativeTime(newest)}.
        </p>
      )}
      {!stale && affected.length > 0 && (
        <p className="mt-1 text-sm opacity-80">{affected.join(", ")}</p>
      )}
    </div>
  );
}
