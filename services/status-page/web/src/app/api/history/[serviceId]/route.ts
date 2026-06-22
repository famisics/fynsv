import { type NextRequest, NextResponse } from "next/server";
import { getHistory } from "@/lib/db";
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

  const { checks, resources } = await getHistory(serviceId, range);

  return NextResponse.json({ serviceId, range, checks, resources });
}
