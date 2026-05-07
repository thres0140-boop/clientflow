import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  const handle = req.nextUrl.searchParams.get("handle");
  if (!clientId || !handle) return NextResponse.json({ error: "clientId and handle required" }, { status: 400 });

  const conn = await prisma.instagramConnection.findUnique({ where: { clientId: parseInt(clientId) } });
  if (!conn) return NextResponse.json({ error: "not_connected" }, { status: 404 });

  const { accessToken, igUserId } = conn;

  try {
    const fields = "business_discovery.fields(username,followers_count,media_count,media{id,media_type,media_product_type,thumbnail_url,media_url,timestamp,like_count,comments_count,caption})";
    const res = await fetch(
      `https://graph.instagram.com/v21.0/${igUserId}?fields=${encodeURIComponent(fields)}&username=${encodeURIComponent(handle)}&access_token=${accessToken}`
    );
    const data = await res.json();

    if (data.error) return NextResponse.json({ error: data.error.message }, { status: 400 });

    const bd = data.business_discovery;
    const reels = (bd?.media?.data || []).filter(
      (m: { media_type: string }) => m.media_type === "VIDEO" || m.media_type === "REEL"
    );

    return NextResponse.json({
      username: bd?.username || handle,
      followers: bd?.followers_count,
      reels,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
