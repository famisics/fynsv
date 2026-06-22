import { NextResponse } from "next/server";
import { getLatestSnapshot } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const { checks, resources } = await getLatestSnapshot();
  return NextResponse.json({ checks, resources });
}
