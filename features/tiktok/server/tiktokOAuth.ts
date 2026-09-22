import { prisma } from "@/shared/db/prisma";

// TikTok Login Kit (OAuth) + Display API — first-party: the client authorizes their own account,
// then we read profile stats + videos with the access token. This is the WORKING, non-gated path.
// (The Business/Organic Accounts API — profile views, view time-series — is approval-gated by TikTok
// and needs a separate business-api.tiktok.com app + accepted Accounts API Access Application.)

const AUTH_BASE = "https://www.tiktok.com/v2/auth/authorize/";
const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const USER_URL = "https://open.tiktokapis.com/v2/user/info/";
const VIDEO_URL = "https://open.tiktokapis.com/v2/video/list/";
export const TIKTOK_SCOPES = "user.info.basic,user.info.profile,user.info.stats,video.list";
export const TIKTOK_REDIRECT = "https://www.ordoagency.com/api/auth/tiktok/callback";

function clientKey() { const k = process.env.TIKTOK_CLIENT_KEY; if (!k) throw new Error("TIKTOK_CLIENT_KEY not set"); return k; }
function clientSecret() { const s = process.env.TIKTOK_CLIENT_SECRET; if (!s) throw new Error("TIKTOK_CLIENT_SECRET not set"); return s; }

export function tiktokAuthUrl(state: string): string {
  const p = new URLSearchParams({ client_key: clientKey(), scope: TIKTOK_SCOPES, response_type: "code", redirect_uri: TIKTOK_REDIRECT, state });
  return `${AUTH_BASE}?${p.toString()}`;
}

type TokenResp = { access_token?: string; refresh_token?: string; expires_in?: number; open_id?: string; scope?: string; error?: string; error_description?: string };

export async function exchangeCode(code: string): Promise<TokenResp> {
  const body = new URLSearchParams({ client_key: clientKey(), client_secret: clientSecret(), code, grant_type: "authorization_code", redirect_uri: TIKTOK_REDIRECT });
  const r = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  return r.json();
}

async function refresh(refreshToken: string): Promise<TokenResp> {
  const body = new URLSearchParams({ client_key: clientKey(), client_secret: clientSecret(), grant_type: "refresh_token", refresh_token: refreshToken });
  const r = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  return r.json();
}

export async function saveTokens(clientId: number, t: TokenResp) {
  await (prisma as any).client.update({
    where: { id: clientId },
    data: {
      tiktokAccessToken: t.access_token || null,
      tiktokRefreshToken: t.refresh_token || null,
      tiktokTokenExpiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null,
      tiktokOpenId: t.open_id || undefined,
      tiktokScope: t.scope || undefined,
    },
  });
}

async function validToken(clientId: number): Promise<string | null> {
  const c = await (prisma as any).client.findUnique({ where: { id: clientId }, select: { tiktokAccessToken: true, tiktokRefreshToken: true, tiktokTokenExpiresAt: true } });
  if (!c?.tiktokAccessToken) return null;
  const exp = c.tiktokTokenExpiresAt ? new Date(c.tiktokTokenExpiresAt).getTime() : 0;
  if (exp && Date.now() < exp - 60_000) return c.tiktokAccessToken;
  if (!c.tiktokRefreshToken) return c.tiktokAccessToken;
  const t = await refresh(c.tiktokRefreshToken);
  if (t.access_token) { await saveTokens(clientId, t); return t.access_token; }
  return c.tiktokAccessToken;
}

export type OfficialProfile = {
  openId?: string; displayName?: string; avatarUrl?: string; bio?: string; profileLink?: string; verified?: boolean;
  followerCount?: number; followingCount?: number; likesCount?: number; videoCount?: number;
};
export type OfficialVideo = {
  id: string; title?: string; coverUrl?: string; shareUrl?: string; embedLink?: string;
  views?: number; likes?: number; comments?: number; shares?: number; createdAt?: string; duration?: number;
};

export async function fetchOfficial(clientId: number): Promise<{ connected: boolean; profile: OfficialProfile | null; videos: OfficialVideo[]; error?: string }> {
  const token = await validToken(clientId);
  if (!token) return { connected: false, profile: null, videos: [] };
  const auth = { Authorization: `Bearer ${token}` };

  const uFields = "open_id,avatar_url,display_name,bio_description,profile_deep_link,is_verified,follower_count,following_count,likes_count,video_count";
  const ur = await fetch(`${USER_URL}?fields=${encodeURIComponent(uFields)}`, { headers: auth });
  const uj: any = await ur.json().catch(() => null); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (uj?.error && uj.error.code && uj.error.code !== "ok") return { connected: true, profile: null, videos: [], error: uj.error.code || "user_info_failed" };
  const u = uj?.data?.user ?? {};
  const profile: OfficialProfile = {
    openId: u.open_id, displayName: u.display_name, avatarUrl: u.avatar_url, bio: u.bio_description, profileLink: u.profile_deep_link, verified: !!u.is_verified,
    followerCount: u.follower_count, followingCount: u.following_count, likesCount: u.likes_count, videoCount: u.video_count,
  };

  const vFields = "id,title,cover_image_url,share_url,embed_link,view_count,like_count,comment_count,share_count,create_time,duration";
  const vr = await fetch(`${VIDEO_URL}?fields=${encodeURIComponent(vFields)}`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ max_count: 20 }) });
  const vj: any = await vr.json().catch(() => null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const videos: OfficialVideo[] = (vj?.data?.videos ?? []).map((v: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
    id: String(v.id), title: v.title || undefined, coverUrl: v.cover_image_url || undefined, shareUrl: v.share_url || undefined, embedLink: v.embed_link || undefined,
    views: v.view_count, likes: v.like_count, comments: v.comment_count, shares: v.share_count,
    createdAt: v.create_time ? new Date(v.create_time * 1000).toISOString() : undefined, duration: v.duration,
  }));

  return { connected: true, profile, videos };
}

// Record today's official stats as a daily snapshot (idempotent per client per day) — powers trends.
export async function snapshotOfficial(clientId: number): Promise<boolean> {
  const { connected, profile, videos } = await fetchOfficial(clientId);
  if (!connected || !profile) return false;
  const day = new Date().toISOString().slice(0, 10);
  const totalViews = (videos || []).reduce((s, v) => s + (v.views ?? 0), 0) || null;
  await (prisma as any).tikTokDailySnapshot.upsert({
    where: { clientId_day: { clientId, day } },
    update: { followerCount: profile.followerCount ?? null, followingCount: profile.followingCount ?? null, likesCount: profile.likesCount ?? null, videoCount: profile.videoCount ?? null, totalViews, capturedAt: new Date() },
    create: { clientId, day, followerCount: profile.followerCount ?? null, followingCount: profile.followingCount ?? null, likesCount: profile.likesCount ?? null, videoCount: profile.videoCount ?? null, totalViews },
  }).catch(() => {});
  return true;
}

export async function disconnectTikTok(clientId: number) {
  await (prisma as any).client.update({
    where: { id: clientId },
    data: { tiktokAccessToken: null, tiktokRefreshToken: null, tiktokTokenExpiresAt: null, tiktokOpenId: null, tiktokScope: null },
  });
}
