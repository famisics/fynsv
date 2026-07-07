import { type NextRequest, NextResponse } from "next/server";
import { getAllServicesHistory, getAllServicesUptime } from "@/lib/db";
import { parseRange } from "@/lib/types";

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("range");
  const range = parseRange(raw ?? undefined);

  const [{ resources, gaps }, uptime] = await Promise.all([
    getAllServicesHistory(range),
    getAllServicesUptime(range),
  ]);

  return NextResponse.json({ range, resources, gaps, uptime });
}
