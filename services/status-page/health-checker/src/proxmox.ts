import { PVE_NODES, type Service } from "./config";

export interface ResourceStats {
  cpu_percent: number;
  mem_used_bytes: number;
  mem_total_bytes: number;
  disk_used_bytes: number;
  disk_total_bytes: number;
  net_in_bytes: number;
  net_out_bytes: number;
}

const token = process.env.PVE_API_TOKEN ?? "";

export async function fetchResourceStats(
  service: Service,
): Promise<ResourceStats | null> {
  const { node, vmid, type } = service.proxmox;
  const ip = PVE_NODES[node];
  if (!ip) return null;

  const url = `https://${ip}:8006/api2/json/nodes/${node}/${type}/${vmid}/status/current`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `PVEAPIToken=${token}` },
      signal: AbortSignal.timeout(5000),
      tls: { rejectUnauthorized: false },
    });
    if (!res.ok) {
      console.error(`[proxmox] ${service.id}: HTTP ${res.status} from ${url}`);
      return null;
    }
    const body = (await res.json()) as { data?: Record<string, number> };
    const d = body.data;
    if (!d) {
      console.error(`[proxmox] ${service.id}: no data in response`);
      return null;
    }
    return {
      cpu_percent: (d.cpu ?? 0) * 100,
      mem_used_bytes: d.mem ?? 0,
      mem_total_bytes: d.maxmem ?? 0,
      disk_used_bytes: d.disk ?? 0,
      disk_total_bytes: d.maxdisk ?? 0,
      net_in_bytes: d.netin ?? 0,
      net_out_bytes: d.netout ?? 0,
    };
  } catch (e) {
    console.error(`[proxmox] ${service.id}: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}
