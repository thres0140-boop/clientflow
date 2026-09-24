"use client";
import { AI_API } from "@/ai/slug";
import { imgSrc } from "@/shared/media/videoSrc";
import { useState, useEffect, useCallback, useRef } from "react";
import { Client } from "@/ai/shared/types";

// TikTok Studio — analytics (own profile) + competitor research. Public scraping via RapidAPI
// (tiktok-scraper7), no TikTok login. Mirrors the Instagram side but on the separate TikTok data.

type Props = {
  clients: Client[];
  selectedClientId: number | null;
  refreshClients?: () => void;
  embedded?: boolean;
  view?: "profile" | "competitors";
};

type TTProfile = {
  handle: string; nickname?: string; bio?: string; avatarUrl?: string; verified?: boolean;
  followerCount?: number; followingCount?: number; heartCount?: number; videoCount?: number;
};
type TTVideo = {
  id: string; caption?: string; coverUrl?: string; playUrl?: string; duration?: number;
  views?: number; likes?: number; comments?: number; shares?: number; createdAt?: string; permalink?: string;
};
type CompReel = {
  id: string; videoId?: string; handle?: string; caption: string; thumbnail_url?: string; media_url?: string;
  permalink?: string; timestamp: string; plays?: number; like_count: number; comments_count: number;
};
type Competitor = {
  id: number; handle: string; name?: string | null; bio?: string | null;
  followerCount?: number | null; followingCount?: number | null; postCount?: number | null;
  profilePicUrl?: string | null; verified?: boolean | null; tags?: string | null;
  lastScrapedAt?: string | null;
};
type SyncState = "pending" | "syncing" | "done" | "nodata" | "error";

function fmt(n?: number) {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}
// Pull the numeric TikTok video id from a permalink (…/video/12345…) or a fallback id.
function videoIdFrom(permalink?: string, fallback?: string): string | null {
  const m = (permalink || "").match(/\/video\/(\d+)/) || (permalink || "").match(/\/photo\/(\d+)/);
  if (m) return m[1];
  if (fallback && /^\d+$/.test(fallback)) return fallback;
  return null;
}

// Plays a TikTok post IN PLACE, filling its parent tile (put it inside a `relative` tile). Prefers
// the actual mp4 (via our /api/vid proxy) for clean playback; falls back to TikTok's own embed for
// photo/slideshow posts or when the scraped mp4 URL has expired. Never navigates away.
function InlineTikTokPlayer({ videoId, mediaUrl, onClose }: { videoId?: string; mediaUrl?: string; onClose: () => void }) {
  const [useEmbed, setUseEmbed] = useState(!mediaUrl);
  return (
    <div className="absolute inset-0 z-30 bg-black" onClick={(e) => e.stopPropagation()}>
      <button onClick={onClose} title="Close" className="absolute top-1.5 right-1.5 z-40 w-6 h-6 rounded-full bg-black/60 text-white text-sm flex items-center justify-center hover:bg-black/80">×</button>
      {!useEmbed && mediaUrl ? (
        <video
          src={`/api/vid?u=${encodeURIComponent(mediaUrl)}`}
          className="w-full h-full object-cover bg-black"
          autoPlay controls loop playsInline
          onError={() => (videoId ? setUseEmbed(true) : onClose())}
        />
      ) : videoId ? (
        <iframe
          src={`https://www.tiktok.com/embed/v2/${videoId}`}
          className="w-full h-full border-0 bg-black"
          allow="autoplay; encrypted-media; fullscreen"
          title="TikTok video" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-white/70 text-xs">Unavailable</div>
      )}
    </div>
  );
}

