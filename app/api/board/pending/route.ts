import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

// GET /api/board/pending?clientId=  → returns queued video urls AND clears the queue (drain),
// so the board materializes each one exactly once on open.
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ videos: [] });
  const cid = parseInt(clientId);
  const board = await (prisma as any).board.findUnique({ where: { clientId: cid } });
  let pending: string[] = [];
  try { pending = board?.pendingVideos ? JSON.parse(board.pendingVideos) : []; } catch { pending = []; }
  if (!Array.isArray(pending) || pending.length === 0) return NextResponse.json({ videos: [] });
  await (prisma as any).board.update({ where: { clientId: cid }, data: { pendingVideos: "[]" } }).catch(() => {});
  return NextResponse.json({ videos: pending });
}
