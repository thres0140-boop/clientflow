import { NextRequest, NextResponse } from "next/server";
import { aiSchemaReady } from "@/ai/db/ready";
import { classifyUnclassified } from "@/ai/features/instagram/server/classifyCompetitorReels";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// GET /api/cron/classify-competitors  — vision-classify reels that have no format yet.
// Runs after the scrape cron; sweeps a batch each run until everything is classified.
export async function GET(req: NextRequest) {
  if (!(await aiSchemaReady())) return NextResponse.json({ ok: true, skipped: "schema_not_applied" }); // AI DB has no schema yet → no-op
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "300");
  const reset = req.nextUrl.searchParams.get("reset") === "1";
  const r = await classifyUnclassified(limit, reset);
  return NextResponse.json({ ok: true, ...r });
}
