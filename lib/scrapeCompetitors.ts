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

const SCRAPER_HOST = "instagram-scraper-stable-api.p.rapidapi.com";

// Instagram media IDs (pk) encode their creation time in the high bits.
// timestamp_ms = (pk >> 23) + 1314220021721  (Instagram's epoch offset).
function postedAtFromPk(pk: string): Date | undefined {
  try {
    if (!/^\d+$/.test(pk)) return undefined;
    const ms = Number((BigInt(pk) >> BigInt(23)) + BigInt("1314220021721"));
    if (!isFinite(ms) || ms < 1262304000000) return undefined; // sanity: after 2010
    return new Date(ms);
  } catch { return undefined; }
}

function mapItem(it: any): ScrapedReel {
  const m = it?.node?.media ?? it?.media ?? it;
  const code = m.code || m.shortcode || String(m.pk ?? m.id ?? "");
  const pk = String(m.pk ?? (m.id ? String(m.id).split("_")[0] : ""));
  const caption = m.caption as Record<string, any> | string | null;
  return {
    shortcode: String(code),
    caption: typeof caption === "string" ? caption : (caption?.text as string) || "",
    thumbnailUrl: m.image_versions2?.candidates?.[0]?.url || m.thumbnail_url || undefined,
    mediaUrl: m.video_versions?.[0]?.url || undefined,
    permalink: code ? `https://www.instagram.com/reel/${code}/` : undefined,
    postedAt: postedAtFromPk(pk),
    viewCount: Number(m.play_count ?? m.view_count ?? m.ig_play_count ?? 0) || undefined,
    likeCount: Number(m.like_count ?? 0) || undefined,
    commentCount: Number(m.comment_count ?? 0) || undefined,
  } as ScrapedReel;
}

// Re-fetch a fresh, currently-playable video URL for one reel (IG CDN links expire).
// Searches the latest pages and returns as soon as the shortcode is found.
export async function freshReelMediaUrl(handle: string, shortcode: string, maxPages = 5): Promise<string | null> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey || !shortcode) return null;
  const username = handle.replace(/^@/, "").trim();
  let token = "";
  for (let page = 0; page < maxPages; page++) {
    const body = new URLSearchParams({ username_or_url: username, amount: "50" });
    if (token) body.set("pagination_token", token);
    let data: any;
    try {
      const res = await fetch(`https://${SCRAPER_HOST}/get_ig_user_reels.php`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "x-rapidapi-host": SCRAPER_HOST,
          "x-rapidapi-key": apiKey,
        },
        body: body.toString(),
      });
      data = await res.json();
    } catch { break; }
    if (data?.detail || data?.error) break;
    const items: any[] = (data?.reels ?? data?.data?.reels ?? []) as any[];
    for (const it of items.map(mapItem)) {
      if (it.shortcode === shortcode && it.mediaUrl) return it.mediaUrl;
    }
    token = data.pagination_token || data?.data?.pagination_token || "";
    if (!token) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

// Fetch reels (newest first), following pagination tokens up to `maxPages`
// (a cost cap). We don't date-filter — we store whatever the account has.
async function fetchReelsFromProvider(handle: string, maxPages: number): Promise<ScrapedReel[]> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) throw new Error("RAPIDAPI_KEY not set");

  const username = handle.replace(/^@/, "").trim();
  const out: ScrapedReel[] = [];
  const seen = new Set<string>();
  let token = "";

  for (let page = 0; page < maxPages; page++) {
    const body = new URLSearchParams({ username_or_url: username, amount: "50" });
    if (token) body.set("pagination_token", token);
    const res = await fetch(`https://${SCRAPER_HOST}/get_ig_user_reels.php`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "x-rapidapi-host": SCRAPER_HOST,
        "x-rapidapi-key": apiKey,
      },
      body: body.toString(),
    });
    const data = await res.json();
    if (data.detail || data.error) {
      if (page === 0) throw new Error(String(data.detail || data.error));
      break; // partial pages are fine
    }
    const items: any[] = (data?.reels ?? data?.data?.reels ?? []) as any[];
    if (!items.length) break;

    let added = 0;
    for (const it of items.map(mapItem)) {
      if (!it.shortcode || seen.has(it.shortcode)) continue;
      seen.add(it.shortcode);
      out.push(it);
      added++;
    }

    token = data.pagination_token || data?.data?.pagination_token || "";
    if (!token || added === 0) break; // no more pages / nothing new

    await new Promise((r) => setTimeout(r, 300)); // gentle throttle between pages
  }
  return out;
}

