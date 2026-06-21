"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ServiceCheck } from "@/lib/types";

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function LatencyChart({ data }: { data: ServiceCheck[] }) {
  const points = data.map((c) => ({
    time: c.checked_at,
    latency: c.status === "down" ? null : Math.round(c.latency_ms ?? 0),
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart
        data={points}
        margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
      >
        <defs>
          <linearGradient id="latencyFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" stopOpacity={0.4} />
            <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#27272a" vertical={false} />
        <XAxis
          dataKey="time"
          tickFormatter={fmtTime}
          tick={{ fill: "#71717a", fontSize: 11 }}
          stroke="#3f3f46"
          minTickGap={48}
        />
        <YAxis
          tick={{ fill: "#71717a", fontSize: 11 }}
          stroke="#3f3f46"
          width={44}
          unit="ms"
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
          formatter={(v) => [`${v}ms`, "Latency"]}
        />
        <Area
          type="monotone"
          dataKey="latency"
          stroke="#22c55e"
          strokeWidth={2}
          fill="url(#latencyFill)"
          connectNulls
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
