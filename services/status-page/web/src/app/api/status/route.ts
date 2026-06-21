import { NextResponse } from "next/server";
import { getLatestChecks, getLatestResources } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const [checks, resources] = await Promise.all([
    getLatestChecks(),
    getLatestResources(),
  ]);
  return NextResponse.json({ checks, resources });
}
