import { ServiceHistoryChart } from "@/components/service-history-chart";
import { ServiceUptime } from "@/components/service-uptime";

// 廃止したサービス。履歴だけを見せるので、現在の状態やリソース値は出さない
export function PastServiceSection({
  serviceId,
  name,
}: {
  serviceId: string;
  name: string;
}) {
  return (
    <details className="group rounded-lg border border-zinc-800 bg-zinc-900/50">
      <summary className="cursor-pointer select-none px-4 py-3 text-sm text-zinc-300 marker:text-zinc-600">
        {name}
      </summary>
      <div className="space-y-4 px-4 pb-4">
        <ServiceUptime serviceId={serviceId} />
        <ServiceHistoryChart serviceId={serviceId} />
      </div>
    </details>
  );
}
