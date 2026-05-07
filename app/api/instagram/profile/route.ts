import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const conn = await prisma.instagramConnection.findUnique({
    where: { clientId: parseInt(clientId) },
  });
  if (!conn) return NextResponse.json({ error: "not_connected" }, { status: 404 });

  const { accessToken, igUserId, igUsername, followers } = conn;

  try {
    const res = await fetch(
      `https://graph.instagram.com/v21.0/${igUserId}?fields=username,followers_count,media_count,profile_picture_url,biography&access_token=${accessToken}`
    );
    const data = await res.json();
    return NextResponse.json({
      igUserId,
      username: data.username || igUsername,
      followers: data.followers_count || followers,
      mediaCount: data.media_count,
      biography: data.biography,
      profilePictureUrl: data.profile_picture_url,
    });
  } catch {
    return NextResponse.json({ igUserId, username: igUsername, followers });
  }
}
