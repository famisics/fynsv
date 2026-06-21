import type { ServiceStatus } from "@/lib/types";

const COLORS: Record<ServiceStatus, string> = {
  up: "#22c55e",
  down: "#ef4444",
  degraded: "#eab308",
};

export function StatusIndicator({
  status,
  size = 10,
}: {
  status: ServiceStatus;
  size?: number;
}) {
  const color = COLORS[status];
  return (
    <span
      className="relative inline-flex"
      style={{ width: size, height: size }}
    >
      {status === "up" && (
        <span
          className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
          style={{ backgroundColor: color }}
        />
      )}
      <span
        className="relative inline-flex rounded-full"
        style={{ width: size, height: size, backgroundColor: color }}
      />
    </span>
  );
}
