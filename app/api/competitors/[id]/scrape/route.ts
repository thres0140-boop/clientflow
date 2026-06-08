import { NextRequest, NextResponse } from "next/server";
import { scrapeCompetitor, scrapeCompetitorProfile } from "@/lib/scrapeCompetitors";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

// POST /api/competitors/[id]/scrape — pull profile + reels for ONE competitor.
// Called (fire-and-forget) right after adding a competitor so its data populates
// without blocking the Add button. Safe to call again; it just refreshes.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cid = parseInt(id);
  if (!cid) return NextResponse.json({ error: "bad id" }, { status: 400 });
  await scrapeCompetitorProfile(cid).catch(() => {});
  const r = await scrapeCompetitor(cid, { full: false }).catch((e) => ({ ok: false, reels: 0, error: String(e) }));
  return NextResponse.json(r);
}