// Accept a bare handle, @handle, or any TikTok URL and return the username.
function parseHandle(input: string): string {
  const s = (input || "").trim();
  const m = s.match(/tiktok\.com\/@?([A-Za-z0-9._]+)/i);
  return (m ? m[1] : s.replace(/^@/, "")).split(/[/?#]/)[0].trim();
}
function timeAgo(ms: number) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return mo < 12 ? `${mo}mo ago` : `${Math.floor(mo / 12)}y ago`;
}
function gridProps(embedded?: boolean, extra = ""): { className: string; style?: React.CSSProperties } {
  return embedded
    ? { className: `grid ${extra}`.trim(), style: { gridTemplateColumns: "repeat(auto-fill, minmax(max(150px, 23%), 1fr))" } }
    : { className: `grid grid-cols-4 ${extra}`.trim() };
}

export default function TikTokPage({ clients, selectedClientId, refreshClients, embedded, view = "profile" }: Props) {
  const client = clients.find((c) => c.id === selectedClientId) ?? null;

  if (!client) {
    return <div className="flex items-center justify-center h-64 text-faint text-sm">Select a client to view their TikTok</div>;
  }

  // Profile and Competitors are separate sidebar destinations for TikTok (Competitors is its own
  // nav item in the TikTok folder), so each renders on its own — no in-page sub-tabs.
  return (
    <div className="space-y-5">
      {view === "competitors"
        ? <CompetitorsTab client={client} embedded={embedded} />
        : <ProfileTab client={client} refreshClients={refreshClients} embedded={embedded} />}
    </div>
  );
}

// ─── Own profile analytics ──────────────────────────────────────────────────
function ProfileTab({ client, refreshClients, embedded }: { client: Client; refreshClients?: () => void; embedded?: boolean }) {
  const [handle, setHandle] = useState<string>((client as any).tiktokHandle || "");
  const [profile, setProfile] = useState<TTProfile | null>(null);
  const [videos, setVideos] = useState<TTVideo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  // TikTok connection through Zernio — the SAME mechanism as Instagram. Connection state lives on
  // the client row (tiktokZernioAccountId/Username); the account picker + link happen inline here.
  const [ttUsername, setTtUsername] = useState<string | null>((client as any).tiktokZernioUsername ?? null);
  const [ttLinked, setTtLinked] = useState<boolean>(!!(client as any).tiktokZernioAccountId);
  const [ttAccounts, setTtAccounts] = useState<any[]>([]); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [ttPicker, setTtPicker] = useState(false);
  const [ttBusy, setTtBusy] = useState(false);

  async function openTikTokPicker() {
    setTtBusy(true); setTtPicker(true);
    try {
      // List TikTok accounts across ALL Zernio profiles — a client's account may live under its
      // own profile, not the agency default.
      const res = await fetch(`${AI_API}/zernio/accounts?platform=tiktok&profileId=all`);
      const data = await res.json();
      if (!res.ok) { alert("Zernio error: " + (data?.error ?? res.status)); setTtPicker(false); setTtBusy(false); return; }
      const raw = Array.isArray(data) ? data : Array.isArray(data.accounts) ? data.accounts : Array.isArray(data.data) ? data.data : [];
      const list = raw.filter((a: any) => !a.platform || a.platform === "tiktok"); // eslint-disable-line @typescript-eslint/no-explicit-any
      setTtAccounts(list);
    } catch (e) { alert("Network error: " + String(e)); setTtPicker(false); }
    setTtBusy(false);
  }
  async function linkTikTokAccount(acc: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
    const accountId = acc._id ?? acc.id;
    const username = acc.username ?? acc.displayName ?? acc.name ?? null;
    // Capture the account's OWN Zernio profile id (analytics/follower-stats are queried per profile).
    const zernioProfileId = (typeof acc.profileId === "object" ? acc.profileId?._id : acc.profileId) || undefined;
    const res = await fetch(`${AI_API}/zernio/tiktok-link`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: client.id, zernioAccountId: accountId, username, zernioProfileId }) });
    if (!res.ok) { const err = await res.json().catch(() => ({})); alert("Failed to link: " + (err?.error ?? res.status)); return; }
    (client as any).tiktokZernioAccountId = accountId; (client as any).tiktokZernioUsername = username;
    setTtLinked(true); setTtUsername(username); setTtPicker(false); setTtAccounts([]);
    // Auto-derive the scrape handle from the connected account so the visual profile grid loads,
    // without the user ever typing a handle. Connection is the single source of truth.
    const derived = parseHandle(username || "");
    if (derived && derived !== handle) {
      try {
        await fetch(`${AI_API}/tiktok/profile`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: client.id, handle: derived }) });
        (client as any).tiktokHandle = derived;
        setHandle(derived);
        load(true);
      } catch { /* grid will still load on next open */ }
    }
    refreshClients?.();
  }
  async function disconnectTikTokZernio() {
    if (!confirm("Disconnect this client's TikTok? Analytics and the profile grid will clear.")) return;
    await fetch(`${AI_API}/zernio/tiktok-link`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: client.id }) });
    await fetch(`${AI_API}/tiktok/profile`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: client.id, handle: "" }) }).catch(() => {});
    (client as any).tiktokZernioAccountId = null; (client as any).tiktokZernioUsername = null; (client as any).tiktokHandle = "";
    setTtLinked(false); setTtUsername(null); setHandle(""); setProfile(null); setVideos([]);
    refreshClients?.();
  }

  const connectBanner = ttLinked ? (
    <div className="bg-surface rounded-xl border border-line px-4 py-3 flex items-center gap-3 flex-wrap">
      <span className="text-xs font-semibold text-ok-700 bg-ok-50 px-2 py-1 rounded-full">✓ TikTok connected via Zernio</span>
      {ttUsername && <span className="text-xs text-muted">@{ttUsername}</span>}
      <span className="text-xs text-faint">— follower growth, video &amp; profile views show in the Analytics tab.</span>
      <button onClick={disconnectTikTokZernio} className="ml-auto text-xs text-faint hover:text-danger-500">Disconnect</button>
    </div>
  ) : ttPicker ? (
    <div className="bg-surface rounded-xl border border-line px-4 py-3">
      <p className="text-xs font-semibold text-ink-2 mb-2">Pick this client&apos;s TikTok account (connected in Zernio):</p>
      {ttBusy ? <p className="text-xs text-faint">Loading accounts…</p>
        : ttAccounts.length === 0 ? <p className="text-xs text-faint">No TikTok accounts found in Zernio. Connect the account in Zernio first, then try again.</p>
        : <div className="space-y-1.5">
            {ttAccounts.map((acc: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
              const id = acc._id ?? acc.id; const uname = acc.username ?? acc.displayName ?? acc.name ?? id;
              return <button key={id} onClick={() => linkTikTokAccount(acc)} className="w-full text-left px-3 py-2 bg-surface border border-line rounded-lg text-xs hover:bg-accent-tint hover:border-accent transition-colors"><span className="font-semibold">@{uname}</span><span className="text-faint ml-2">{id}</span></button>;
            })}
          </div>}
      <button onClick={() => { setTtPicker(false); setTtAccounts([]); }} className="text-[10px] text-faint hover:text-ink-2 mt-2">Cancel</button>
    </div>
  ) : (
    <div className="bg-black text-white rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
      <span className="text-sm">🎵 Connect this client&apos;s TikTok via <b>Zernio</b> for official analytics — follower growth, video &amp; profile views, per-video stats.</span>
      <button onClick={openTikTokPicker} className="ml-auto px-3 py-1.5 bg-surface text-ink text-xs font-semibold rounded-lg hover:opacity-90">Connect TikTok</button>
    </div>
  );

  const load = useCallback(async (force = false) => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${AI_API}/tiktok/profile?clientId=${client.id}${force ? "&force=1" : ""}`);
      const data = await res.json();
      if (data.error === "no_handle") { setProfile(null); setVideos([]); }
      else if (data.error) { setError(data.error); setProfile(data.profile); setVideos(data.videos || []); }
      else { setProfile(data.profile); setVideos(data.videos || []); setUpdatedAt(data.cachedAt || Date.now()); }
    } catch { setError("scrape_failed"); }
    setLoading(false);
  }, [client.id]);

  useEffect(() => {
    const h = (client as any).tiktokHandle || "";
    setHandle(h); setProfile(null); setVideos([]); setError(null);
    // Only load the scraped profile grid when the account is actually connected via Zernio —
    // a leftover handle alone must NOT make the page look connected.
    if (h && (client as any).tiktokZernioAccountId) load();
  }, [client.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ttLinked) {
    return (
      <div className="space-y-4">
      {connectBanner}
      <div className="bg-surface rounded-2xl border border-line p-16 flex flex-col items-center text-center gap-5">
        <div className="w-16 h-16 rounded-2xl bg-black flex items-center justify-center text-2xl o-elev-lift">🎵</div>
        <div>
          <h2 className="text-lg font-bold text-ink mb-1">Connect {client.name}&apos;s TikTok</h2>
          <p className="text-sm text-muted max-w-sm">Hit <b>Connect TikTok</b> above to link their account through Zernio — the same way Instagram connects. Their profile, videos and analytics all flow from that one connection.</p>
        </div>
        {!ttPicker && (
          <button onClick={openTikTokPicker} className="px-5 py-2.5 bg-black text-white text-sm font-semibold rounded-lg hover:opacity-90">🎵 Connect TikTok</button>
        )}
      </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {connectBanner}
      {/* Profile header */}
      <div className="bg-surface rounded-2xl border border-line px-6 py-5 flex items-center gap-6">
        {profile?.avatarUrl
          ? <img src={imgSrc(profile.avatarUrl)} alt="" className="w-16 h-16 rounded-full object-cover flex-shrink-0 shadow" />
          : <div className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold text-white flex-shrink-0 shadow bg-black">🎵</div>}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h2 className="text-base font-bold text-ink">@{profile?.handle || handle}</h2>
            {profile?.verified && <span className="text-[10px] bg-info-100 text-info-600 font-semibold px-1.5 py-0.5 rounded-full">Verified</span>}
          </div>
          <p className="text-xs text-faint line-clamp-1">{profile?.nickname || profile?.bio || client.name}</p>
        </div>
        <div className="flex gap-6 flex-shrink-0">
          {[
            { label: "Videos", value: profile?.videoCount ?? videos.length },
            { label: "Followers", value: fmt(profile?.followerCount) },
            { label: "Likes", value: fmt(profile?.heartCount) },
          ].map(({ label, value }) => (
            <div key={label} className="text-center">
              <p className="text-base font-bold text-ink">{loading && !profile ? "…" : (typeof value === "number" ? fmt(value) : value)}</p>
              <p className="text-xs text-faint">{label}</p>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="text-right">
            <button onClick={() => load(true)} disabled={loading} className="text-xs px-3 py-1.5 rounded-lg bg-surface-3 text-muted hover:text-ink-2 disabled:opacity-50">
              {loading ? "Refreshing…" : "↻ Refresh"}
            </button>
            {updatedAt && <p className="text-[10px] text-faint mt-1">Updated {timeAgo(updatedAt)}</p>}
          </div>
          <a href={`https://www.tiktok.com/@${handle}`} target="_blank" rel="noreferrer" className="text-xs text-faint hover:text-accent">Open ↗</a>
        </div>
      </div>

      {error === "not_found"
        ? <div className="bg-warn-50 border border-warn-200 rounded-xl p-8 text-center text-warn-700 text-sm">Couldn't find <b>@{handle}</b>. Check the handle is correct and public.</div>
        : error
        ? <div className="bg-warn-50 border border-warn-200 rounded-xl p-6 text-center text-warn-700 text-sm">
            Couldn't load TikTok data ({error}). Make sure the RapidAPI TikTok scraper is subscribed.
          </div>
        : loading && videos.length === 0
        ? <div className="flex items-center justify-center h-40 text-faint text-sm">Loading videos…</div>
        : videos.length > 0
        ? <VideoGrid videos={videos} embedded={embedded} />
        : <div className="text-center py-16 text-faint text-sm">No videos found.</div>}
    </div>
  );
}

