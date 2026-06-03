import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { scrapeCompetitorProfile } from "@/lib/scrapeCompetitors";

export const maxDuration = 120;

// POST { clientId } → sync profile data (followers/following/posts/bio/avatar)
// for every competitor of that client. Or { id } for a single competitor.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  let ids: number[] = [];
  if (body.id) {
    ids = [parseInt(body.id)];
  } else if (body.clientId) {
    const comps = await prisma.competitor.findMany({ where: { clientId: parseInt(body.clientId) }, select: { id: true } });
    ids = comps.map((c) => c.id);
  }
  if (!ids.length) return NextResponse.json({ error: "no competitors" }, { status: 400 });

  let synced = 0;
  let lastError: string | undefined;
  for (const id of ids) {
    const r = await scrapeCompetitorProfile(id);
    if (r.ok) synced++;
    else lastError = r.error;
  }
  return NextResponse.json({ ok: true, synced, total: ids.length, error: synced === 0 ? lastError : undefined });
}
