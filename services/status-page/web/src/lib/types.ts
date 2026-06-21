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

export const SERVICE_META: Record<
  string,
  { name: string; category: ServiceCategory }
> = {
  "misskey-web": { name: "Misskey", category: "public" },
  "misskey-db": { name: "Misskey DB", category: "internal" },
  "misskey-redis": { name: "Misskey Redis", category: "internal" },
  "obsidian-livesync": { name: "Obsidian LiveSync", category: "public" },
  "misskey-mixi2-link": { name: "Misskey-mixi2 Bridge", category: "internal" },
  "coolify-cp": { name: "Coolify CP", category: "internal" },
  "coolify-app": { name: "Coolify App", category: "internal" },
  supabase: { name: "Supabase", category: "internal" },
  archivebox: { name: "ArchiveBox", category: "internal" },
  dokploy: { name: "Dokploy", category: "internal" },
  arona: { name: "Arona", category: "internal" },
};

export type TimeRange = "24h" | "7d" | "30d";

export function getServiceMeta(serviceId: string): {
  name: string;
  category: ServiceCategory;
} {
  return SERVICE_META[serviceId] ?? { name: serviceId, category: "internal" };
}
