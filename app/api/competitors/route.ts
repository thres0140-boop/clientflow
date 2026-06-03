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
  // Fast path so the row + stats appear immediately: pull basic profile data
  // (one request) and a light incremental reel scrape. The daily cron does the
  // deep backfill — we never block the Add button on a 12-page crawl.
  await scrapeCompetitorProfile(competitor.id).catch(() => {});
  await scrapeCompetitor(competitor.id, { full: false }).catch(() => {});
  const fresh = await prisma.competitor.findUnique({ where: { id: competitor.id } });
  return NextResponse.json(fresh ?? competitor, { status: 201 });
}
