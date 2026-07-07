"use client";

import { createContext, useContext, useState, useTransition } from "react";
import { RangeSelector } from "@/components/range-selector";
import type { Gap } from "@/lib/history";
import type { ResourceSnapshot, TimeRange } from "@/lib/types";
import type { UptimeSummary } from "@/lib/uptime";

interface HistoryContextValue {
  range: TimeRange;
  resources: Map<string, ResourceSnapshot[]>;
  gaps: Gap[];
  uptime: Record<string, UptimeSummary>;
  loading: boolean;
  setRange: (range: TimeRange) => void;
}

const HistoryContext = createContext<HistoryContextValue | null>(null);

export function HistoryProvider({
  initialRange,
  initialResources,
  initialGaps,
  initialUptime,
  children,
}: {
  initialRange: TimeRange;
  initialResources: Record<string, ResourceSnapshot[]>;
  initialGaps: Gap[];
  initialUptime: Record<string, UptimeSummary>;
  children: React.ReactNode;
}) {
  const [range, setRangeState] = useState(initialRange);
  const [resources, setResources] = useState(
    () => new Map(Object.entries(initialResources)),
  );
  const [gaps, setGaps] = useState(initialGaps);
  const [uptime, setUptime] = useState(initialUptime);
  const [isPending, startTransition] = useTransition();

  function setRange(next: TimeRange) {
    if (next === range) return;
    startTransition(async () => {
      const res = await fetch(`/api/history?range=${next}`);
      const json = await res.json();
      setResources(new Map(Object.entries(json.resources)));
      setGaps(json.gaps);
      setUptime(json.uptime);
      setRangeState(next);
    });
  }

  return (
    <HistoryContext.Provider
      value={{ range, resources, gaps, uptime, loading: isPending, setRange }}
    >
      {children}
    </HistoryContext.Provider>
  );
}

export function useHistory() {
  const ctx = useContext(HistoryContext);
  if (!ctx) throw new Error("useHistory must be used within HistoryProvider");
  return ctx;
}

export function GlobalRangeSelector() {
  const { range, loading, setRange } = useHistory();
  return (
    <RangeSelector current={range} onChange={setRange} disabled={loading} />
  );
}
