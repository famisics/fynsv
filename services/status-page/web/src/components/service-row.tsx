"use client";

import { useState } from "react";
import { ServiceHistoryChart } from "@/components/service-history-chart";
import { ServiceUptime } from "@/components/service-uptime";
import { StatusIndicator } from "@/components/status-indicator";
import { formatBytes, percent, relativeTime } from "@/lib/format";
import type { ResourceSnapshot, ServiceCheck } from "@/lib/types";

// 1 サービス 1 行で並べ、チャートは開いたときだけ描画する。
// check が null のものは監視を止めた過去のサービスで、履歴だけを出す
export function ServiceRow({
  serviceId,
  name,
  check,
  latestResource,
}: {
  serviceId: string;
  name: string;
  check: ServiceCheck | null;
  latestResource: ResourceSnapshot | null;
}) {
  const [open, setOpen] = useState(false);
  const failing = check !== null && check.status !== "up";

  return (
    <div className={open ? "bg-zinc-900/60" : undefined}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="grid w-full cursor-pointer grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 px-4 py-3 text-left hover:bg-zinc-900/60 md:grid-cols-[13rem_1fr_auto]"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <StatusIndicator status={check?.status ?? null} />
          <span className="truncate text-sm font-medium text-zinc-100">
            {name}
          </span>
        </span>

        <span className="col-span-2 row-start-2 md:col-span-1 md:row-start-auto">
          <ServiceUptime serviceId={serviceId} />
        </span>

        <span className="col-start-2 row-start-1 flex items-center gap-3 md:col-start-auto md:row-start-auto">
          {latestResource && (
            <span className="hidden gap-3 sm:flex">
              <Meter label="CPU" value={latestResource.cpu_percent} />
              <Meter
                label="MEM"
                value={percent(
                  latestResource.mem_used_bytes,
                  latestResource.mem_total_bytes,
                )}
              />
              <Meter
                label="DISK"
                value={percent(
                  latestResource.disk_used_bytes,
                  latestResource.disk_total_bytes,
                )}
              />
            </span>
          )}
          <Chevron open={open} />
        </span>
      </button>

      {failing && check.error && (
        <p className="-mt-1 px-4 pb-3 pl-9 text-xs text-red-400">
          {check.error}
        </p>
      )}

      {open && (
        <div className="space-y-4 px-4 pt-1 pb-5">
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-500">
            {check && <span>Checked {relativeTime(check.checked_at)}</span>}
            {latestResource && (
              <>
                <span>
                  MEM {formatBytes(latestResource.mem_used_bytes)} /{" "}
                  {formatBytes(latestResource.mem_total_bytes)}
                </span>
                <span>
                  DISK {formatBytes(latestResource.disk_used_bytes)} /{" "}
                  {formatBytes(latestResource.disk_total_bytes)}
                </span>
              </>
            )}
          </div>
          <ServiceHistoryChart serviceId={serviceId} />
        </div>
      )}
    </div>
  );
}

// 使用率を小さなバーで示す。高いときだけ色を付けて目に付くようにする
function Meter({ label, value }: { label: string; value: number | null }) {
  const v = value === null ? null : Math.min(100, Math.max(0, value));
  const color =
    v === null
      ? "#3f3f46"
      : v >= 90
        ? "#ef4444"
        : v >= 75
          ? "#eab308"
          : "#71717a";
  return (
    <span className="flex w-16 flex-col gap-1">
      <span className="flex justify-between text-[10px] leading-none tabular-nums">
        <span className="text-zinc-600">{label}</span>
        <span className="text-zinc-300">
          {v === null ? "—" : `${Math.round(v)}%`}
        </span>
      </span>
      <span className="h-1 overflow-hidden rounded-full bg-zinc-800">
        <span
          className="block h-full rounded-full"
          style={{ width: `${v ?? 0}%`, backgroundColor: color }}
        />
      </span>
    </span>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={`size-4 shrink-0 text-zinc-600 transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path
        d="M4 6l4 4 4-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
