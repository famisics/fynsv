import { type NextRequest, NextResponse } from "next/server";
import { getHistory } from "@/lib/db";
import { parseRange } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> },
) {
  const { serviceId } = await params;
  const raw = request.nextUrl.searchParams.get("range");
  const range = parseRange(raw ?? undefined);

  const { checks, resources } = await getHistory(serviceId, range);

  return NextResponse.json({ serviceId, range, checks, resources });
}