// ─── Own-profile video grid ───────────────────────────────────────────────────
function VideoGrid({ videos, embedded }: { videos: TTVideo[]; embedded?: boolean }) {
  const [sort, setSort] = useState<"recent" | "best">("recent");
  const [playingId, setPlayingId] = useState<string | null>(null); // only one tile plays at a time
  const sorted = [...videos].sort((a, b) =>
    sort === "best" ? (b.views ?? 0) - (a.views ?? 0)
      : new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
  return (
    <div className="space-y-3">
      <div className="flex gap-1 w-fit">
        {([["recent", "Recent"], ["best", "Top views"]] as [typeof sort, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setSort(id)}
            className={`px-3 py-1 rounded-lg text-xs font-medium ${sort === id ? "bg-accent text-on-accent" : "bg-surface border border-line text-muted"}`}>{label}</button>
        ))}
      </div>
      <div {...gridProps(embedded, "gap-1.5")}>
        {sorted.map((v) => <VideoTile key={v.id} v={v} playing={playingId === v.id} onOpen={() => setPlayingId(v.id)} onClose={() => setPlayingId(null)} />)}
      </div>
    </div>
  );
}

function VideoTile({ v, playing, onOpen, onClose }: { v: TTVideo; playing: boolean; onOpen: () => void; onClose: () => void }) {
  const vid = videoIdFrom(v.permalink, v.id);
  return (
    <div
      onClick={() => { if (playing) return; if (vid || v.playUrl) onOpen(); else if (v.permalink) window.open(v.permalink, "_blank"); }}
      className="group relative block rounded-lg overflow-hidden bg-slate-900 aspect-[9/16] o-card hover:o-elev-lift transition-shadow cursor-pointer">
      {playing && <InlineTikTokPlayer videoId={vid || undefined} mediaUrl={v.playUrl} onClose={onClose} />}
      {v.coverUrl && <img src={imgSrc(v.coverUrl)} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
      <div className="absolute inset-0 z-10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
        <span className="w-11 h-11 rounded-full bg-surface/95 text-ink flex items-center justify-center text-lg">▶</span>
      </div>
      {v.createdAt && <span className="absolute top-1.5 right-1.5 z-10 text-[10px] font-medium text-white/90 bg-black/40 rounded px-1.5 py-0.5">{timeAgo(new Date(v.createdAt).getTime())}</span>}
      <div className="absolute bottom-0 left-0 right-0 p-2 text-white pointer-events-none">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-extrabold leading-none tracking-tight drop-shadow-md">{fmt(v.views)}</span>
          <span className="text-[10px] font-semibold text-white/70 uppercase tracking-wide">views</span>
        </div>
        <div className="flex items-center gap-2.5 text-[11px] font-semibold text-white/85 mt-1">
          <span>♥ {fmt(v.likes)}</span>
          <span>💬 {fmt(v.comments)}</span>
        </div>
        {v.caption && <p className="text-[10px] text-white/70 line-clamp-1 mt-1">{v.caption}</p>}
      </div>
    </div>
  );
}

// ─── Competitor research (List + Reels sub-tabs, mirrors the Instagram side) ────
type CompSubTab = "list" | "reels" | "find";

function CompetitorsTab({ client, embedded }: { client: Client; embedded?: boolean }) {
  const [subTab, setSubTab] = useState<CompSubTab>("list");
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [reels, setReels] = useState<CompReel[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sort, setSort] = useState<"recent" | "best" | "viral">("recent");
  const [viralDays, setViralDays] = useState(7);
  const [viralMinViews, setViralMinViews] = useState(25000); // floor to qualify as "going viral"
  const [creatorFilter, setCreatorFilter] = useState<string>("");
  const [creatorSearch, setCreatorSearch] = useState("");
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [tagFilter, setTagFilter] = useState<string>("");
  const [profileC, setProfileC] = useState<Competitor | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null); // only one reel plays at a time
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<Record<number, SyncState>>({});
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number } | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const stopSync = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetch(`${AI_API}/tiktok/competitors?clientId=${client.id}`).then((r) => r.json());
      setCompetitors(data.competitors || []);
      setReels(data.reels || []);
    } catch {/* ignore */}
    setLoading(false);
  }, [client.id]);

  useEffect(() => { load(); }, [load]);

  async function add(handle: string) {
    const h = parseHandle(handle);
    if (!h) return;
    setAdding(true);
    await fetch(`${AI_API}/tiktok/competitors`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: client.id, handle: h }) });
    setDraft(""); setShowAdd(false); setAdding(false);
    setTimeout(load, 1800); // let the fire-and-forget scrape land
    load();
  }
  async function remove(id: number) {
    if (!confirm("Remove this competitor and their videos?")) return;
    await fetch(`${AI_API}/tiktok/competitors?id=${id}`, { method: "DELETE" });
    load();
  }
  // Sync competitors one-by-one from the browser so we can show live per-row progress and never hit
  // the serverless time limit. By default only syncs ones that are new or stale (>12h); pass all=true
  // to force every competitor. Stops early if the API looks rate-limited (many failures in a row).
  async function syncAll(all = false) {
    if (refreshing) return;
    const STALE = 12 * 3600 * 1000;
    const targets = competitors.filter((c) => all || !c.lastScrapedAt || Date.now() - new Date(c.lastScrapedAt).getTime() > STALE);
    if (!targets.length) { setSyncMsg("Everything's already up to date."); setTimeout(() => setSyncMsg(null), 4000); return; }
    stopSync.current = false;
    setRefreshing(true); setSyncMsg(null);
    const init: Record<number, SyncState> = {};
    targets.forEach((c) => { init[c.id] = "pending"; });
    setSyncStatus(init);
    setSyncProgress({ done: 0, total: targets.length });
    let done = 0, consecErr = 0;
    for (const c of targets) {
      if (stopSync.current) break;
      setSyncStatus((s) => ({ ...s, [c.id]: "syncing" }));
      let state: SyncState = "error";
      let rateLimited = false;
      try {
        const res = await fetch(`${AI_API}/tiktok/competitors`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: client.id, syncId: c.id }) }).then((r) => r.json());
        if (res.error === "rate_limited") rateLimited = true;
        state = !res.ok ? "error" : res.found ? "done" : "nodata";
        // Merge the freshly-scraped row so its pic + stats appear immediately (no waiting for the end).
        if (res.competitor) setCompetitors((cs) => cs.map((x) => (x.id === c.id ? { ...x, ...res.competitor } : x)));
      } catch { state = "error"; }
      // Rate-limited = the API quota is spent. No point continuing — stop now and leave the rest queued.
      if (rateLimited) {
        setSyncStatus((s) => { const n = { ...s }; delete n[c.id]; return n; });
        setSyncMsg("Paused — the TikTok scraper API hit its rate limit / monthly quota (free plan = 100 requests/month). Wait for it to reset, or upgrade the RapidAPI plan, then Sync again. Already-synced accounts are kept.");
        stopSync.current = true;
        break;
      }
      setSyncStatus((s) => ({ ...s, [c.id]: state }));
      done++; setSyncProgress({ done, total: targets.length });
      consecErr = state === "done" ? 0 : consecErr + 1;
      if (consecErr >= 10) { stopSync.current = true; setSyncMsg("Stopped — the scraper stopped returning data (likely rate-limited or over quota). Try again later or upgrade the plan."); break; }
      await new Promise((r) => setTimeout(r, 250)); // pace to be gentle on the API
    }
    setRefreshing(false);
    setSyncProgress(null);
    load(); // pull the freshly-scraped stats + reels
  }

  // Parse pasted rows / a CSV: first column = TikTok URL or handle, any extra columns become tags
  // (e.g. Language + Gender). The header row and blanks are skipped automatically.
  function parseImport(text: string): { handle: string; tags?: string }[] {
    const out: { handle: string; tags?: string }[] = [];
    for (const line of text.split(/\r?\n/)) {
      const cells = line.split(/[\t,]/).map((c) => c.replace(/^"|"$/g, "").trim());
      const handle = parseHandle(cells[0] || "");
      if (!handle || handle.includes(" ")) continue; // skips header ("Account Name") + blanks
      const tags = cells.slice(1).filter(Boolean).join(", ") || undefined;
      out.push({ handle, tags });
    }
    return out;
  }
  async function runImport(text: string) {
    const handles = parseImport(text);
    if (!handles.length) { setImportResult("No valid TikTok handles found in that."); return; }
    setImporting(true); setImportResult(null);
    try {
      const res = await fetch(`${AI_API}/tiktok/competitors`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: client.id, handles }) }).then((r) => r.json());
      setImportResult(`Added ${res.created} competitor${res.created === 1 ? "" : "s"}${res.skipped ? ` · skipped ${res.skipped} (duplicates/invalid)` : ""}. Hit “Sync data” to pull their stats + videos.`);
      setImportText("");
      load();
    } catch { setImportResult("Import failed — try again."); }
    setImporting(false);
  }
  function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => runImport(String(reader.result || ""));
    reader.readAsText(f);
    e.target.value = "";
  }

  const allTags = Array.from(new Set(competitors.flatMap((c) => (c.tags || "").split(",").map((t) => t.trim()).filter(Boolean)))).sort((a, b) => a.localeCompare(b));
  const tagsByHandle = new Map(competitors.map((c) => [c.handle.toLowerCase(), new Set((c.tags || "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))]));

  const base = reels.filter((r) => (!creatorFilter || r.handle === creatorFilter)
    && (!tagFilter || (tagsByHandle.get((r.handle || "").toLowerCase())?.has(tagFilter.toLowerCase()) ?? false)));

  const now = Date.now();
  // Viral velocity = views ÷ days since posted, i.e. how fast the video is pulling views right now.
  // (Age clamped to ≥1 day so a post from an hour ago isn't wildly over-ranked.) Genuine big hits
  // rank high, regardless of the creator's size.
  const velocity = (r: CompReel) => {
    const days = Math.max(1, (now - new Date(r.timestamp).getTime()) / 86400000);
    return (r.plays ?? 0) / days;
  };
  const withX = base.map((r) => ({ r, x: velocity(r) }));
  let shownX: { r: CompReel; x: number }[];
  if (sort === "viral") {
    const cutoff = now - viralDays * 86400000;
    shownX = withX
      .filter(({ r }) => (r.plays ?? 0) >= viralMinViews && new Date(r.timestamp).getTime() >= cutoff)
      .sort((a, b) => b.x - a.x || (b.r.plays ?? 0) - (a.r.plays ?? 0));
  } else if (sort === "best") {
    shownX = [...withX].sort((a, b) => (b.r.plays ?? 0) - (a.r.plays ?? 0));
  } else {
    shownX = [...withX].sort((a, b) => new Date(b.r.timestamp).getTime() - new Date(a.r.timestamp).getTime());
  }
  const shown = shownX.map((s) => s.r);

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-surface border border-line rounded-xl p-1 w-fit">
        {([["list", "📋 List"], ["reels", "🎬 Reels"], ["find", "🔎 Find"]] as [CompSubTab, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setSubTab(id)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${subTab === id ? "bg-accent text-on-accent" : "text-muted hover:text-ink-2"}`}>{label}</button>
        ))}
      </div>

      {/* ── List ── */}
      {subTab === "list" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-ink-2">
                Competitor Accounts
                {competitors.length > 0 && <span className="ml-2 text-xs font-semibold text-accent bg-accent-tint px-2 py-0.5 rounded-full">{competitors.length}</span>}
              </p>
              <p className="text-xs text-faint mt-0.5">Track what's working in your niche</p>
            </div>
            <div className="flex gap-2">
              {competitors.length > 0 && (
                syncProgress ? (
                  <div className="flex items-center gap-2 px-3 py-2 text-xs font-medium bg-surface-3 rounded-lg">
                    <span className="w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                    <span className="text-ink-2 tabular-nums">Syncing {syncProgress.done}/{syncProgress.total}</span>
                    <button onClick={() => { stopSync.current = true; }} className="text-danger-500 hover:text-danger-600 ml-1">Stop</button>
                  </div>
                ) : (
                  <button onClick={() => syncAll(false)}
                    title="Pulls each competitor's latest videos + follower/view counts (only ones that are new or out of date)."
                    className="px-3 py-2 text-xs font-medium text-ink-2 bg-surface-3 rounded-lg hover:bg-surface-4">
                    ↻ Sync data
                  </button>
                )
              )}
              <button onClick={() => { setShowImport((s) => !s); setImportResult(null); }} className="px-3 py-2 text-xs font-medium text-ink-2 bg-surface-3 rounded-lg hover:bg-surface-4">⬆ Import</button>
              <button onClick={() => setShowAdd(true)} className="px-3 py-2 text-xs font-medium bg-accent text-on-accent rounded-lg hover:bg-accent-strong">+ Add</button>
            </div>
          </div>

          {syncMsg && <div className="text-xs text-warn-700 bg-warn-50 border border-warn-200 rounded-lg px-3 py-2">{syncMsg}</div>}

          {showImport && (
            <div className="bg-surface border border-line rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-ink-2">Bulk import competitors</p>
                  <p className="text-xs text-faint mt-0.5">Paste rows from your sheet (or drop a CSV). First column = TikTok URL/handle; any extra columns (language, gender…) become tags automatically.</p>
                </div>
                <label className="px-3 py-1.5 text-xs font-medium text-accent bg-accent-tint rounded-lg hover:bg-accent-tint cursor-pointer whitespace-nowrap">
                  Choose CSV
                  <input type="file" accept=".csv,.tsv,text/csv,text/plain" onChange={onImportFile} className="hidden" />
                </label>
              </div>
              <textarea
                value={importText} onChange={(e) => setImportText(e.target.value)}
                placeholder={"https://www.tiktok.com/@hugoomoreno_, ES, M\nhttps://www.tiktok.com/@lucas_reyyy, ES, M\n@mattyvidal_"}
                rows={5}
                className="w-full border border-line rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-accent resize-y" />
              <div className="flex items-center gap-2">
                <button onClick={() => runImport(importText)} disabled={importing || !importText.trim()}
                  className="px-4 py-2 bg-accent text-on-accent text-sm font-semibold rounded-lg hover:bg-accent-strong disabled:opacity-50">
                  {importing ? "Importing…" : `Import ${importText.trim() ? `(${parseImport(importText).length})` : ""}`}
                </button>
                <button onClick={() => { setShowImport(false); setImportText(""); setImportResult(null); }} className="px-3 py-2 text-sm text-muted hover:text-ink-2">Close</button>
                {importResult && <span className="text-xs text-ink-2 ml-1">{importResult}</span>}
              </div>
            </div>
          )}

          {showAdd && (
            <form onSubmit={(e) => { e.preventDefault(); add(draft); }} className="flex gap-2 bg-surface border border-line rounded-xl p-3">
              <div className="flex-1 flex items-center bg-surface-2 border border-line rounded-lg px-3">
                <span className="text-faint text-sm">@</span>
                <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="competitor TikTok handle"
                  className="flex-1 bg-transparent px-1 py-2 text-sm outline-none" />
              </div>
              <button disabled={adding || !draft.trim()} className="px-4 py-2 bg-accent text-on-accent text-sm font-semibold rounded-lg hover:bg-accent-strong disabled:opacity-50">
                {adding ? "Adding…" : "Add"}
              </button>
              <button type="button" onClick={() => { setShowAdd(false); setDraft(""); }} className="px-3 py-2 text-sm text-muted hover:text-ink-2">Cancel</button>
            </form>
          )}

          {loading ? (
            <div className="flex items-center justify-center h-40 text-faint text-sm">Loading…</div>
          ) : competitors.length === 0 ? (
            <div className="bg-surface rounded-2xl border border-dashed border-line p-12 text-center">
              <div className="text-3xl mb-2">🔍</div>
              <p className="text-sm text-muted">No competitors tracked yet.</p>
              <p className="text-xs text-faint mt-1">Add a TikTok handle to pull their recent videos and stats.</p>
            </div>
          ) : (
            <div className="bg-surface rounded-2xl border border-line overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] font-semibold text-faint uppercase tracking-wide">
                    <th className="px-4 py-3">Account</th>
                    <th className="px-3 py-3 text-right">Followers</th>
                    <th className="px-3 py-3 text-right">Following</th>
                    <th className="px-3 py-3 text-right">Videos</th>
                    <th className="px-4 py-3">Tags</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {competitors.map((c) => (
                    <CompetitorRow key={c.id} c={c} allTags={allTags} onSaved={load} status={syncStatus[c.id]}
                      onDelete={() => remove(c.id)} onView={() => setProfileC(c)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Reels ── */}
      {subTab === "reels" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex gap-1 bg-surface-3 rounded-lg p-0.5">
              {([["recent", "🆕 Recent"], ["best", "🏆 Top"], ["viral", "🚀 Viral"]] as [typeof sort, string][]).map(([id, label]) => (
                <button key={id} onClick={() => setSort(id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${sort === id ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink-2"}`}>{label}</button>
              ))}
            </div>
            {sort === "viral" && (
              <div className="flex items-center gap-1">
                {[7, 14, 30].map((d) => (
                  <button key={d} onClick={() => setViralDays(d)}
                    className={`px-2 py-1 rounded-md text-[11px] font-semibold border transition-colors ${viralDays === d ? "bg-accent text-on-accent border-accent" : "bg-surface text-muted border-line hover:border-line-2"}`}>{d}d</button>
                ))}
                <input type="number" min={1} max={365} value={viralDays}
                  onChange={(e) => setViralDays(Math.max(1, Math.min(365, Number(e.target.value) || 7)))}
                  className="w-14 border border-line rounded-md px-2 py-1 text-[11px] text-ink-2 focus:outline-none focus:ring-2 focus:ring-accent" title="Custom day window" />
                <span className="text-[11px] text-faint mr-1">days</span>
                <span className="text-[11px] text-faint">· min</span>
                <select value={viralMinViews} onChange={(e) => setViralMinViews(Number(e.target.value))}
                  title="Minimum views to qualify as going viral"
                  className="border border-line rounded-md px-1.5 py-1 text-[11px] text-ink-2 focus:outline-none focus:ring-2 focus:ring-accent">
                  {[0, 10000, 25000, 50000, 100000, 250000, 500000].map((v) => <option key={v} value={v}>{v === 0 ? "any" : fmt(v)} views</option>)}
                </select>
              </div>
            )}
            <span className="text-xs text-faint">{shown.length} videos</span>
            {/* Searchable competitor filter (type to find one) */}
            <div className="relative">
              {creatorFilter ? (
                <button onClick={() => { setCreatorFilter(""); setCreatorSearch(""); }}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border border-accent bg-accent-tint text-accent-strong">
                  @{creatorFilter} <span className="hover:text-accent">✕</span>
                </button>
              ) : (
                <input value={creatorSearch}
                  onChange={(e) => { setCreatorSearch(e.target.value); setCreatorOpen(true); }}
                  onFocus={() => setCreatorOpen(true)} onBlur={() => setTimeout(() => setCreatorOpen(false), 150)}
                  placeholder="🔍 competitor…"
                  className="w-44 border border-line rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-accent" />
              )}
              {creatorOpen && !creatorFilter && (
                <div className="absolute right-0 top-full mt-1 w-60 max-h-64 overflow-y-auto bg-surface border border-line rounded-xl o-elev-lift z-[100] py-1">
                  {competitors
                    .filter((c) => c.handle.toLowerCase().includes(creatorSearch.toLowerCase()) || (c.name || "").toLowerCase().includes(creatorSearch.toLowerCase()))
                    .sort((a, b) => a.handle.localeCompare(b.handle))
                    .slice(0, 60)
                    .map((c) => (
                      <button key={c.id} onMouseDown={() => { setCreatorFilter(c.handle); setCreatorOpen(false); }}
                        className="w-full text-left px-3 py-1.5 text-xs text-ink-2 hover:bg-surface-2 flex items-center gap-2">
                        {c.profilePicUrl
                          ? <img src={imgSrc(c.profilePicUrl)} alt="" className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
                          : <span className="w-5 h-5 rounded-full bg-surface-3 flex items-center justify-center text-[8px] font-bold text-faint flex-shrink-0">{c.handle.slice(0, 2).toUpperCase()}</span>}
                        <span className="truncate">@{c.handle}</span>
                      </button>
                    ))}
                  {competitors.filter((c) => c.handle.toLowerCase().includes(creatorSearch.toLowerCase())).length === 0 && (
                    <p className="px-3 py-2 text-[11px] text-faint">No competitor matches.</p>
                  )}
                </div>
              )}
            </div>
            <button onClick={() => syncAll(false)} disabled={refreshing}
              className="ml-auto px-3 py-1.5 bg-accent text-on-accent text-xs font-semibold rounded-lg hover:bg-accent-strong disabled:opacity-50">
              {syncProgress ? `Syncing ${syncProgress.done}/${syncProgress.total}…` : "↻ Refresh now"}
            </button>
          </div>

          {allTags.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-semibold text-faint uppercase tracking-wide mr-0.5">🏷 Tags</span>
              <button onClick={() => setTagFilter("")}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${tagFilter === "" ? "bg-accent text-on-accent border-accent" : "bg-surface text-muted border-line"}`}>All</button>
              {allTags.map((t) => (
                <button key={t} onClick={() => setTagFilter(tagFilter.toLowerCase() === t.toLowerCase() ? "" : t)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${tagFilter.toLowerCase() === t.toLowerCase() ? "bg-accent text-on-accent border-accent" : "bg-accent-tint text-accent-strong border-transparent hover:border-accent"}`}>{t}</button>
              ))}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center h-40 text-faint text-sm">Loading…</div>
          ) : shown.length === 0 ? (
            <div className="bg-surface rounded-2xl border border-dashed border-line p-16 flex flex-col items-center gap-3 text-center">
              <div className="text-3xl">🎬</div>
              <div>
                <p className="text-sm font-semibold text-ink-2">{competitors.length === 0 ? "Add competitors first" : sort === "viral" ? `No videos in the last ${viralDays} days` : "No videos yet"}</p>
                <p className="text-xs text-faint mt-1 max-w-sm">
                  {competitors.length === 0 ? "Go to the List tab and add competitor accounts." : sort === "viral" ? "Widen the day window or hit “Refresh now”." : "Hit “Refresh now” to pull their latest videos."}
                </p>
              </div>
            </div>
          ) : (
            <div {...gridProps(embedded, "gap-1.5")}>
              {shownX.map(({ r, x }) => <CompReelTile key={r.id} r={r} viralX={sort === "viral" ? x : undefined} playing={playingId === r.id} onOpen={() => setPlayingId(r.id)} onClose={() => setPlayingId(null)} />)}
            </div>
          )}
        </div>
      )}

      {subTab === "find" && <FinderTab client={client} />}

      {profileC && <CompetitorProfileModal c={profileC} reels={reels.filter((r) => r.handle === profileC.handle)} onClose={() => setProfileC(null)} />}
    </div>
  );
}

