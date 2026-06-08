import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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
  // Return immediately — never block the Add button on a scrape + thumbnail caching
  // crawl (that made the button appear to hang). The actual data pull happens
  // on-demand via the "Refresh now" button (or the per-competitor scrape kicked
  // right after add). Profile + reels are populated by /api/competitors/[id]/scrape.
  return NextResponse.json(competitor, { status: 201 });
}
