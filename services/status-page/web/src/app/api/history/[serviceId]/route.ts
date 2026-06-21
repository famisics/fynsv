import { type NextRequest, NextResponse } from "next/server";
import { getCheckHistory, getResourceHistory } from "@/lib/db";
import type { TimeRange } from "@/lib/types";

export const dynamic = "force-dynamic";

const VALID_RANGES: TimeRange[] = ["24h", "7d", "30d"];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> },
) {
  const { serviceId } = await params;
  const raw = request.nextUrl.searchParams.get("range");
  const range: TimeRange = VALID_RANGES.includes(raw as TimeRange)
    ? (raw as TimeRange)
    : "24h";

  const [checks, resources] = await Promise.all([
    getCheckHistory(serviceId, range),
    getResourceHistory(serviceId, range),
  ]);

  return NextResponse.json({ serviceId, range, checks, resources });
}
