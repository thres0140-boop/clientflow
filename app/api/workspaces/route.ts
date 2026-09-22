import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/workspaces → all workspaces (with client counts), ordered.
export async function GET() {
  const workspaces = await (prisma as any).workspace.findMany({
    orderBy: [{ order: "asc" }, { id: "asc" }],
    select: { id: true, name: true, color: true, order: true, _count: { select: { clients: true } } },
  });
  return NextResponse.json(workspaces);
}

// POST /api/workspaces → create a workspace. Body: { name, color? }
export async function POST(req: NextRequest) {
  const body = await req.json();
  const name = String(body.name || "").trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const max = await (prisma as any).workspace.aggregate({ _max: { order: true } });
  const ws = await (prisma as any).workspace.create({
    data: { name, color: body.color || "#3d4aa3", order: (max._max.order ?? 0) + 1 },
  });
  return NextResponse.json(ws);
}
