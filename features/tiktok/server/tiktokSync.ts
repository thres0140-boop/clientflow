import { prisma } from "@/shared/db/prisma";
import { fetchTikTokProfileAndVideos } from "@/features/tiktok/server/scrapeTikTok";

// Scrape one TikTok competitor → refresh their profile stats + upsert their videos, and record a
// point-in-time CompetitorReelSnapshot (views/likes/comments) for each video. Those daily snapshots
// are what let us compute day-over-day view growth ("going viral") later.
// Returns { found } = whether the account actually returned profile data. Throws on rate-limit (429)
// so callers can stop a bulk run.
export async function syncTikTokCompetitor(competitorId: number, handle: string): Promise<{ reels: number; found: boolean }> {
  const { profile, videos } = await fetchTikTokProfileAndVideos(handle, 2);
  if (profile) {
    await (prisma as any).competitor.update({
      where: { id: competitorId },
      data: {
        name: profile.nickname || undefined, bio: profile.bio || undefined,
        followerCount: profile.followerCount ?? undefined, followingCount: profile.followingCount ?? undefined,
        postCount: profile.videoCount ?? undefined, profilePicUrl: profile.avatarUrl || undefined,
        verified: profile.verified ?? undefined, lastProfileSyncAt: new Date(), lastScrapedAt: new Date(), lastScrapeError: null,
      },
    }).catch(() => {});
  }
  let count = 0;
  for (const v of videos) {
    const reel = await (prisma as any).competitorReel.upsert({
      where: { competitorId_shortcode: { competitorId, shortcode: v.id } },
      update: { caption: v.caption || undefined, mediaUrl: v.playUrl || undefined, mediaUrlAt: v.playUrl ? new Date() : undefined, permalink: v.permalink || undefined, postedAt: v.createdAt || undefined, lastScrapedAt: new Date() },
      create: { competitorId, platform: "tiktok", shortcode: v.id, caption: v.caption || null, thumbnailUrl: v.coverUrl || null, mediaUrl: v.playUrl || null, mediaUrlAt: v.playUrl ? new Date() : null, permalink: v.permalink || null, postedAt: v.createdAt || null },
    });
    await (prisma as any).competitorReelSnapshot.create({ data: { reelId: reel.id, viewCount: v.views ?? null, likeCount: v.likes ?? null, commentCount: v.comments ?? null } }).catch(() => {});
    count++;
  }
  return { reels: count, found: !!profile };
}
