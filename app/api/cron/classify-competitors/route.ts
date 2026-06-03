import { NextRequest, NextResponse } from "next/server";
import { classifyUnclassified } from "@/lib/classifyCompetitorReels";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// GET /api/cron/classify-competitors  — vision-classify reels that have no format yet.
// Runs after the scrape cron; sweeps a batch each run until everything is classified.
export async function GET(req: NextRequest) {
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "300");
  const r = await classifyUnclassified(limit);
  return NextResponse.json({ ok: true, ...r });
}
