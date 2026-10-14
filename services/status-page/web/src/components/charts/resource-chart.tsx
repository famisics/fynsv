"use client";

import { useId } from "react";
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
import { gapAreas, TIME_X_AXIS_PROPS } from "./shared";
import {
  CHART_AXIS_STROKE,
  CHART_GRID_STROKE,
  CHART_LABEL_STYLE,
  CHART_TICK,
  CHART_TOOLTIP_STYLE,
} from "./theme";

// 1 指標だけを描く。3 本の線を重ねると交差して読みにくいため、指標ごとに分けて並べる
export function ResourceChart({
  points,
  label,
  color,
  domain,
  gaps,
}: {
  points: { time: number; value: number | null }[];
  label: string;
  color: string;
  domain: [number, number];
  gaps: Gap[];
}) {
  const data = [
    ...points,
    ...gaps.map((g) => ({ time: (g.start + g.end) / 2, value: null })),
  ].sort((a, b) => a.time - b.time);
  const gradientId = useId();

  return (
    <ResponsiveContainer width="100%" height={120}>
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={CHART_GRID_STROKE} vertical={false} />
        {gapAreas(gaps)}
        <XAxis {...TIME_X_AXIS_PROPS} domain={domain} />
        <YAxis
          domain={[0, 100]}
          ticks={[0, 50, 100]}
          tick={CHART_TICK}
          stroke={CHART_AXIS_STROKE}
          width={36}
          unit="%"
        />
        <Tooltip
          contentStyle={CHART_TOOLTIP_STYLE}
          labelStyle={CHART_LABEL_STYLE}
          labelFormatter={(v) => fmtTime(v as number)}
          formatter={(value) => [
            value === null ? "—" : `${Math.round(value as number)}%`,
            label,
          ]}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#${gradientId})`}
          connectNulls
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
