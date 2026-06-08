import { NextRequest, NextResponse } from "next/server";
import { fetchProfileInfo, fetchReelsFromProvider } from "@/lib/scrapeCompetitors";

export const runtime = "nodejs";
export const maxDuration = 60;

// GET /api/competitors/preview?handle= → live profile + recent reels for reviewing a
// candidate in-app (not stored). A few API requests per call.
export async function GET(req: NextRequest) {
  const handle = req.nextUrl.searchParams.get("handle");
  if (!handle) return NextResponse.json({ error: "handle required" }, { status: 400 });
  try {
    const [profile, reels] = await Promise.all([
      fetchProfileInfo(handle).catch(() => null),
      fetchReelsFromProvider(handle, 1).catch(() => []),
    ]);
    const sorted = [...reels].sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0)).slice(0, 12);
    return NextResponse.json({
      profile,
      reels: sorted.map((r) => ({
        shortcode: r.shortcode,
        caption: r.caption,
        thumbnailUrl: r.thumbnailUrl,
        mediaUrl: r.mediaUrl ?? null,
        permalink: r.permalink,
        views: r.viewCount ?? null,
        likes: r.likeCount ?? null,
        comments: r.commentCount ?? null,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
