import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/competitors/candidates?clientId=&status=pending → discovered profiles to review
export async function GET(req: NextRequest) {
  const clientId = parseInt(req.nextUrl.searchParams.get("clientId") || "");
  if (!clientId) return NextResponse.json([]);
  const status = req.nextUrl.searchParams.get("status") || "pending";
  const candidates = await prisma.competitorCandidate.findMany({
    where: { clientId, status },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  return NextResponse.json(candidates);
}

// DELETE /api/competitors/candidates?clientId= → clear all candidates for a client (reset finder)
export async function DELETE(req: NextRequest) {
  const clientId = parseInt(req.nextUrl.searchParams.get("clientId") || "");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });
  const { count } = await prisma.competitorCandidate.deleteMany({ where: { clientId } });
  return NextResponse.json({ ok: true, deleted: count });
}
