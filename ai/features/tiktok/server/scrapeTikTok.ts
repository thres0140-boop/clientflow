// TikTok scraping via RapidAPI — apibox "Tiktok API" (host tiktok-api23.p.rapidapi.com).
// Public data only. Its posts endpoint keys off a user's `secUid` (not the @handle), so we
// resolve the profile first, then page posts by secUid — that's 1 info call + N post pages,
// which keeps request usage low. Field-walking is defensive since the shape isn't guaranteed.

const HOST = "tiktok-api23.p.rapidapi.com";

function key(): string {
  const k = process.env.RAPIDAPI_KEY;
  if (!k) throw new Error("RAPIDAPI_KEY not set");
  return k;
}
// Accept a bare handle, an @handle, or any TikTok URL (profile or video) and return the username.
export function handleFromInput(input: string): string {
  const s = (input || "").trim();
  const m = s.match(/tiktok\.com\/@?([A-Za-z0-9._]+)/i);
  return (m ? m[1] : s.replace(/^@/, "")).split(/[/?#]/)[0].trim();
}
const clean = (h: string) => handleFromInput(h);
const headers = () => ({ "x-rapidapi-host": HOST, "x-rapidapi-key": key() });

// Some fields come back as string | string[] (playAddr, cover). Take the first usable URL.
function firstUrl(...v: any[]): string | undefined { // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const x of v) {
    if (typeof x === "string" && x.startsWith("http")) return x;
    if (Array.isArray(x)) { const s = x.find((u) => typeof u === "string" && u.startsWith("http")); if (s) return s; }
  }
  return undefined;
}
const num = (...v: any[]): number | undefined => { // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const x of v) { const n = Number(x); if (Number.isFinite(n) && n >= 0) return n; }
  return undefined;
};

export type TikTokProfile = {
  handle: string;
  secUid?: string;       // needed to fetch this user's posts
  nickname?: string;
  bio?: string;
  avatarUrl?: string;
  verified?: boolean;
  followerCount?: number;
  followingCount?: number;
  heartCount?: number;   // total likes
  videoCount?: number;
};

export type TikTokVideo = {
  id: string;
  caption?: string;
  coverUrl?: string;     // thumbnail
  playUrl?: string;      // mp4 — short-lived
  duration?: number;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  createdAt?: Date;
  permalink?: string;
};

export async function fetchTikTokProfile(handle: string): Promise<TikTokProfile | null> {
  const username = clean(handle);
  if (!username) return null;
  const res = await fetch(`https://${HOST}/api/user/info?uniqueId=${encodeURIComponent(username)}`, {
    headers: headers(), signal: AbortSignal.timeout(20000),
  });
  if (res.status === 429) throw new Error("rate_limited"); // over the RapidAPI plan's quota / rate limit
  const data = await res.json().catch(() => null);
  // apibox: data.userInfo.{user,stats}; fall back to other shapes just in case.
  const info = data?.userInfo ?? data?.data?.userInfo ?? data?.data ?? data ?? {};
  const u = info?.user ?? data?.user ?? null;
  const st = info?.stats ?? info?.statsV2 ?? data?.stats ?? {};
  if (!u) return null;
  return {
    handle: u.uniqueId || username,
    secUid: u.secUid || undefined,
    nickname: u.nickname || undefined,
    bio: u.signature || undefined,
    avatarUrl: firstUrl(u.avatarLarger, u.avatarMedium, u.avatarThumb),
    verified: !!u.verified,
    followerCount: num(st.followerCount, st.followers),
    followingCount: num(st.followingCount, st.following),
    heartCount: num(st.heartCount, st.heart, st.likeCount),
    videoCount: num(st.videoCount, st.video),
  };
}

// Map one raw post item to our normalized shape.
function mapVideo(it: any, username: string): TikTokVideo | null { // eslint-disable-line @typescript-eslint/no-explicit-any
  const id = String(it.id ?? it.video_id ?? it.aweme_id ?? "");
  if (!id) return null;
  const st = it.stats ?? it.statsV2 ?? it;
  const vid = it.video ?? {};
  const created = num(it.createTime, it.create_time);
  const author = it.author?.uniqueId || username;
  return {
    id,
    caption: it.desc ?? it.title ?? "",
    coverUrl: firstUrl(vid.cover, vid.originCover, vid.dynamicCover, it.cover),
    playUrl: firstUrl(vid.playAddr, vid.downloadAddr, it.play),
    duration: num(vid.duration, it.duration),
    views: num(st.playCount, st.play_count),
    likes: num(st.diggCount, st.digg_count),
    comments: num(st.commentCount, st.comment_count),
    shares: num(st.shareCount, st.share_count),
    createdAt: created ? new Date(created * 1000) : undefined,
    permalink: `https://www.tiktok.com/@${author}/video/${id}`,
  };
}

// Fetch a user's recent videos by secUid, paginating up to maxPages (cost cap ≈ maxPages requests).
// Pass the secUid from fetchTikTokProfile; `username` is only used to build permalinks.
export async function fetchTikTokVideos(secUid: string, username = "", maxPages = 2): Promise<TikTokVideo[]> {
  if (!secUid) return [];
  const out: TikTokVideo[] = [];
  const seen = new Set<string>();
  let cursor = "0";
  for (let page = 0; page < maxPages; page++) {
    const res = await fetch(`https://${HOST}/api/user/posts?secUid=${encodeURIComponent(secUid)}&count=35&cursor=${cursor}`, {
      headers: headers(), signal: AbortSignal.timeout(25000),
    });
    const data = await res.json().catch(() => null);
    const items: any[] = data?.data?.itemList ?? data?.itemList ?? data?.data?.videos ?? data?.videos ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!items.length) break;
    let added = 0;
    for (const it of items) {
      const v = mapVideo(it, username);
      if (!v || seen.has(v.id)) continue;
      seen.add(v.id); out.push(v); added++;
    }
    const hasMore = data?.data?.hasMore ?? data?.hasMore;
    cursor = String(data?.data?.cursor ?? data?.cursor ?? "");
    if (!hasMore || !cursor || added === 0) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  return out;
}

// Convenience: profile + videos in the fewest calls (1 info + up to maxPages posts).
export async function fetchTikTokProfileAndVideos(handle: string, maxPages = 2): Promise<{ profile: TikTokProfile | null; videos: TikTokVideo[] }> {
  const profile = await fetchTikTokProfile(handle);
  const videos = profile?.secUid ? await fetchTikTokVideos(profile.secUid, profile.handle, maxPages) : [];
  return { profile, videos };
}
