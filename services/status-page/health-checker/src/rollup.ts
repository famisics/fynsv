import {
  getFirstSnapshotMs,
  getRollupWatermark,
  type RollupRow,
  type SnapshotRow,
  selectSnapshotsInRange,
  upsertRollups,
} from "./db";

export const ROLLUP_BUCKET_MS = 1_800_000;
const BACKFILL_CHUNK_MS = 86_400_000;

interface V1ServiceEntry {
  status: string;
  error: string | null;
  cpu_percent?: number;
  mem_used_bytes?: number;
  mem_total_bytes?: number;
  disk_used_bytes?: number;
  disk_total_bytes?: number;
  net_in_bytes?: number;
  net_out_bytes?: number;
}

export function bucketStart(ms: number): number {
  return Math.floor(ms / ROLLUP_BUCKET_MS) * ROLLUP_BUCKET_MS;
}

export function aggregateSnapshots(rows: SnapshotRow[]): RollupRow[] {
  const acc = new Map<string, RollupRow>();

  for (const row of rows) {
    if (row.schemaVersion !== 1) {
      console.error(
        `[rollup] unknown schema version ${row.schemaVersion}, skipping snapshot ${row.id}`,
      );
      continue;
    }
    const bucketMs = bucketStart(row.recordedAtMs);
    const parsed = JSON.parse(row.data) as {
      services: Record<string, V1ServiceEntry>;
    };

    for (const [serviceId, entry] of Object.entries(parsed.services)) {
      const key = `${bucketMs}:${serviceId}`;
      let r = acc.get(key);
      if (!r) {
        r = {
          bucketMs,
          serviceId,
          upCount: 0,
          downCount: 0,
          sampleCount: 0,
          resourceCount: 0,
          cpuSum: null,
          memUsedSum: null,
          memTotalSum: null,
          diskUsedSum: null,
          diskTotalSum: null,
          netInSum: null,
          netOutSum: null,
        };
        acc.set(key, r);
      }

      r.sampleCount++;
      entry.status === "up" ? r.upCount++ : r.downCount++;

      if (entry.cpu_percent !== undefined) {
        r.resourceCount++;
        r.cpuSum = (r.cpuSum ?? 0) + (entry.cpu_percent ?? 0);
        r.memUsedSum = (r.memUsedSum ?? 0) + (entry.mem_used_bytes ?? 0);
        r.memTotalSum = (r.memTotalSum ?? 0) + (entry.mem_total_bytes ?? 0);
        r.diskUsedSum = (r.diskUsedSum ?? 0) + (entry.disk_used_bytes ?? 0);
        r.diskTotalSum = (r.diskTotalSum ?? 0) + (entry.disk_total_bytes ?? 0);
        r.netInSum = (r.netInSum ?? 0) + (entry.net_in_bytes ?? 0);
        r.netOutSum = (r.netOutSum ?? 0) + (entry.net_out_bytes ?? 0);
      }
    }
  }

  return [...acc.values()];
}

export async function rollupRange(startMs: number, endMs: number): Promise<void> {
  const rows = await selectSnapshotsInRange(startMs, endMs);
  await upsertRollups(aggregateSnapshots(rows));
}

export async function backfillRollups(): Promise<void> {
  const firstMs = await getFirstSnapshotMs();
  if (firstMs === null) return;
  const watermark = await getRollupWatermark();
  const from = bucketStart(watermark ?? firstMs);
  const end = Date.now();

  for (let start = from; start < end; start += BACKFILL_CHUNK_MS) {
    await rollupRange(start, start + BACKFILL_CHUNK_MS);
    if (start + BACKFILL_CHUNK_MS < end) await Bun.sleep(200);
  }
  console.log(
    `[rollup] backfill done (from ${new Date(from).toISOString()})`,
  );
}
