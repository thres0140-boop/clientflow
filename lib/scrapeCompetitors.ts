import { prisma } from "@/lib/prisma";

// ── Scraper provider (RapidAPI instagram-scraper-api2) ──────────────────────
// All scraping goes through this one function. To swap providers (e.g. Apify),
// only this needs to change — everything downstream works off the normalized shape.
export type ScrapedReel = {
  shortcode: string;
  caption: string;
  thumbnailUrl?: string;
  mediaUrl?: string;
  permalink?: string;
  postedAt?: Date;
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
};

async function fetchReelsFromProvider(handle: string): Promise<ScrapedReel[]> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) throw new Error("RAPIDAPI_KEY not set");

  const res = await fetch(
    `https://instagram-scraper-api2.p.rapidapi.com/v1.2/reels?username_or_id_or_url=${encodeURIComponent(handle)}`,
    { headers: { "X-RapidAPI-Key": apiKey, "X-RapidAPI-Host": "instagram-scraper-api2.p.rapidapi.com" } }
  );
  const data = await res.json();
  if (data.detail || data.error) throw new Error(String(data.detail || data.error));

  const raw: unknown[] = (data?.data?.items ?? data?.items ?? data?.reels ?? []) as unknown[];
  return raw.map((item) => {
    const m = item as Record<string, any>;
    const media = (m.media as Record<string, any>) || m; // some shapes nest under .media
    const caption = media.caption as Record<string, any> | string | null;
    const code = media.code || media.shortcode || m.code || m.shortcode || String(media.id ?? media.pk ?? m.id ?? m.pk ?? "");
    const takenAt = media.taken_at ?? media.taken_at_timestamp ?? m.taken_at;
    return {
      shortcode: String(code),
      caption: typeof caption === "string" ? caption : (caption?.text as string) || "",
      thumbnailUrl: media.thumbnail_url || media.image_versions2?.candidates?.[0]?.url || undefined,
      mediaUrl: media.video_url || media.video_versions?.[0]?.url || undefined,
      permalink: code ? `https://www.instagram.com/reel/${code}/` : undefined,
      postedAt: takenAt ? new Date(Number(takenAt) * (Number(takenAt) > 1e12 ? 1 : 1000)) : undefined,
      viewCount: Number(media.play_count ?? media.view_count ?? media.ig_play_count ?? 0) || undefined,
      likeCount: Number(media.like_count ?? 0) || undefined,
      commentCount: Number(media.comment_count ?? 0) || undefined,
    } as ScrapedReel;
  }).filter((r) => r.shortcode);
}

// ── Scrape one competitor: upsert reels from the last `windowDays`, append a snapshot ──
export async function scrapeCompetitor(competitorId: number, windowDays = 7): Promise<{ ok: boolean; reels: number; error?: string }> {
  const competitor = await prisma.competitor.findUnique({ where: { id: competitorId } });
  if (!competitor) return { ok: false, reels: 0, error: "not found" };

  try {
    const scraped = await fetchReelsFromProvider(competitor.handle);
    const cutoff = Date.now() - windowDays * 86400000;
    // Keep recent reels; if no postedAt, keep it (better to track than drop).
    const recent = scraped.filter((r) => !r.postedAt || r.postedAt.getTime() >= cutoff);

    let count = 0;
    for (const r of recent) {
      const reel = await (prisma as any).competitorReel.upsert({
        where: { competitorId_shortcode: { competitorId, shortcode: r.shortcode } },
        update: {
          caption: r.caption || undefined,
          thumbnailUrl: r.thumbnailUrl || undefined,
          mediaUrl: r.mediaUrl || undefined,
          permalink: r.permalink || undefined,
          postedAt: r.postedAt || undefined,
          lastScrapedAt: new Date(),
        },
        create: {
          competitorId,
          shortcode: r.shortcode,
          caption: r.caption || null,
          thumbnailUrl: r.thumbnailUrl || null,
          mediaUrl: r.mediaUrl || null,
          permalink: r.permalink || null,
          postedAt: r.postedAt || null,
        },
      });
      await (prisma as any).competitorReelSnapshot.create({
        data: {
          reelId: reel.id,
          viewCount: r.viewCount ?? null,
          likeCount: r.likeCount ?? null,
          commentCount: r.commentCount ?? null,
        },
      });
      count++;
    }

    await prisma.competitor.update({
      where: { id: competitorId },
      data: { lastScrapedAt: new Date(), lastScrapeError: null } as any,
    });
    return { ok: true, reels: count };
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err).slice(0, 300);
    await prisma.competitor.update({
      where: { id: competitorId },
      data: { lastScrapedAt: new Date(), lastScrapeError: msg } as any,
    }).catch(() => {});
    return { ok: false, reels: 0, error: msg };
  }
}
