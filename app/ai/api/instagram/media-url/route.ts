import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/ai/db/prisma";

export const dynamic = "force-dynamic";

const NOSTORE = { "Cache-Control": "no-store, max-age=0" };

// GET /api/instagram/media-url?clientId=X&mediaId=<IG media id>
// Resolves a single client reel's fresh, playable media_url via the client's own Instagram
// connection (the Graph API returns a time-limited CDN url, so we fetch it fresh each time).
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  const mediaId = req.nextUrl.searchParams.get("mediaId");
  if (!clientId || !mediaId) return NextResponse.json({ url: null, error: "clientId and mediaId required" }, { status: 400, headers: NOSTORE });

  const conn = await prisma.instagramConnection.findUnique({ where: { clientId: parseInt(clientId) } });
  if (!conn) return NextResponse.json({ url: null, error: "not_connected" }, { headers: NOSTORE });

  try {
    const r = await fetch(`https://graph.instagram.com/v21.0/${mediaId}?fields=media_url,thumbnail_url,permalink&access_token=${conn.accessToken}`);
    const d = await r.json();
    return NextResponse.json({ url: d?.media_url || null, thumbnail: d?.thumbnail_url || null, permalink: d?.permalink || null }, { headers: NOSTORE });
  } catch {
    return NextResponse.json({ url: null }, { headers: NOSTORE });
  }
}
