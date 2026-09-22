import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/tiktok/video-concept?clientId= — returns { [videoId]: conceptId } for the client.
// GET /api/tiktok/video-concept?conceptId= — returns { videoIds: [...], count } for one concept.
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  const conceptId = req.nextUrl.searchParams.get("conceptId");

  if (conceptId) {
    const rows: any[] = await (prisma as any).tikTokVideoConcept.findMany({ // eslint-disable-line @typescript-eslint/no-explicit-any
      where: { conceptId: parseInt(conceptId) }, select: { videoId: true },
    }).catch(() => []);
    const videoIds = rows.map((r) => r.videoId);
    return NextResponse.json({ videoIds, count: videoIds.length });
  }

  if (!clientId) return NextResponse.json({});
  const rows: any[] = await (prisma as any).tikTokVideoConcept.findMany({ // eslint-disable-line @typescript-eslint/no-explicit-any
    where: { clientId: parseInt(clientId) }, select: { videoId: true, conceptId: true },
  }).catch(() => []);
  const map: Record<string, number> = {};
  for (const r of rows) map[r.videoId] = r.conceptId;
  return NextResponse.json(map);
}

// POST /api/tiktok/video-concept { clientId, videoId, conceptId|null } — set or clear a mapping.
export async function POST(req: NextRequest) {
  const { clientId, videoId, conceptId } = await req.json();
  if (!clientId || !videoId) return NextResponse.json({ error: "clientId and videoId required" }, { status: 400 });
  const cid = parseInt(String(clientId));
  if (conceptId == null) {
    await (prisma as any).tikTokVideoConcept.deleteMany({ where: { clientId: cid, videoId: String(videoId) } }).catch(() => {}); // eslint-disable-line @typescript-eslint/no-explicit-any
    return NextResponse.json({ ok: true, cleared: true });
  }
  await (prisma as any).tikTokVideoConcept.upsert({ // eslint-disable-line @typescript-eslint/no-explicit-any
    where: { clientId_videoId: { clientId: cid, videoId: String(videoId) } },
    update: { conceptId: parseInt(String(conceptId)) },
    create: { clientId: cid, videoId: String(videoId), conceptId: parseInt(String(conceptId)) },
  });
  return NextResponse.json({ ok: true });
}
