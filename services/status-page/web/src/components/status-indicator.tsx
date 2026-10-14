import type { ServiceStatus } from "@/lib/types";

export const STATUS_COLORS: Record<ServiceStatus, string> = {
  up: "#22c55e",
  down: "#ef4444",
  degraded: "#eab308",
};

export function StatusIndicator({ status }: { status: ServiceStatus | null }) {
  return (
    <span
      className="inline-block size-2.5 shrink-0 rounded-full"
      style={{
        backgroundColor: status ? STATUS_COLORS[status] : "#52525b",
        boxShadow: status ? `0 0 0 3px ${STATUS_COLORS[status]}26` : undefined,
      }}
    />
  );
}
