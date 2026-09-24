import { AI_BASE } from "@/ai/slug";
import { prisma } from "@/ai/db/prisma";
import { cacheImageToR2, isR2Url } from "@/ai/shared/media/r2";

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
// Independent second source for reel mp4s (same RapidAPI key/account). The primary's
// get_media_data endpoint oscillates provider-side; this one resolves reliably, so it's the
// primary source for playback/transcription capture, with the old scraper as fallback.
const BACKUP_HOST = "instagram120.p.rapidapi.com";

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

// Deep-search an object for the first Instagram CDN video URL. The detailed-reel
// response shape isn't documented, so we walk it and pick a .mp4/video_versions url.
function findVideoUrl(obj: any, depth = 0): string | null {
  if (!obj || depth > 6) return null;
  if (typeof obj === "string") {
    return /\.mp4|video_dash|video_versions/.test(obj) && obj.startsWith("http") ? obj : null;
  }
  if (Array.isArray(obj)) {
    for (const v of obj) { const r = findVideoUrl(v, depth + 1); if (r) return r; }
    return null;
  }
  if (typeof obj === "object") {
    // Prefer explicit video fields first.
    const vv = obj.video_versions ?? obj.videoVersions;
    if (Array.isArray(vv) && vv[0]?.url) return vv[0].url as string;
    for (const k of ["video_url", "videoUrl", "play_url", "playback_url"]) {
      if (typeof obj[k] === "string" && obj[k].startsWith("http")) return obj[k];
    }
    for (const v of Object.values(obj)) { const r = findVideoUrl(v, depth + 1); if (r) return r; }
  }
  return null;
}

// Hit the RapidAPI single-media endpoint for one reel and pull its fresh .mp4 CDN url.
// The endpoint wants `type=post` for most reels (some only resolve under `type=reel`), so we
// try both. Returns null on any provider error so the caller can fall back.
async function apiMediaUrl(shortcode: string): Promise<string | null> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) return null;
  const url = `https://www.instagram.com/reel/${shortcode}/`;
  // This is only the FALLBACK now (the backup provider is primary), and it oscillates, so keep
  // it cheap: two quick attempts (post, then reel) with a hard timeout so a bad window can't
  // stall a whole capture batch.
  for (const type of ["post", "reel"]) {
    try {
      const qs = new URLSearchParams({ reel_post_code_or_url: url, type });
      const res = await fetch(`https://${SCRAPER_HOST}/get_media_data.php?${qs.toString()}`, {
        headers: { "x-rapidapi-host": SCRAPER_HOST, "x-rapidapi-key": apiKey },
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json();
      if (data?.detail || data?.error || data?.message) continue; // e.g. "not found" — retry
      const found = findVideoUrl(data);
      if (found) return found;
    } catch { /* transient — retry */ }
  }
  return null;
}

// Resolve a reel's mp4 via the reliable backup provider (instagram120). Its response is
// [ { urls: [ { url: "…mp4…" } ], ... } ] — a plain list of download links.
async function apiMediaUrlBackup(shortcode: string): Promise<string | null> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(`https://${BACKUP_HOST}${AI_BASE}/api/instagram/mediaByShortcode`, {
      method: "POST",
      headers: { "x-rapidapi-host": BACKUP_HOST, "x-rapidapi-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ shortcode }),
      signal: AbortSignal.timeout(12000),
    });
    const data = await res.json();
    const arr = Array.isArray(data) ? data : data ? [data] : [];
    for (const item of arr) {
      const urls = item?.urls;
      if (Array.isArray(urls)) {
        for (const u of urls) {
          if (typeof u?.url === "string" && /\.mp4/.test(u.url) && u.url.startsWith("http")) return u.url;
        }
      }
    }
    return findVideoUrl(data); // generic fallback if the shape shifts
  } catch { return null; }
}

// Re-fetch a fresh, currently-playable mp4 URL for one reel. Tries the reliable backup
// provider first, then the flaky primary scraper, then the IG embed scrape as last resort.
// IG CDN links expire, so the result is downloaded to R2 by the caller (capture-once) — this
// only needs to succeed ONCE per reel, after which nothing calls a provider for it again.
export async function freshReelMediaUrl(handle: string, shortcode: string): Promise<string | null> {
  if (!shortcode) return null;
  const fromBackup = await apiMediaUrlBackup(shortcode);
  if (fromBackup) return fromBackup;
  return await apiMediaUrl(shortcode);
}

