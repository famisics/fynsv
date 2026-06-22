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
import { fmtTime } from "@/lib/format";
import type { ServiceCheck } from "@/lib/types";
import { CHART_AXIS_STROKE, CHART_GRID_STROKE, CHART_LABEL_STYLE, CHART_TICK, CHART_TOOLTIP_STYLE } from "./theme";

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
        <CartesianGrid stroke={CHART_GRID_STROKE} vertical={false} />
        <XAxis
          dataKey="time"
          tickFormatter={fmtTime}
          tick={CHART_TICK}
          stroke={CHART_AXIS_STROKE}
          minTickGap={48}
        />
        <YAxis
          tick={CHART_TICK}
          stroke={CHART_AXIS_STROKE}
          width={44}
          unit="ms"
        />
        <Tooltip
          contentStyle={CHART_TOOLTIP_STYLE}
          labelStyle={CHART_LABEL_STYLE}
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
