"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { percent } from "@/lib/format";
import type { ResourceSnapshot } from "@/lib/types";

type Metric = "cpu" | "memory" | "disk";

const SERIES: Record<Metric, { label: string; color: string }> = {
  cpu: { label: "CPU", color: "#38bdf8" },
  memory: { label: "Memory", color: "#a78bfa" },
  disk: { label: "Disk", color: "#f472b6" },
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ResourceChart({
  data,
  metrics,
}: {
  data: ResourceSnapshot[];
  metrics: Metric[];
}) {
  const points = data.map((r) => ({
    time: r.recorded_at,
    cpu: r.cpu_percent === null ? null : Math.round(r.cpu_percent * 10) / 10,
    memory: percent(r.mem_used_bytes, r.mem_total_bytes),
    disk: percent(r.disk_used_bytes, r.disk_total_bytes),
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart
        data={points}
        margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
      >
        <CartesianGrid stroke="#27272a" vertical={false} />
        <XAxis
          dataKey="time"
          tickFormatter={fmtTime}
          tick={{ fill: "#71717a", fontSize: 11 }}
          stroke="#3f3f46"
          minTickGap={48}
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fill: "#71717a", fontSize: 11 }}
          stroke="#3f3f46"
          width={44}
          unit="%"
        />
        <Tooltip
          contentStyle={{
            background: "#18181b",
            border: "1px solid #3f3f46",
            borderRadius: 8,
            fontSize: 12,
          }}
          labelStyle={{ color: "#a1a1aa" }}
          labelFormatter={(v) => fmtTime(v as string)}
          formatter={(value, name) => [
            value === null ? "—" : `${Math.round(value as number)}%`,
            SERIES[name as Metric].label,
          ]}
        />
        {metrics.map((m) => (
          <Line
            key={m}
            type="monotone"
            dataKey={m}
            name={m}
            stroke={SERIES[m].color}
            strokeWidth={2}
            connectNulls
            dot={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
