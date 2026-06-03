import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { scrapeCompetitor, scrapeCompetitorProfile } from "@/lib/scrapeCompetitors";

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json([]);
  const competitors = await prisma.competitor.findMany({
    where: { clientId: parseInt(clientId) },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(competitors);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const competitor = await prisma.competitor.create({
    data: {
      clientId: parseInt(body.clientId),
      handle: body.handle,
      name: body.name || null,
      niche: body.niche || null,
      followerCount: body.followerCount ? parseInt(body.followerCount) : null,
      notes: body.notes || null,
      profileUrl: body.profileUrl || null,
    },
  });
  // Pull basic profile data (followers/following/posts/bio/avatar) + a full
  // reel backfill so the new competitor has both stats and history right away.
  await scrapeCompetitorProfile(competitor.id).catch(() => {});
  await scrapeCompetitor(competitor.id, { full: true }).catch(() => {});
  const fresh = await prisma.competitor.findUnique({ where: { id: competitor.id } });
  return NextResponse.json(fresh ?? competitor, { status: 201 });
}
