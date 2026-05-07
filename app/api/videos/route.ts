import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  const where = clientId ? { clientId: parseInt(clientId) } : {};
  const videos = await prisma.trackedVideo.findMany({
    where,
    include: {
      client: { select: { name: true, color: true } },
      concept: { select: { name: true } },
    },
    orderBy: { views: "desc" },
  });
  return NextResponse.json(videos);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const video = await prisma.trackedVideo.create({
    data: {
      clientId: parseInt(body.clientId),
      conceptId: body.conceptId ? parseInt(body.conceptId) : null,
      title: body.title,
      url: body.url || null,
      views: parseInt(body.views) || 0,
      likes: parseInt(body.likes) || 0,
      comments: parseInt(body.comments) || 0,
      shares: parseInt(body.shares) || 0,
      saves: parseInt(body.saves) || 0,
      hookUsed: body.hookUsed || null,
      hookType: body.hookType || null,
      datePosted: body.datePosted || null,
      notes: body.notes || null,
    },
    include: {
      client: { select: { name: true, color: true } },
      concept: { select: { name: true } },
    },
  });
  return NextResponse.json(video, { status: 201 });
}
