export type Category = "public" | "internal";
export type CheckType = "http" | "tcp" | "ping" | "docker";
export type GuestType = "lxc" | "qemu";

export interface CheckConfig {
  type: CheckType;
  url?: string;
  host?: string;
  port?: number;
  container?: string;
  timeoutMs: number;
  okStatuses?: number[];
}

export interface ProxmoxConfig {
  node: string;
  vmid: number;
  type: GuestType;
}

export interface Service {
  id: string;
  name: string;
  category: Category;
  enabled: boolean;
  check: CheckConfig;
  proxmox?: ProxmoxConfig;
}

export const PVE_NODES: Record<string, string> = {
  pve01: "192.168.2.11",
  pve02: "192.168.2.12",
  pve03: "192.168.2.13",
};

export const services: Service[] = [
  {
    id: "misskey-web",
    name: "Misskey",
    category: "public",
    enabled: true,
    check: { type: "http", url: "http://192.168.2.203:3000", timeoutMs: 5000 },
    proxmox: { node: "pve03", vmid: 210, type: "lxc" },
  },
  {
    id: "misskey-db",
    name: "Misskey DB",
    category: "internal",
    enabled: true,
    check: { type: "tcp", host: "192.168.2.204", port: 5432, timeoutMs: 3000 },
    proxmox: { node: "pve02", vmid: 211, type: "lxc" },
  },
  {
    id: "misskey-redis",
    name: "Misskey Redis",
    category: "internal",
    enabled: true,
    check: { type: "tcp", host: "192.168.2.205", port: 6379, timeoutMs: 3000 },
    proxmox: { node: "pve02", vmid: 212, type: "lxc" },
  },
  {
    id: "obsidian-livesync",
    name: "Obsidian LiveSync",
    category: "public",
    enabled: true,
    check: {
      type: "http",
      url: "http://192.168.2.206:5984/_up",
      timeoutMs: 5000,
      okStatuses: [200, 401],
    },
    proxmox: { node: "pve03", vmid: 213, type: "lxc" },
  },
  {
    id: "misskey-mixi2-link",
    name: "Misskey-mixi2 Bridge",
    category: "internal",
    enabled: true,
    check: {
      type: "docker",
      container: "misskey-mixi2-link-bridge-1",
      timeoutMs: 3000,
    },
  },
  {
    id: "discord-bot",
    name: "Discord Bot",
    category: "internal",
    enabled: true,
    check: { type: "docker", container: "fun-council-bot-1", timeoutMs: 3000 },
  },
  {
    id: "swarm-gcal-sync",
    name: "Swarm-GCal Sync",
    category: "internal",
    enabled: true,
    check: {
      type: "docker",
      container: "swarm-gcal-sync-sync-1",
      timeoutMs: 3000,
    },
  },
  {
    id: "coolify-cp",
    name: "Coolify CP",
    category: "internal",
    enabled: true,
    check: { type: "http", url: "http://192.168.2.208:8000", timeoutMs: 5000 },
    proxmox: { node: "pve02", vmid: 220, type: "lxc" },
  },
  {
    id: "coolify-app",
    name: "Coolify App",
    category: "internal",
    enabled: true,
    check: { type: "tcp", host: "192.168.2.209", port: 22, timeoutMs: 3000 },
    proxmox: { node: "pve02", vmid: 221, type: "lxc" },
  },
  {
    id: "supabase",
    name: "Supabase",
    category: "internal",
    enabled: true,
    check: { type: "tcp", host: "192.168.2.202", port: 8000, timeoutMs: 3000 },
    proxmox: { node: "pve03", vmid: 200, type: "lxc" },
  },
  {
    id: "archivebox",
    name: "ArchiveBox",
    category: "internal",
    enabled: false,
    check: { type: "http", url: "http://192.168.2.201", timeoutMs: 5000 },
    proxmox: { node: "pve02", vmid: 201, type: "lxc" },
  },
  {
    id: "dokploy",
    name: "Dokploy",
    category: "internal",
    enabled: false,
    check: { type: "http", url: "http://192.168.2.210:3000", timeoutMs: 5000 },
    proxmox: { node: "pve03", vmid: 222, type: "lxc" },
  },
  {
    id: "arona",
    name: "Arona",
    category: "internal",
    enabled: false,
    check: { type: "http", url: "http://127.0.0.1:8090/healthz", timeoutMs: 3000 },
    proxmox: { node: "pve01", vmid: 100, type: "qemu" },
  },
];

export function getEnabledServices(): Service[] {
  return services.filter((s) => s.enabled);
}
