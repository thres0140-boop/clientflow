import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const { clientId, caption, videoUrl } = await req.json();
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const conn = await (prisma as any).instagramConnection.findUnique({
    where: { clientId: parseInt(clientId) },
  });
  if (!conn) return NextResponse.json({ error: "not_connected" }, { status: 404 });

  const { accessToken, igUserId } = conn;

  if (!videoUrl) {
    return NextResponse.json({ error: "no_media", message: "No video/photo URL found on this draft. Upload content in the Kanban first." }, { status: 400 });
  }

  const isVideo = /\.(mp4|mov|avi|mkv)(\?|$)/i.test(videoUrl);

  try {
    // Step 1: Create media container
    const createBody: Record<string, string> = {
      caption: caption || "",
      access_token: accessToken,
    };

    if (isVideo) {
      createBody.media_type = "REELS";
      createBody.video_url = videoUrl;
    } else {
      createBody.image_url = videoUrl;
    }

    const createRes = await fetch(
      `https://graph.instagram.com/v21.0/${igUserId}/media`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createBody),
      }
    );
    const createData = await createRes.json();

    if (createData.error) {
      return NextResponse.json({ error: createData.error.message, code: createData.error.code }, { status: 400 });
    }

    const containerId = createData.id;

    // Step 2: Poll for video processing (up to 60s for videos)
    if (isVideo) {
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const statusRes = await fetch(
          `https://graph.instagram.com/v21.0/${containerId}?fields=status_code&access_token=${accessToken}`
        );
        const statusData = await statusRes.json();
        if (statusData.status_code === "FINISHED") break;
        if (statusData.status_code === "ERROR") {
          return NextResponse.json({ error: "Video processing failed" }, { status: 400 });
        }
      }
    }

    // Step 3: Publish
    const publishRes = await fetch(
      `https://graph.instagram.com/v21.0/${igUserId}/media_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creation_id: containerId, access_token: accessToken }),
      }
    );
    const publishData = await publishRes.json();

    if (publishData.error) {
      return NextResponse.json({ error: publishData.error.message, code: publishData.error.code }, { status: 400 });
    }

    return NextResponse.json({ success: true, igMediaId: publishData.id });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
