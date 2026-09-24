import { prisma } from "@/ai/db/prisma";

// TikTok organic analytics via Zernio (https://zernio.com) — the SAME third-party platform ORDO
// already uses for Instagram. Zernio holds TikTok's approved API access, so once a client's TikTok
// account is connected in Zernio and linked to the client, we read their organic analytics here.
//
// IMPORTANT DATA LIMIT (from TikTok's own public API, per Zernio docs): the deep TikTok Studio
// metrics — profile_views, traffic/impression sources, watch time, audience demographics, follower
// inflow/outflow — are NOT available on any public TikTok API (not even the Business API). We surface
// everything that IS available: video views/likes/comments/shares per post, and account-level
// follower_count / likes_count / video_count time series.
//
// Endpoints (Analytics add-on required on the Zernio plan):
//   GET /v1/analytics?platform=tiktok&accountId=&profileId=&limit=          → per-post metrics
//   GET /v1/analytics/tiktok/account-insights?accountId=&metricType=time_series&metrics=&since=&until=
//        → account counter time series (follower_count, likes_count, video_count, following_count)

const ZERNIO_BASE = `https://zernio.com/api/v1`;
const ZERNIO_KEY  = process.env.ZERNIO_API_KEY!;
const PROFILE_ID  = process.env.AI_ZERNIO_PROFILE_ID!;

const authHeaders = { Authorization: `Bearer ${ZERNIO_KEY}`, Accept: "application/json" };

export type TikTokVideo = {
  id: string;
  content?: string;
  thumbnailUrl?: string;
  postUrl?: string;
  publishedAt?: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  engagementRate?: number;
};

export type SeriesPoint = { date: string; value: number };
export type Delta = { d: number; pct: number } | null;
export type HistoryPoint = { day: string; totalViews: number | null; followerCount: number | null; likesCount: number | null };
// Per-day DELIVERED metrics (attribution=received) — the "views delivered per day" TikTok Studio shows.
export type DailyMetric = { date: string; views: number; likes: number; comments: number; shares: number };

export type TikTokZernioData = {
  connected: boolean;
  username?: string | null;
  days: number;
  profile: {
    followers: number | null;
    following: number | null;
    likes: number | null;   // cumulative account likes
    videos: number | null;
  };
  deltas: { followers: Delta; likes: Delta };
  series: { followers: SeriesPoint[]; likes: SeriesPoint[]; videoViews: SeriesPoint[] };
  totals: { views: number; likes: number; comments: number; shares: number; posts: number; engagementRate: number | null };
  // Daily snapshots ORDO records itself (cumulative totals) — diffed client-side into per-day views.
  history: HistoryPoint[];
  // Zernio's own per-day DELIVERED metrics (matches its "Engagement over time" dashboard).
  daily: DailyMetric[];
  videos: TikTokVideo[];
  error?: string;
};

