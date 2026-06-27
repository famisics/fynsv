import { ReferenceArea } from "recharts";
import { fmtTime } from "@/lib/format";
import type { Gap } from "@/lib/history";
import {
  CHART_AXIS_STROKE,
  CHART_TICK,
  GAP_FILL,
  GAP_FILL_OPACITY,
} from "./theme";

export const TIME_X_AXIS_PROPS = {
  dataKey: "time",
  type: "number",
  scale: "time",
  tickFormatter: fmtTime,
  tick: CHART_TICK,
  stroke: CHART_AXIS_STROKE,
  minTickGap: 48,
  allowDataOverflow: true,
} as const;

export function gapAreas(gaps: Gap[]) {
  return gaps.map((g) => (
    <ReferenceArea
      key={g.start}
      x1={g.start}
      x2={g.end}
      fill={GAP_FILL}
      fillOpacity={GAP_FILL_OPACITY}
      stroke="none"
      ifOverflow="hidden"
    />
  ));
}