// Small live-sync indicator shown on each row while a bulk sync runs.
function SyncBadge({ status }: { status?: SyncState }) {
  if (!status) return null;
  if (status === "pending") return <span className="text-[10px] font-medium text-faint bg-surface-3 px-1.5 py-0.5 rounded-full">queued</span>;
  if (status === "syncing") return <span className="inline-flex items-center gap-1 text-[10px] font-medium text-accent bg-accent-tint px-1.5 py-0.5 rounded-full"><span className="w-2.5 h-2.5 border-2 border-accent border-t-transparent rounded-full animate-spin" />syncing</span>;
  if (status === "done") return <span className="text-[10px] font-semibold text-ok-600 bg-ok-50 px-1.5 py-0.5 rounded-full">✓ synced</span>;
  if (status === "nodata") return <span className="text-[10px] font-semibold text-warn-600 bg-warn-50 px-1.5 py-0.5 rounded-full" title="No data came back — the account may not exist, be private, or the API returned nothing (often quota).">no data</span>;
  return <span className="text-[10px] font-semibold text-danger-500 bg-danger-50 px-1.5 py-0.5 rounded-full" title="Scrape failed (likely rate-limited)">failed</span>;
}

// ─── Competitor Finder: TikTok's public API login-gates all discovery (account search, followings,
// hashtag feeds all return empty), so reliable auto-discovery isn't possible with the current data
// provider — this tab is honest about that and points to the flows that do work.
function FinderTab({ client }: { client: Client }) {
  void client;
  return (
    <div className="max-w-2xl">
      <div className="bg-surface border border-line rounded-2xl p-6">
        <div className="text-2xl mb-2">🔎</div>
        <h3 className="text-base font-bold text-ink mb-1">Auto-find isn't available for TikTok</h3>
        <p className="text-sm text-muted leading-relaxed">
          Unlike Instagram, TikTok's public API locks down discovery — account search, "who they follow",
          and hashtag feeds all require a logged-in session, so there's no reliable way to auto-surface
          real competitors. (Letting an AI guess handles just invents fake accounts.)
        </p>
        <p className="text-sm text-muted leading-relaxed mt-3">Build your list with the flows that do work:</p>
        <ul className="text-sm text-ink-2 mt-2 space-y-1.5">
          <li>• <b>+ Add</b> — paste a handle or a full TikTok link</li>
          <li>• <b>⬆ Import</b> — bulk-paste a whole list or drop a CSV (extra columns become tags automatically)</li>
        </ul>
        <p className="text-xs text-faint mt-4 leading-relaxed">
          True auto-discovery would need a TikTok data provider whose hashtag or search endpoints actually
          return data (then it'd surface creators posting on your niche hashtags). Say the word and we can wire one in.
        </p>
      </div>
    </div>
  );
}

// Table row for one tracked competitor.
function CompetitorRow({ c, allTags, onSaved, onDelete, onView, status }: { c: Competitor; allTags: string[]; onSaved: () => void; onDelete: () => void; onView: () => void; status?: SyncState }) {
  const url = `https://www.tiktok.com/@${c.handle}`;
  return (
    <tr className="border-b border-line-softer last:border-0 hover:bg-surface-2/60 transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          {c.profilePicUrl
            ? <img src={imgSrc(c.profilePicUrl)} alt="" className="w-9 h-9 rounded-full object-cover flex-shrink-0 bg-surface-3" />
            : <div className="w-9 h-9 rounded-full bg-surface-3 flex items-center justify-center text-faint text-xs font-bold flex-shrink-0">{c.handle.slice(0, 2).toUpperCase()}</div>}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <button onClick={onView} className="text-sm font-bold text-ink hover:text-accent truncate" title="View profile in ORDO">@{c.handle}</button>
              {c.verified && <span className="text-info-500 text-xs" title="Verified">✔</span>}
              <SyncBadge status={status} />
            </div>
            {c.name && <p className="text-xs text-faint truncate max-w-[220px]">{c.name}</p>}
          </div>
        </div>
      </td>
      <td className="px-3 py-3 text-right font-semibold text-ink-2 tabular-nums">{c.followerCount != null ? fmt(c.followerCount) : "—"}</td>
      <td className="px-3 py-3 text-right text-muted tabular-nums">{c.followingCount != null ? fmt(c.followingCount) : "—"}</td>
      <td className="px-3 py-3 text-right text-muted tabular-nums">{c.postCount != null ? fmt(c.postCount) : "—"}</td>
      <td className="px-4 py-3"><TagCell c={c} allTags={allTags} onSaved={onSaved} /></td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1.5">
          <button onClick={onView} className="px-2.5 py-1.5 text-xs font-medium text-accent bg-accent-tint rounded-lg hover:bg-accent-tint">View profile</button>
          <a href={url} target="_blank" rel="noopener noreferrer" title="Open on TikTok" className="px-2 py-1.5 text-xs font-medium text-ink-2 bg-surface-3 rounded-lg hover:bg-surface-4">↗</a>
          <button onClick={onDelete} className="px-2.5 py-1.5 text-xs font-medium text-danger-500 bg-danger-50 rounded-lg hover:bg-danger-100">✕</button>
        </div>
      </td>
    </tr>
  );
}