// Fetch reels (newest first), following pagination tokens up to `maxPages`
// (a cost cap). We don't date-filter — we store whatever the account has.
export async function fetchReelsFromProvider(handle: string, maxPages: number): Promise<ScrapedReel[]> {
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
  opts: { full?: boolean; pages?: number } = {}
): Promise<{ ok: boolean; reels: number; error?: string }> {
  const competitor = await prisma.competitor.findUnique({ where: { id: competitorId } });
  if (!competitor) return { ok: false, reels: 0, error: "not found" };

    // full backfill paginates deep; incremental grabs the latest pages. The provider caps each
    // page at ~12 reels (1 API call/page), so 5 pages ≈ 60 reels. `pages` overrides this — a
    // daily "top-up" uses 1 page (newest ~12) to catch new posts + refresh recent stats cheaply.
  const maxPages = opts.pages ?? (opts.full ? 12 : 5);

  try {
    const recent = await fetchReelsFromProvider(competitor.handle, maxPages);

    // Reels whose thumbnail still points at an (expiring) Instagram CDN URL — we'll
    // download + rehost these to R2 below so the archive doesn't rot into broken images.
    const toCache: { reelId: number; shortcode: string; igUrl: string }[] = [];
    // Newest reels we don't yet own the video for — we'll save them to R2 in this same pass
    // (resolving the mp4 inline) so the recent reels are playable immediately, not stuck in the
    // rate-limited capture queue. The list endpoint rarely carries the video URL, so we resolve
    // per-reel when needed, but only for the newest few (bounded cost).
    const toCacheVideo: { reelId: number; shortcode: string; listUrl?: string }[] = [];

    let count = 0;
    for (const r of recent) {
      const reel = await (prisma as any).competitorReel.upsert({
        where: { competitorId_shortcode: { competitorId, shortcode: r.shortcode } },
        update: {
          caption: r.caption || undefined,
          // NOTE: don't overwrite thumbnailUrl here — once cached to R2 it must stay the
          // durable R2 URL. Fresh IG thumbnails are handled by the caching pass below.
          mediaUrl: r.mediaUrl || undefined,
          mediaUrlAt: r.mediaUrl ? new Date() : undefined,
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
          mediaUrlAt: r.mediaUrl ? new Date() : null,
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
      // Queue thumbnail caching if we don't already have a durable (R2) one.
      const igUrl = r.thumbnailUrl || reel.thumbnailUrl;
      if (igUrl && !isR2Url(reel.thumbnailUrl)) {
        toCache.push({ reelId: reel.id, shortcode: r.shortcode, igUrl });
      }
      // Queue video caching if we don't already own the mp4 (newest-first order preserved).
      if (!isR2Url(reel.cachedVideoUrl)) {
        toCacheVideo.push({ reelId: reel.id, shortcode: r.shortcode, listUrl: r.mediaUrl || undefined });
      }
      count++;
    }

    // Rehost thumbnails to R2 (small concurrency; cap per run so a big backfill can't
    // time out — any leftovers get picked up on the next refresh while still fresh).
    const CONCURRENCY = 8;
    const queue = toCache.slice(0, 400);
    for (let i = 0; i < queue.length; i += CONCURRENCY) {
      await Promise.all(queue.slice(i, i + CONCURRENCY).map(async (t) => {
        const url = await cacheImageToR2(t.igUrl, `comp-thumbs/${competitorId}/${t.shortcode}.jpg`);
        if (url) {
          await (prisma as any).competitorReel.update({ where: { id: t.reelId }, data: { thumbnailUrl: url } }).catch(() => {});
        }
      }));
    }

    // Save the NEWEST reels' videos to R2 immediately so they're playable the moment they show
    // up. Resolve the mp4 inline when the list didn't carry it. SEQUENTIAL + paced so we don't
    // trip the vendor's rate limit; capped to the newest ~6. The rest fill via the capture cron.
    const vidQueue = toCacheVideo.slice(0, 6);
    for (const t of vidQueue) {
      try {
        const src = t.listUrl || await freshReelMediaUrl(competitor.handle, t.shortcode);
        if (src) {
          const url = await cacheImageToR2(src, `comp-videos/${t.reelId}.mp4`);
          if (url) await (prisma as any).competitorReel.update({ where: { id: t.reelId }, data: { cachedVideoUrl: url, captureStatus: "pending" } }).catch(() => {});
        }
      } catch { /* leftover picked up by the capture cron */ }
      await new Promise((res) => setTimeout(res, 250));
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
