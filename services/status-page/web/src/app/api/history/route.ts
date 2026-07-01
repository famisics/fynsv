import { type NextRequest, NextResponse } from "next/server";
import { getAllServicesHistory } from "@/lib/db";
import { parseRange } from "@/lib/types";

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("range");
  const range = parseRange(raw ?? undefined);

  const { resources, gaps } = await getAllServicesHistory(range);

  return NextResponse.json({
    range,
    resources: Object.fromEntries(resources),
    gaps,
  });
}