// Inline tag editor — type to create, click to add/remove. Saves to the competitor.
function TagCell({ c, allTags, onSaved }: { c: Competitor; allTags: string[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const current = (c.tags || "").split(",").map((t) => t.trim()).filter(Boolean);

  async function save(next: string[]) {
    setBusy(true);
    try {
      await fetch(`${AI_API}/tiktok/competitors`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: c.id, tags: next.join(", ") }) });
      onSaved();
    } finally { setBusy(false); }
  }
  function add(tag: string) {
    const t = tag.trim();
    if (!t || current.some((x) => x.toLowerCase() === t.toLowerCase())) { setInput(""); return; }
    save([...current, t]); setInput("");
  }
  const q = input.trim().toLowerCase();
  const suggestions = allTags.filter((t) => !current.some((x) => x.toLowerCase() === t.toLowerCase()) && t.toLowerCase().includes(q));
  const canCreate = !!input.trim() && !allTags.some((t) => t.toLowerCase() === q);

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} disabled={busy} className="flex flex-wrap items-center gap-1 min-h-[26px] text-left group/tag">
        {current.length === 0
          ? <span className="text-[11px] text-faint group-hover/tag:text-accent">＋ add tag</span>
          : current.map((t) => <span key={t} className="px-2 py-0.5 bg-accent-tint text-accent-strong text-[10px] rounded-full font-semibold">🏷 {t}</span>)}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 w-56 bg-surface border border-line rounded-xl o-elev-lift z-50 p-2" onClick={(e) => e.stopPropagation()}>
            {current.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {current.map((t) => (
                  <span key={t} className="flex items-center gap-1 px-2 py-0.5 bg-accent-tint text-accent-strong text-[10px] rounded-full font-semibold">
                    {t}<button onClick={() => save(current.filter((x) => x !== t))} className="hover:text-danger-500">✕</button>
                  </span>
                ))}
              </div>
            )}
            <input autoFocus value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(input); } }}
              placeholder="Type a tag, Enter to add…"
              className="w-full border border-line rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-accent mb-1" />
            {canCreate && <button onClick={() => add(input)} className="w-full text-left px-2 py-1 text-[11px] font-medium text-accent hover:bg-accent-tint rounded-md">＋ Create “{input.trim()}”</button>}
            <div className="max-h-40 overflow-y-auto">
              {suggestions.map((t) => <button key={t} onClick={() => add(t)} className="w-full text-left px-2 py-1 text-[11px] text-ink-2 hover:bg-surface-2 rounded-md">🏷 {t}</button>)}
              {suggestions.length === 0 && !canCreate && <p className="px-2 py-1.5 text-[10px] text-faint">No tags yet — type above to create one.</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// In-app profile view — the competitor's stored videos (instant, from already-loaded reels).
function CompetitorProfileModal({ c, reels, onClose }: { c: Competitor; reels: CompReel[]; onClose: () => void }) {
  const sorted = [...reels].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const [playingId, setPlayingId] = useState<string | null>(null);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div className="bg-surface rounded-2xl o-elev-pop w-full max-w-3xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-line flex items-center justify-between sticky top-0 bg-surface z-10">
          <div className="flex items-center gap-3 min-w-0">
            {c.profilePicUrl
              ? <img src={imgSrc(c.profilePicUrl)} alt="" className="w-11 h-11 rounded-full object-cover flex-shrink-0 bg-surface-3" />
              : <div className="w-11 h-11 rounded-full bg-surface-3 flex-shrink-0" />}
            <div className="min-w-0">
              <a href={`https://www.tiktok.com/@${c.handle}`} target="_blank" rel="noopener noreferrer" className="text-base font-bold text-ink hover:text-accent">@{c.handle} <span className="text-xs font-normal text-faint">↗</span></a>
              <p className="text-xs text-faint truncate">{c.followerCount != null ? `${fmt(c.followerCount)} followers` : ""}{c.name ? ` · ${c.name}` : ""}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-faint hover:text-ink-2 text-xl flex-shrink-0">×</button>
        </div>
        <div className="p-5">
          {c.bio && <p className="text-xs text-muted mb-4 whitespace-pre-wrap leading-relaxed">{c.bio}</p>}
          {sorted.length === 0
            ? <p className="text-sm text-faint text-center py-12">No videos scraped for this account yet — hit “Sync data”.</p>
            : <div className="grid grid-cols-3 gap-1.5">{sorted.map((r) => <CompReelTile key={r.id} r={r} playing={playingId === r.id} onOpen={() => setPlayingId(r.id)} onClose={() => setPlayingId(null)} />)}</div>}
        </div>
      </div>
    </div>
  );
}

