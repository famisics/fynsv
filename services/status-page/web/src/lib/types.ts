export type ServiceStatus = "up" | "down" | "degraded";

export interface ServiceCheck {
  id: number;
  service_id: string;
  status: ServiceStatus;
  latency_ms: number | null;
  error: string | null;
  checked_at: string;
}

export interface ResourceSnapshot {
  id: number;
  service_id: string;
  cpu_percent: number | null;
  mem_used_bytes: number | null;
  mem_total_bytes: number | null;
  disk_used_bytes: number | null;
  disk_total_bytes: number | null;
  net_in_bytes: number | null;
  net_out_bytes: number | null;
  recorded_at: string;
}

export type ServiceCategory = "public" | "internal";

export type TimeRange = "24h" | "7d" | "30d";
