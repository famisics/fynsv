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
import type { Gap } from "@/lib/history";
import type { ServiceCheck } from "@/lib/types";
import { gapAreas, TIME_X_AXIS_PROPS } from "./shared";
import {
  CHART_AXIS_STROKE,
  CHART_GRID_STROKE,
  CHART_LABEL_STYLE,
  CHART_TICK,
  CHART_TOOLTIP_STYLE,
} from "./theme";

export function LatencyChart({
  data,
  domain,
  gaps,
}: {
  data: ServiceCheck[];
  domain: [number, number];
  gaps: Gap[];
}) {
  const points = [
    ...data.map((c) => ({
      time: Date.parse(c.checked_at),
      latency: c.status === "down" ? null : Math.round(c.latency_ms ?? 0),
    })),
    ...gaps.map((g) => ({ time: (g.start + g.end) / 2, latency: null })),
  ].sort((a, b) => a.time - b.time);

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
        {gapAreas(gaps)}
        <XAxis {...TIME_X_AXIS_PROPS} domain={domain} />
        <YAxis
          tick={CHART_TICK}
          stroke={CHART_AXIS_STROKE}
          width={44}
          unit="ms"
        />
        <Tooltip
          contentStyle={CHART_TOOLTIP_STYLE}
          labelStyle={CHART_LABEL_STYLE}
          labelFormatter={(v) => fmtTime(v as number)}
          formatter={(v) => [`${v}ms`, "Latency"]}
        />
        <Area
          type="monotone"
          dataKey="latency"
          stroke="#22c55e"
          strokeWidth={2}
          fill="url(#latencyFill)"
          connectNulls={false}
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