// ── Profile info (followers, following, posts, bio, avatar) ──────────────────
export type ProfileInfo = {
  name?: string;
  bio?: string;
  followerCount?: number;
  followingCount?: number;
  postCount?: number;
  profilePicUrl?: string;
  verified?: boolean;
};

const numOr = (...vals: any[]): number | undefined => {
  for (const v of vals) {
    if (v === null || v === undefined) continue;
    const n = typeof v === "object" ? Number(v.count) : Number(v);
    if (isFinite(n) && n >= 0) return n;
  }
  return undefined;
};
const strOr = (...vals: any[]): string | undefined => {
  for (const v of vals) if (typeof v === "string" && v.trim()) return v.trim();
  return undefined;
};

// Fetch basic profile data for a handle. The provider's response shape isn't
// documented, so we dig through the common containers and field aliases
// (private-API style + graphql style).
export async function fetchProfileInfo(handle: string): Promise<ProfileInfo> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) throw new Error("RAPIDAPI_KEY not set");
  const username = handle.replace(/^@/, "").trim();
  const res = await fetch(`https://${SCRAPER_HOST}/ig_get_fb_profile.php`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "x-rapidapi-host": SCRAPER_HOST, "x-rapidapi-key": apiKey },
    body: new URLSearchParams({ username_or_url: username }).toString(),
  });
  const data = await res.json();
  if (data?.detail || data?.error || data?.message) {
    throw new Error(String(data.detail || data.error || data.message).slice(0, 200));
  }
  // Unwrap likely containers.
  const u = data?.user ?? data?.data?.user ?? data?.graphql?.user ?? data?.data ?? data ?? {};
  return {
    name: strOr(u.full_name, u.fullName, u.name),
    bio: strOr(u.biography, u.bio),
    followerCount: numOr(u.follower_count, u.followers, u.followersCount, u.edge_followed_by),
    followingCount: numOr(u.following_count, u.followings, u.followingCount, u.edge_follow),
    postCount: numOr(u.media_count, u.posts, u.postsCount, u.edge_owner_to_timeline_media),
    profilePicUrl: strOr(u.profile_pic_url_hd, u.profile_pic_url, u.profilePicUrl, u.hd_profile_pic_url_info?.url),
    verified: typeof (u.is_verified ?? u.verified) === "boolean" ? (u.is_verified ?? u.verified) : undefined,
  };
}

// Fetch + persist profile info onto the Competitor row. Best-effort.
export async function scrapeCompetitorProfile(competitorId: number): Promise<{ ok: boolean; error?: string }> {
  const competitor = await prisma.competitor.findUnique({ where: { id: competitorId } });
  if (!competitor) return { ok: false, error: "not found" };
  try {
    const p = await fetchProfileInfo(competitor.handle);
    await prisma.competitor.update({
      where: { id: competitorId },
      data: {
        name: p.name ?? competitor.name,
        bio: p.bio ?? undefined,
        followerCount: p.followerCount ?? competitor.followerCount,
        followingCount: p.followingCount ?? undefined,
        postCount: p.postCount ?? undefined,
        profilePicUrl: p.profilePicUrl ?? undefined,
        verified: p.verified ?? undefined,
        lastProfileSyncAt: new Date(),
      } as any,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err).slice(0, 200) };
  }
}

// ── Scrape one competitor: upsert reels + append a snapshot for each ──
// full=true  → backfill the last ~90 days (paginate deep). Use on first add.
// full=false → just the latest 2-3 pages (new posts + recent updates). Use on cron/refresh.
export async function scrapeCompetitor(
  competitorId: number,
  opts: { full?: boolean } = {}
): Promise<{ ok: boolean; reels: number; error?: string }> {
  const competitor = await prisma.competitor.findUnique({ where: { id: competitorId } });
  if (!competitor) return { ok: false, reels: 0, error: "not found" };

    // full backfill paginates deep; incremental grabs the latest pages.
  const maxPages = opts.full ? 12 : 2;

  try {
    const recent = await fetchReelsFromProvider(competitor.handle, maxPages);

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