function num(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function ymd(d: Date) { return d.toISOString().slice(0, 10); }

function metricsFor(post: any, accountId: string): any {
  const plats: any[] = post?.platforms ?? [];
  const match = plats.find((p) => p?.platform === "tiktok" && (p?.accountId === accountId || !accountId))
    ?? plats.find((p) => p?.platform === "tiktok");
  return match?.analytics ?? post?.analytics ?? {};
}

// Delta between first and last point of a time series.
function seriesDelta(pts: SeriesPoint[]): Delta {
  const vals = pts.map((p) => p.value).filter((n) => Number.isFinite(n));
  if (vals.length < 2) return null;
  const d = vals[vals.length - 1] - vals[0];
  return { d, pct: vals[0] ? (d / vals[0]) * 100 : 0 };
}

export async function fetchTikTokZernio(clientId: number, days = 30): Promise<TikTokZernioData> {
  const empty: TikTokZernioData = {
    connected: false, days,
    profile: { followers: null, following: null, likes: null, videos: null },
    deltas: { followers: null, likes: null },
    series: { followers: [], likes: [], videoViews: [] },
    totals: { views: 0, likes: 0, comments: 0, shares: 0, posts: 0, engagementRate: null },
    history: [],
    daily: [],
    videos: [],
  };

  const client = await (prisma as any).client.findUnique({
    where: { id: clientId },
    select: { tiktokZernioAccountId: true, tiktokZernioUsername: true, tiktokZernioProfileId: true },
  });
  const accountId: string | null = client?.tiktokZernioAccountId ?? null;
  if (!accountId) return empty;

  const profileId = client?.tiktokZernioProfileId || PROFILE_ID;
  const until = ymd(new Date());
  // Account-insights (follower/likes series) is capped at 88 days by Zernio; clamp so it never errors.
  const insightsDays = Math.min(88, Math.max(1, days));
  const since = ymd(new Date(Date.now() - insightsDays * 86400_000));
  let apiError: string | undefined;

  // 1. Account-level counter time series (follower/likes/video counts).
  let followers: number | null = null, following: number | null = null, likes: number | null = null, videosCount: number | null = null;
  let fSeries: SeriesPoint[] = [], lSeries: SeriesPoint[] = [];
  try {
    const iUrl = new URL(`${ZERNIO_BASE}/analytics/tiktok/account-insights`);
    iUrl.searchParams.set("accountId", accountId);
    iUrl.searchParams.set("metricType", "time_series");
    iUrl.searchParams.set("metrics", "follower_count,likes_count,video_count,following_count");
    iUrl.searchParams.set("since", since);
    iUrl.searchParams.set("until", until);
    const r = await fetch(iUrl.toString(), { headers: authHeaders });
    const j: any = await r.json().catch(() => null);
    if (!r.ok) { apiError = j?.error || j?.message || `insights_${r.status}`; }
    else {
      const m = j?.metrics ?? {};
      const pick = (k: string): SeriesPoint[] => (m?.[k]?.values ?? []).map((v: any) => ({ date: String(v.date), value: num(v.value) }));
      const total = (k: string): number | null => (m?.[k]?.total != null ? num(m[k].total) : (pick(k).at(-1)?.value ?? null));
      fSeries = pick("follower_count"); lSeries = pick("likes_count");
      followers = total("follower_count"); likes = total("likes_count"); videosCount = total("video_count"); following = total("following_count");
    }
  } catch (e) { apiError = e instanceof Error ? e.message : "insights_failed"; }

  // 2. Per-post analytics.
  let videos: TikTokVideo[] = [];
  try {
    const aUrl = new URL(`${ZERNIO_BASE}/analytics`);
    aUrl.searchParams.set("platform", "tiktok");
    aUrl.searchParams.set("accountId", accountId);
    aUrl.searchParams.set("profileId", profileId);
    aUrl.searchParams.set("limit", "100");
    aUrl.searchParams.set("sortBy", "date");
    aUrl.searchParams.set("order", "desc");
    aUrl.searchParams.set("fromDate", ymd(new Date(Date.now() - 365 * 86400_000))); // up to a year of posts for custom ranges
    const r = await fetch(aUrl.toString(), { headers: authHeaders });
    const j: any = await r.json().catch(() => null);
    if (!r.ok) { apiError = apiError || j?.error || j?.message || `analytics_${r.status}`; }
    else {
      const posts: any[] = j?.posts ?? j?.data ?? [];
      videos = posts.map((p) => {
        const m = metricsFor(p, accountId);
        const plat = (p?.platforms ?? []).find((x: any) => x?.platform === "tiktok");
        return {
          id: String(p?._id ?? p?.id ?? ""),
          content: p?.content || undefined,
          thumbnailUrl: p?.thumbnailUrl || p?.thumbnail || undefined,
          postUrl: p?.platformPostUrl || plat?.platformPostUrl || undefined,
          publishedAt: p?.publishedAt || p?.scheduledFor || undefined,
          views: num(m.views), likes: num(m.likes), comments: num(m.comments), shares: num(m.shares),
          engagementRate: m.engagementRate != null ? num(m.engagementRate) : undefined,
        };
      });
    }
  } catch (e) { apiError = apiError || (e instanceof Error ? e.message : "analytics_failed"); }

  // Per-day DELIVERED metrics (attribution=received) — Zernio's "Engagement over time". This is the
  // real views-delivered-per-day (like TikTok Studio), not lifetime views bucketed by post date.
  let daily: DailyMetric[] = [];
  try {
    const dUrl = new URL(`${ZERNIO_BASE}/analytics/daily-metrics`);
    dUrl.searchParams.set("platform", "tiktok");
    dUrl.searchParams.set("accountId", accountId);
    dUrl.searchParams.set("profileId", profileId);
    dUrl.searchParams.set("attribution", "received");
    dUrl.searchParams.set("fromDate", new Date(Date.now() - 180 * 86400_000).toISOString());
    dUrl.searchParams.set("toDate", new Date().toISOString());
    const r = await fetch(dUrl.toString(), { headers: authHeaders });
    const j: any = await r.json().catch(() => null);
    if (r.ok && j?.dailyData) {
      daily = (j.dailyData as any[]).map((d) => ({
        date: String(d.date).slice(0, 10),
        views: num(d?.metrics?.views), likes: num(d?.metrics?.likes),
        comments: num(d?.metrics?.comments), shares: num(d?.metrics?.shares),
      })).sort((a, b) => a.date.localeCompare(b.date));
    } else if (!r.ok) { apiError = apiError || j?.error || j?.message || `daily_${r.status}`; }
  } catch (e) { apiError = apiError || (e instanceof Error ? e.message : "daily_failed"); }

  // Fallback: if account-insights gave no followers, use follower-stats.
  if (followers == null) {
    try {
      const fUrl = new URL(`${ZERNIO_BASE}/accounts/follower-stats`);
      fUrl.searchParams.set("accountIds", accountId);
      fUrl.searchParams.set("profileId", profileId);
      fUrl.searchParams.set("granularity", "daily");
      const r = await fetch(fUrl.toString(), { headers: authHeaders });
      const j: any = await r.json().catch(() => null);
      if (r.ok && j) {
        const acc = (j.accounts ?? [])[0];
        if (acc?.currentFollowers != null) followers = num(acc.currentFollowers);
        const series: any[] = j.stats?.[accountId] ?? [];
        if (series.length) fSeries = series.map((s) => ({ date: String(s.date), value: num(s.followers) }));
      }
    } catch { /* optional */ }
  }

  // Totals from posts (video views / comments / shares have no account-level series available).
  const totals = videos.reduce(
    (t, v) => { t.views += v.views; t.likes += v.likes; t.comments += v.comments; t.shares += v.shares; return t; },
    { views: 0, likes: 0, comments: 0, shares: 0 }
  );
  const engRates = videos.map((v) => v.engagementRate).filter((x): x is number => x != null);
  const avgEng = engRates.length ? engRates.reduce((a, b) => a + b, 0) / engRates.length : null;

  // Record today's cumulative totals so we can chart REAL per-day video views over time. TikTok's API
  // has no per-day views series, so we snapshot the running total daily and diff it client-side.
  const today = ymd(new Date());
  await (prisma as any).tikTokDailySnapshot.upsert({
    where: { clientId_day: { clientId, day: today } },
    update: { totalViews: totals.views || null, followerCount: followers, likesCount: likes, videoCount: videosCount, capturedAt: new Date() },
    create: { clientId, day: today, totalViews: totals.views || null, followerCount: followers, likesCount: likes, videoCount: videosCount },
  }).catch(() => {});
  const snaps: any[] = await (prisma as any).tikTokDailySnapshot.findMany({
    where: { clientId }, orderBy: { day: "asc" }, take: 120,
    select: { day: true, totalViews: true, followerCount: true, likesCount: true },
  }).catch(() => []);
  const history: HistoryPoint[] = snaps.map((s) => ({ day: s.day, totalViews: s.totalViews, followerCount: s.followerCount, likesCount: s.likesCount }));

  return {
    connected: true,
    username: client?.tiktokZernioUsername ?? null,
    days,
    profile: { followers, following, likes, videos: videosCount },
    deltas: { followers: seriesDelta(fSeries), likes: seriesDelta(lSeries) },
    series: { followers: fSeries, likes: lSeries, videoViews: [] },
    totals: { ...totals, posts: videos.length, engagementRate: avgEng },
    history,
    daily,
    videos,
    error: apiError,
  };
}
