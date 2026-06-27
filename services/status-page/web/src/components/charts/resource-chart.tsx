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
import { fmtTime, percent } from "@/lib/format";
import type { Gap } from "@/lib/history";
import type { ResourceSnapshot } from "@/lib/types";
import { gapAreas, TIME_X_AXIS_PROPS } from "./shared";
import {
  CHART_AXIS_STROKE,
  CHART_GRID_STROKE,
  CHART_LABEL_STYLE,
  CHART_TICK,
  CHART_TOOLTIP_STYLE,
} from "./theme";

type Metric = "cpu" | "memory" | "disk";

const SERIES: Record<Metric, { label: string; color: string }> = {
  cpu: { label: "CPU", color: "#38bdf8" },
  memory: { label: "Memory", color: "#a78bfa" },
  disk: { label: "Disk", color: "#f472b6" },
};

export function ResourceChart({
  data,
  metrics,
  domain,
  gaps,
}: {
  data: ResourceSnapshot[];
  metrics: Metric[];
  domain: [number, number];
  gaps: Gap[];
}) {
  const points = [
    ...data.map((r) => ({
      time: Date.parse(r.recorded_at),
      cpu: r.cpu_percent === null ? null : Math.round(r.cpu_percent * 10) / 10,
      memory: percent(r.mem_used_bytes, r.mem_total_bytes),
      disk: percent(r.disk_used_bytes, r.disk_total_bytes),
    })),
    ...gaps.map((g) => ({
      time: (g.start + g.end) / 2,
      cpu: null,
      memory: null,
      disk: null,
    })),
  ].sort((a, b) => a.time - b.time);

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart
        data={points}
        margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
      >
        <CartesianGrid stroke={CHART_GRID_STROKE} vertical={false} />
        {gapAreas(gaps)}
        <XAxis {...TIME_X_AXIS_PROPS} domain={domain} />
        <YAxis
          domain={[0, 100]}
          tick={CHART_TICK}
          stroke={CHART_AXIS_STROKE}
          width={44}
          unit="%"
        />
        <Tooltip
          contentStyle={CHART_TOOLTIP_STYLE}
          labelStyle={CHART_LABEL_STYLE}
          labelFormatter={(v) => fmtTime(v as number)}
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