function CompReelTile({ r, viralX, playing, onOpen, onClose }: { r: CompReel; viralX?: number; playing: boolean; onOpen: () => void; onClose: () => void }) {
  const vid = videoIdFrom(r.permalink, r.videoId);
  return (
    <div
      onClick={() => { if (playing) return; if (vid || r.media_url) onOpen(); else if (r.permalink) window.open(r.permalink, "_blank"); }}
      className="group relative block rounded-lg overflow-hidden bg-slate-900 aspect-[9/16] o-card hover:o-elev-lift transition-shadow cursor-pointer">
      {playing && <InlineTikTokPlayer videoId={vid || undefined} mediaUrl={r.media_url} onClose={onClose} />}
      {r.thumbnail_url && <img src={imgSrc(r.thumbnail_url)} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
      {/* play affordance on hover */}
      <div className="absolute inset-0 z-10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
        <span className="w-11 h-11 rounded-full bg-surface/95 text-ink flex items-center justify-center text-lg">▶</span>
      </div>
      {r.handle && <span className="absolute top-1.5 left-1.5 z-10 text-[10px] font-semibold text-white/90 bg-black/40 rounded px-1.5 py-0.5">@{r.handle}</span>}
      <div className="absolute top-1.5 right-1.5 z-10 flex flex-col items-end gap-1">
        {r.timestamp && <span className="text-[10px] font-medium text-white/90 bg-black/40 rounded px-1.5 py-0.5">{timeAgo(new Date(r.timestamp).getTime())}</span>}
        {viralX != null && <span className="text-[10px] font-bold text-on-status bg-hue-rose-500 rounded px-1.5 py-0.5 shadow" title="Views per day since it was posted (how fast it's pulling views)">🔥 {fmt(Math.round(viralX))}/day</span>}
      </div>
      <div className="absolute bottom-0 left-0 right-0 p-2 text-white pointer-events-none">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-extrabold leading-none tracking-tight drop-shadow-md">{fmt(r.plays)}</span>
          <span className="text-[10px] font-semibold text-white/70 uppercase tracking-wide">views</span>
        </div>
        <div className="flex items-center gap-2.5 text-[11px] font-semibold text-white/85 mt-1">
          <span>♥ {fmt(r.like_count)}</span>
          <span>💬 {fmt(r.comments_count)}</span>
        </div>
        {r.caption && <p className="text-[10px] text-white/70 line-clamp-1 mt-1">{r.caption}</p>}
      </div>
    </div>
  );
}
