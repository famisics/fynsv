export function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / 1024 ** i;
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function percent(
  used: number | null,
  total: number | null,
): number | null {
  if (used === null || total === null || total === 0) return null;
  return (used / total) * 100;
}

export function formatLatency(ms: number | null): string {
  if (ms === null) return "—";
  return `${Math.round(ms)}ms`;
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

export function isStale(iso: string, thresholdMs = 180000): boolean {
  return Date.now() - new Date(iso).getTime() > thresholdMs;
}
