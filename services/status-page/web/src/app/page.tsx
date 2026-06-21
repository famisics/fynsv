import { AutoRefresh } from "@/components/auto-refresh";
import { ServiceCard } from "@/components/service-card";
import { getLatestChecks, getLatestResources } from "@/lib/db";
import { isStale, relativeTime } from "@/lib/format";
import {
  getServiceMeta,
  type ResourceSnapshot,
  type ServiceCategory,
} from "@/lib/types";

export const revalidate = 30;
export const dynamic = "force-dynamic";

const CATEGORY_LABEL: Record<ServiceCategory, string> = {
  public: "Public",
  internal: "Internal",
};

export default async function Home() {
  const [checks, resources] = await Promise.all([
    getLatestChecks(),
    getLatestResources(),
  ]);

  const resourceById = new Map<string, ResourceSnapshot>(
    resources.map((r) => [r.service_id, r]),
  );

  const newest = checks.reduce<string | null>((acc, c) => {
    return acc === null || c.checked_at > acc ? c.checked_at : acc;
  }, null);
  const stale = newest !== null && isStale(newest);

  const grouped = { public: [], internal: [] } as Record<
    ServiceCategory,
    typeof checks
  >;
  for (const c of checks) {
    grouped[getServiceMeta(c.service_id).category].push(c);
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
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

      {(["public", "internal"] as ServiceCategory[]).map((cat) =>
        grouped[cat].length === 0 ? null : (
          <section key={cat} className="mb-10">
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500">
              {CATEGORY_LABEL[cat]}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {grouped[cat].map((check) => (
                <ServiceCard
                  key={check.service_id}
                  check={check}
                  resource={resourceById.get(check.service_id) ?? null}
                  meta={getServiceMeta(check.service_id)}
                />
              ))}
            </div>
          </section>
        ),
      )}
    </main>
  );
}
