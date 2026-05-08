import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const handle = req.nextUrl.searchParams.get("handle");
  if (!handle) return NextResponse.json({ error: "handle required" }, { status: 400 });

  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) return NextResponse.json({ error: "RAPIDAPI_KEY not set" }, { status: 500 });

  try {
    const res = await fetch(
      `https://instagram-scraper-api2.p.rapidapi.com/v1.2/reels?username_or_id_or_url=${encodeURIComponent(handle)}`,
      {
        headers: {
          "X-RapidAPI-Key": apiKey,
          "X-RapidAPI-Host": "instagram-scraper-api2.p.rapidapi.com",
        },
        next: { revalidate: 300 }, // cache 5 min
      }
    );

    const data = await res.json();

    if (data.detail || data.error) {
      return NextResponse.json({ error: data.detail || data.error }, { status: 400 });
    }

    // Normalise response — the scraper returns items with slightly different shapes
    const raw: unknown[] = data?.data?.items ?? data?.items ?? data?.reels ?? [];

    const reels = raw.map((item) => {
      const m = item as Record<string, unknown>;
      const user = (m.user as Record<string, unknown>) ?? {};
      const caption = (m.caption as Record<string, unknown> | null);
      return {
        id: String(m.id ?? m.pk ?? Math.random()),
        thumbnail_url: (m.thumbnail_url as string) || (m.image_versions2 as Record<string, unknown> | undefined)?.candidates?.[0] as string | undefined,
        media_url: (m.video_url as string) || (m.video_versions as unknown[])?.at?.(0) && ((m.video_versions as Record<string, unknown>[])[0]?.url as string),
        caption: (caption?.text as string) || (m.caption as string) || "",
        timestamp: (m.taken_at as string) || (m.timestamp as string) || new Date().toISOString(),
        like_count: Number(m.like_count ?? m.likes_count ?? 0),
        comments_count: Number(m.comment_count ?? m.comments_count ?? 0),
        plays: Number(m.play_count ?? m.view_count ?? 0) || undefined,
        handle: (user.username as string) || handle,
      };
    });

    return NextResponse.json({ reels });
  } catch (err) {
    console.error("competitor-reels error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
