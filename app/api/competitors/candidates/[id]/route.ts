import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// POST /api/competitors/candidates/[id]  { action: "accept" | "reject", clientId }
// accept → promote into a Competitor row (then the client kicks the normal scrape).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cid = parseInt(id);
  const { action } = await req.json();
  const cand = await prisma.competitorCandidate.findUnique({ where: { id: cid } });
  if (!cand) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (action === "reject") {
    await prisma.competitorCandidate.update({ where: { id: cid }, data: { status: "rejected" } });
    return NextResponse.json({ ok: true });
  }

  // accept — create the competitor (skip if already tracked), mark candidate accepted.
  const existing = await prisma.competitor.findFirst({ where: { clientId: cand.clientId, handle: cand.handle } });
  let competitor = existing;
  if (!existing) {
    competitor = await prisma.competitor.create({
      data: { clientId: cand.clientId, handle: cand.handle, name: cand.name, followerCount: cand.followerCount, profilePicUrl: cand.profilePicUrl },
    });
  }
  await prisma.competitorCandidate.update({ where: { id: cid }, data: { status: "accepted" } });
  return NextResponse.json({ ok: true, competitorId: competitor!.id });
}
