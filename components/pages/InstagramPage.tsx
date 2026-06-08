"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Client, Competitor } from "@/lib/types";
import Modal from "@/components/ui/Modal";
import { ConceptModal } from "./Concepts";

type Props = {
  clients: Client[];
  selectedClientId: number | null;
  attachConcept?: { id: number; name: string } | null;
  onExitAttach?: () => void;
};

type IGReel = {
  id: string;
  thumbnail_url?: string;
  media_url?: string;
  caption?: string;
  timestamp: string;
  like_count: number;
  comments_count: number;
  plays?: number;
  reach?: number;
  saved?: number;
  shares?: number;
  reposts?: number;
  totalInteractions?: number;
  avgWatchTime?: number; // ms
  totalWatchTime?: number; // ms
  skipRate?: number; // 0-1 ratio
  is_shared_to_feed?: boolean;
  permalink?: string;
  handle?: string;
  instagramUrl?: string;
  exploded?: boolean;
  viewDelta3d?: number;
  growthPct3d?: number | null;
  outlierX?: number | null;
  isOutlier?: boolean;
  format?: string | null;
};

type IGProfile = {
  igUserId: string;
  username?: string;
  followers?: number;
  mediaCount?: number;
  biography?: string;
  profilePictureUrl?: string;
};

function fmt(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

function timeAgo(ms: number) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

type Tab = "reels" | "competitors";

export default function InstagramPage({ clients, selectedClientId, attachConcept, onExitAttach }: Props) {
  const client = clients.find((c) => c.id === selectedClientId) ?? null;
  const [tab, setTab] = useState<Tab>("reels");
  const [profile, setProfile] = useState<IGProfile | null>(null);
  const [reels, setReels] = useState<IGReel[]>([]);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [loadingReels, setLoadingReels] = useState(false);
  const [selected, setSelected] = useState<IGReel | null>(null);
  // Pre-seed from client data so we never flash "not connected" while profile loads
  const [connected, setConnected] = useState(!!client?.instagramConnection?.accessToken);
  const [tokenExpired, setTokenExpired] = useState(false);

  const fetchProfile = useCallback(async () => {
    if (!client) return;
    setLoadingProfile(true);
    setTokenExpired(false);
    try {
      const res = await fetch(`/api/instagram/profile?clientId=${client.id}`);
      if (res.status === 401) {
        setTokenExpired(true);
        setConnected(true); // still "connected" in DB, just token expired
        setProfile(null);
      } else if (res.ok) {
        const data = await res.json();
        setProfile(data);
        setConnected(true);
      } else {
        setProfile(null);
        setConnected(false);
      }
    } catch {
      setConnected(false);
    }
    setLoadingProfile(false);
  }, [client]);

  const fetchReels = useCallback(async () => {
    if (!client || !connected) return;
    setLoadingReels(true);
    let cursor: string | null = null;
    let first = true;
    try {
      while (true) {
        const url: string = `/api/instagram/media?clientId=${client.id}${cursor ? `&cursor=${cursor}` : ""}`;
        const res = await fetch(url);
        if (!res.ok) break;
        const data: any = await res.json();
        const page = data.reels; const nextCursor: string | null = data.nextCursor ?? null;
        if (first) {
          setReels(page);          // show first 25 immediately
          setLoadingReels(false);  // hide spinner right away
          first = false;
        } else {
          setReels((prev) => [...prev, ...page]); // append subsequent pages silently
        }
        if (!nextCursor) break;
        cursor = nextCursor;
      }
    } catch {/* ignore */}
    setLoadingReels(false);
  }, [client, connected]);

  useEffect(() => {
    setProfile(null);
    setReels([]);
    setConnected(!!client?.instagramConnection?.accessToken);
    fetchProfile();
  }, [fetchProfile]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (connected) fetchReels();
  }, [connected, fetchReels]);

  // Check for OAuth success/error in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("ig_connected") === "1") {
      fetchProfile();
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (params.get("ig_error")) {
      alert("Instagram connection failed. Make sure your account is a Business or Creator account.");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [fetchProfile]);

  async function disconnect() {
    if (!client || !confirm("Disconnect Instagram?")) return;
    await fetch(`/api/instagram/disconnect?clientId=${client.id}`, { method: "DELETE" });
    setConnected(false);
    setProfile(null);
    setReels([]);
  }

  if (!client) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
        Select a client to view their Instagram
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {attachConcept && (
        <div className="sticky top-0 z-30 flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-indigo-600 text-white shadow-lg">
          <p className="text-sm font-semibold">🎬 Adding reels to "{attachConcept.name}" — open a reel and tap "Add to concept group".</p>
          <button onClick={onExitAttach} className="px-3 py-1.5 text-xs font-semibold bg-white/20 hover:bg-white/30 rounded-lg">✕ Done</button>
        </div>
      )}
      <ProfileHeader
        client={client}
        profile={profile}
        reelCount={reels.length}
        isConnected={connected}
        loading={loadingProfile}
        onDisconnect={disconnect}
      />

      <div className="flex gap-1 bg-white border border-slate-200 rounded-xl p-1 w-fit">
        {([["reels", "📱 Reels"], ["competitors", "🔍 Competitors"]] as [Tab, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === id ? "bg-indigo-600 text-white" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "reels" && (
        tokenExpired
          ? (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center">
              <p className="text-amber-800 font-semibold mb-1">Instagram access token expired</p>
              <p className="text-amber-600 text-sm mb-4">Reconnect to restore access to reels and insights.</p>
              <a
                href={`/api/auth/instagram?clientId=${client.id}`}
                className="inline-block bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700"
              >
                Reconnect Instagram
              </a>
            </div>
          )
          : connected
          ? loadingReels
            ? <div className="flex items-center justify-center h-40 text-slate-400 text-sm">Loading reels…</div>
            : reels.length > 0
              ? <>
                  <ReelsGrid reels={reels} onSelect={setSelected} />
                  {selected && <ReelDetailPanel reel={selected} client={client} onClose={() => setSelected(null)} attachConcept={attachConcept} />}
                </>
              : <div className="text-center py-16 text-slate-400 text-sm">No reels found on this account.</div>
          : <NotConnectedReels client={client} />
      )}


      {tab === "competitors" && <CompetitorsTab client={client} />}
    </div>
  );
}

function NotConnectedReels({ client }: { client: Client }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-16 flex flex-col items-center text-center gap-5">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 flex items-center justify-center text-2xl shadow-lg">
        📸
      </div>
      <div>
        <h2 className="text-lg font-bold text-slate-800 mb-1">Connect {client.name}'s Instagram</h2>
        <p className="text-sm text-slate-500 max-w-sm">
          Link the Instagram Business or Creator account to browse Reels, view analytics, and save content as concepts.
        </p>
      </div>
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 text-left max-w-sm w-full">
        <p className="text-xs font-semibold text-amber-700 mb-2">Requirements</p>
        {[
          "Instagram Business or Creator account",
          "Linked to a Facebook Page",
          "Added as tester in Meta Developer App",
        ].map((item) => (
          <div key={item} className="flex items-start gap-2 text-xs text-amber-700 mt-1">
            <span className="mt-0.5">•</span>
            {item}
          </div>
        ))}
      </div>
      <a
        href={`/api/auth/instagram?clientId=${client.id}`}
        className="px-6 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm font-semibold rounded-xl hover:opacity-90 transition-opacity shadow-lg"
      >
        Connect Instagram via Meta
      </a>
    </div>
  );
}

function ProfileHeader({
  client, profile, reelCount, isConnected, loading, onDisconnect,
}: {
  client: Client;
  profile: IGProfile | null;
  reelCount: number;
  isConnected: boolean;
  loading: boolean;
  onDisconnect: () => void;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 px-6 py-5 flex items-center gap-6">
      {profile?.profilePictureUrl
        ? <img src={profile.profilePictureUrl} alt="" className="w-16 h-16 rounded-full object-cover flex-shrink-0 shadow" />
        : <div className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold text-white flex-shrink-0 shadow" style={{ backgroundColor: client.color }}>
            {client.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
          </div>
      }
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <h2 className="text-base font-bold text-slate-800">
            {profile?.username ? `@${profile.username}` : client.name}
          </h2>
          {isConnected && <span className="text-[10px] bg-blue-100 text-blue-600 font-semibold px-1.5 py-0.5 rounded-full">Business</span>}
        </div>
        <p className="text-xs text-slate-400 line-clamp-1">{profile?.biography || client.name}</p>
      </div>
      <div className="flex gap-8 flex-shrink-0">
        {[
          { label: "Reels", value: reelCount || (profile?.mediaCount ?? "—") },
          { label: "Followers", value: profile?.followers ? fmt(profile.followers) : "—" },
        ].map(({ label, value }) => (
          <div key={label} className="text-center">
            <p className="text-base font-bold text-slate-800">{loading ? "…" : value}</p>
            <p className="text-xs text-slate-400">{label}</p>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${
          isConnected ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? "bg-green-500" : "bg-amber-400"}`} />
          {isConnected ? "Connected" : "Not connected"}
        </span>
        {isConnected && (
          <button onClick={onDisconnect} className="text-xs text-slate-400 hover:text-red-500 transition-colors">
            Disconnect
          </button>
        )}
      </div>
    </div>
  );
}

// Mon-first weekday options, mapped to JS getDay() values (0=Sun … 6=Sat).
const WEEKDAY_FILTERS: { label: string; dow: number }[] = [
  { label: "Mon", dow: 1 }, { label: "Tue", dow: 2 }, { label: "Wed", dow: 3 },
  { label: "Thu", dow: 4 }, { label: "Fri", dow: 5 }, { label: "Sat", dow: 6 }, { label: "Sun", dow: 0 },
];

function ReelsGrid({ reels, onSelect }: { reels: IGReel[]; onSelect: (r: IGReel) => void }) {
  const [sort, setSort] = useState<"recent" | "best">("recent");
  const [dayFilter, setDayFilter] = useState<number | null>(null); // JS getDay() value, or null = all days

  const sorted = sort === "best"
    ? [...reels].sort((a, b) => (b.plays ?? b.like_count ?? 0) - (a.plays ?? a.like_count ?? 0))
    : reels;
  const filtered = dayFilter === null
    ? sorted
    : sorted.filter((r) => r.timestamp && new Date(r.timestamp).getDay() === dayFilter);

  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
          Reels · {filtered.length}{dayFilter !== null ? ` of ${reels.length}` : ""}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Weekday filter */}
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
            <button
              onClick={() => setDayFilter(null)}
              className={`px-2 py-1 rounded-md text-xs font-semibold transition-colors ${dayFilter === null ? "bg-white text-slate-700 shadow-sm" : "text-slate-400 hover:text-slate-600"}`}
            >All</button>
            {WEEKDAY_FILTERS.map((w) => (
              <button
                key={w.dow}
                onClick={() => setDayFilter(dayFilter === w.dow ? null : w.dow)}
                className={`px-2 py-1 rounded-md text-xs font-semibold transition-colors ${dayFilter === w.dow ? "bg-indigo-500 text-white shadow-sm" : "text-slate-400 hover:text-slate-600"}`}
              >{w.label}</button>
            ))}
          </div>
          <button
            onClick={() => setSort(sort === "recent" ? "best" : "recent")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              sort === "best"
                ? "bg-amber-400 text-white"
                : "bg-slate-100 text-slate-500 hover:bg-slate-200"
            }`}
          >
            🏆 Best Performing
          </button>
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="py-12 text-center text-sm text-slate-400">
          No reels posted on {WEEKDAY_FILTERS.find((w) => w.dow === dayFilter)?.label ?? "this day"}.
        </div>
      ) : (
      <div className="grid grid-cols-4 gap-1.5">
        {filtered.map((reel) => (
          <button key={reel.id} onClick={() => onSelect(reel)}
            className="relative aspect-[9/16] bg-slate-900 rounded-xl overflow-hidden group">
            {reel.thumbnail_url
              ? <img src={reel.thumbnail_url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
              : <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900">
                  <span className="text-3xl opacity-30">▶</span>
                </div>
            }
            {/* Trial reel badge */}
            {reel.is_shared_to_feed === false && (
              <div className="absolute top-2 left-2 z-10">
                <span className="bg-orange-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide shadow">Trial</span>
              </div>
            )}
            {/* Posted date */}
            {reel.timestamp && (
              <div className="absolute top-2 right-2 z-10">
                <span className="bg-black/55 text-white text-[9px] font-semibold px-1.5 py-0.5 rounded-full backdrop-blur-sm">
                  {new Date(reel.timestamp).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
                </span>
              </div>
            )}
            {/* Always-visible gradient + stat chips */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent pointer-events-none" />
            <div className="absolute bottom-0 left-0 right-0 p-2 flex flex-wrap gap-1">
              {reel.plays != null && (
                <span className="flex items-center gap-0.5 bg-indigo-500/90 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full backdrop-blur-sm">▶ {fmt(reel.plays)}</span>
              )}
              {reel.like_count > 0 && (
                <span className="flex items-center gap-0.5 bg-pink-500/90 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full backdrop-blur-sm">♥ {fmt(reel.like_count)}</span>
              )}
              {reel.saved != null && reel.saved > 0 && (
                <span className="flex items-center gap-0.5 bg-amber-500/90 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full backdrop-blur-sm">🔖 {fmt(reel.saved)}</span>
              )}
              {reel.comments_count > 0 && (
                <span className="flex items-center gap-0.5 bg-slate-600/90 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full backdrop-blur-sm">💬 {fmt(reel.comments_count)}</span>
              )}
            </div>
          </button>
        ))}
      </div>
      )}
    </div>
  );
}

type CompSubTab = "list" | "reels" | "find";

function CompetitorsTab({ client }: { client: Client }) {
  const [subTab, setSubTab] = useState<CompSubTab>("list");
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Competitor | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [quotaReached, setQuotaReached] = useState(false);

  // Reels sub-tab state
  const [allReels, setAllReels] = useState<IGReel[]>([]);
  const [fetchErrors, setFetchErrors] = useState<{ handle: string; error: string }[]>([]);
  const [loadingReels, setLoadingReels] = useState(false);
  const [reelsFetched, setReelsFetched] = useState(false);
  const [lastScraped, setLastScraped] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [timeFilter, setTimeFilter] = useState<"7" | "14" | "30" | "90" | "all">("all");
  const [reelSort, setReelSort] = useState<"recent" | "best" | "trending">("recent");
  const [formatFilter, setFormatFilter] = useState<"all" | "talking_head" | "text_overlay" | "broll">("all");
  const [selectedReel, setSelectedReel] = useState<IGReel | null>(null);

  const reload = useCallback(async () => {
    const data = await fetch(`/api/competitors?clientId=${client.id}`).then((r) => r.json());
    setCompetitors(data);
  }, [client.id]);

  useEffect(() => { reload(); }, [reload]);

  async function remove(id: number) {
    if (!confirm("Remove this competitor?")) return;
    await fetch(`/api/competitors/${id}`, { method: "DELETE" });
    reload();
  }

  async function syncProfiles(force = false) {
    setSyncing(true);
    try {
      const d = await fetch("/api/competitors/enrich", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id, force }),
      }).then((r) => r.json());
      const quota = !!d.error && /quota/i.test(d.error);
      setQuotaReached(quota);
      if (d.upToDate) alert("All competitor data is already up to date.");
      else if (d.synced === 0 && d.error && !quota) alert(`Couldn't sync profile data: ${d.error}`);
      else if (d.synced > 0) alert(`Synced ${d.synced} competitor${d.synced !== 1 ? "s" : ""}.`);
      reload();
    } finally {
      setSyncing(false);
    }
  }

  async function suggestCompetitors() {
    setSuggesting(true);
    setSuggestions([]);
    try {
      const res = await fetch("/api/ai/suggest-competitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: client.name,
          platform: client.platform,
          niche: competitors[0]?.niche || client.notes || "",
          existing: competitors.map((c) => c.handle),
        }),
      });
      const data = await res.json();
      setSuggestions(data.handles || []);
    } catch {
      setSuggestions(["Could not load suggestions"]);
    }
    setSuggesting(false);
  }

  // Read-only: load the reels the cron already scraped into the DB. Instant + free.
  async function loadReels() {
    setLoadingReels(true);
    try {
      const data = await fetch(`/api/competitors/reels?clientId=${client.id}`).then((r) => r.json());
      setAllReels((data.reels || []) as IGReel[]);
      setFetchErrors(data.errors || []);
      setLastScraped(data.lastScraped || null);
    } catch {
      setAllReels([]);
    }
    setLoadingReels(false);
    setReelsFetched(true);
  }

  // Manual "Refresh now" — actually hits the scraper (with a server-side cooldown).
  async function refreshNow() {
    setRefreshing(true);
    try {
      const d = await fetch(`/api/competitors/reels?clientId=${client.id}`, { method: "POST" }).then((r) => r.json());
      if (d.error) { alert(d.error); }
      else if (d.scraped === 0) { alert(`Already fresh — competitors were scraped within the last ${d.cooldownHours}h. Try again later.`); }
      await loadReels();
    } catch {
      alert("Refresh failed. Try again.");
    }
    setRefreshing(false);
  }

  useEffect(() => {
    if (subTab === "reels" && !reelsFetched) loadReels();
  }, [subTab, reelsFetched]); // eslint-disable-line react-hooks/exhaustive-deps

  const now = Date.now();
  const days = timeFilter === "all" ? Infinity : parseInt(timeFilter);
  const filteredReels = allReels.filter((r) =>
    (days === Infinity || now - new Date(r.timestamp).getTime() < days * 24 * 60 * 60 * 1000) &&
    (formatFilter === "all" || r.format === formatFilter)
  );
  const sortedReels = reelSort === "best"
    ? [...filteredReels].sort((a, b) => (b.plays ?? b.like_count ?? 0) - (a.plays ?? a.like_count ?? 0))
    : reelSort === "trending"
      // Trending: biggest recent view-growth first (exploded on top), then by growth %, then views
      ? [...filteredReels].sort((a, b) =>
          (b.exploded ? 1 : 0) - (a.exploded ? 1 : 0) ||
          (b.growthPct3d ?? -1) - (a.growthPct3d ?? -1) ||
          (b.viewDelta3d ?? 0) - (a.viewDelta3d ?? 0) ||
          (b.plays ?? 0) - (a.plays ?? 0))
      // Recent: newest first, but float outliers/exploded up
      : [...filteredReels].sort((a, b) =>
          ((b.exploded || b.isOutlier) ? 1 : 0) - ((a.exploded || a.isOutlier) ? 1 : 0) ||
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-white border border-slate-200 rounded-xl p-1 w-fit">
        {([["list", "📋 List"], ["reels", "🎬 Reels"], ["find", "🔎 Find"]] as [CompSubTab, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setSubTab(id)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              subTab === id ? "bg-indigo-600 text-white" : "text-slate-500 hover:text-slate-700"
            }`}>
            {label}
          </button>
        ))}
      </div>

      {subTab === "list" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-700">Competitor Accounts</p>
              <p className="text-xs text-slate-400 mt-0.5">Track what's working in your niche</p>
            </div>
            <div className="flex gap-2">
              {competitors.length > 0 && (
                <button onClick={() => syncProfiles(false)} disabled={syncing}
                  title="Pulls follower/post data for competitors that are new or out of date (won't re-hit the API for ones already synced today)."
                  className="px-3 py-2 text-xs font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 disabled:opacity-50">
                  {syncing ? "Syncing…" : "↻ Sync data"}
                </button>
              )}
              <button onClick={suggestCompetitors} disabled={suggesting}
                className="px-3 py-2 text-xs font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 disabled:opacity-50">
                {suggesting ? "Thinking…" : "✨ Suggest competitors"}
              </button>
              <button onClick={() => setShowAdd(true)}
                className="px-3 py-2 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
                + Add
              </button>
            </div>
          </div>

          {suggestions.length > 0 && (
            <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4">
              <p className="text-xs font-semibold text-indigo-700 mb-2.5">Suggested accounts to track:</p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((handle) => (
                  <button key={handle} onClick={() => { setShowAdd(true); setSuggestions([]); }}
                    className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-indigo-200 rounded-lg text-xs font-medium text-slate-700 hover:border-indigo-400 hover:bg-indigo-50 transition-colors">
                    <span className="text-slate-400">@</span>{handle}
                    <span className="text-indigo-400 text-[10px]">+ add</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {quotaReached && (
            <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <span className="text-amber-500 text-sm mt-0.5">⚠️</span>
              <p className="text-xs text-amber-700 leading-relaxed">
                <span className="font-semibold">Instagram data API quota reached.</span> Follower/post stats can't update
                until the monthly quota resets or the RapidAPI plan is upgraded. Existing data stays as-is in the meantime.
              </p>
            </div>
          )}

          {competitors.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-12 text-center">
              <div className="text-3xl mb-2">🔍</div>
              <p className="text-sm text-slate-500">No competitors tracked yet.</p>
              <p className="text-xs text-slate-400 mt-1">Add handles manually or let AI suggest accounts in your niche.</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                    <th className="px-4 py-3">Account</th>
                    <th className="px-3 py-3 text-right">Followers</th>
                    <th className="px-3 py-3 text-right">Following</th>
                    <th className="px-3 py-3 text-right">Posts</th>
                    <th className="px-4 py-3">Niche</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {competitors.map((c) => (
                    <CompetitorRow key={c.id} competitor={c} onEdit={() => setEditing(c)} onDelete={() => remove(c.id)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {subTab === "reels" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
              {([["recent", "🆕 Recent"], ["best", "🏆 Top"], ["trending", "📈 Trending"]] as ["recent"|"best"|"trending", string][]).map(([id, label]) => (
                <button key={id} onClick={() => setReelSort(id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                    reelSort === id ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  }`}>
                  {label}
                </button>
              ))}
            </div>
            <span className="text-xs text-slate-400">{sortedReels.length} reels</span>
            {lastScraped && (
              <span className="text-[11px] text-slate-400">· updated {timeAgo(lastScraped)}</span>
            )}
            <button onClick={refreshNow} disabled={refreshing}
              className="ml-auto px-3 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50">
              {refreshing ? "Scraping…" : "↻ Refresh now"}
            </button>
          </div>

          {/* Content-format filter (vision-classified) */}
          <div className="flex gap-1.5 flex-wrap">
            {([["all", "All formats"], ["talking_head", "🎙 Talking-head"], ["text_overlay", "📝 Text-overlay"], ["broll", "🎞 B-roll"]] as ["all"|"talking_head"|"text_overlay"|"broll", string][]).map(([id, label]) => (
              <button key={id} onClick={() => setFormatFilter(id)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                  formatFilter === id ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
                }`}>
                {label}
              </button>
            ))}
          </div>

          {sortedReels.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-16 flex flex-col items-center gap-4 text-center">
              <div className="text-3xl">🎬</div>
              <div>
                <p className="text-sm font-semibold text-slate-700">
                  {loadingReels ? "Loading…" : competitors.length === 0 ? "Add competitors first" : "No reels yet"}
                </p>
                <p className="text-xs text-slate-400 mt-1 max-w-sm">
                  {competitors.length === 0
                    ? "Go to the List tab and add competitor accounts to track."
                    : "Reels are scraped twice daily in the background. Hit “Refresh now” to pull the latest immediately."}
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-1.5">
              {sortedReels.map((reel) => (
                <div key={reel.id} className="relative aspect-[9/16] bg-slate-900 rounded-xl overflow-hidden group">
                  <button className="absolute inset-0 w-full h-full" onClick={() => setSelectedReel(reel)}>
                    {reel.thumbnail_url
                      ? <img src={reel.thumbnail_url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                      : <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900">
                          <span className="text-3xl opacity-30">▶</span>
                        </div>
                    }
                    {/* handle (+ exploded badge under it) top-left */}
                    <div className="absolute top-2 left-2 z-10 flex flex-col items-start gap-1">
                      {reel.handle && (
                        <span className="text-[10px] font-semibold text-white bg-black/50 backdrop-blur-sm px-1.5 py-0.5 rounded-full">
                          @{reel.handle}
                        </span>
                      )}
                      {reel.exploded && (
                        <span className="text-[9px] font-bold text-white bg-rose-500 px-1.5 py-0.5 rounded-full shadow"
                          title={reel.growthPct3d != null ? `+${Math.round(reel.growthPct3d)}% views in 3 days` : "Spiking"}>
                          🚀 {reel.viewDelta3d && reel.viewDelta3d > 0 ? `+${fmt(reel.viewDelta3d)}` : "hot"}
                        </span>
                      )}
                      {reel.isOutlier && reel.outlierX != null && (
                        <span className="text-[9px] font-bold text-white bg-amber-500 px-1.5 py-0.5 rounded-full shadow"
                          title="Far above this account's median views — a break-out hit">
                          🔥 {reel.outlierX.toFixed(1)}× avg
                        </span>
                      )}
                    </div>
                    {/* posted date top-right */}
                    {reel.timestamp && (
                      <div className="absolute top-2 right-2 z-10">
                        <span className="bg-black/55 text-white text-[9px] font-semibold px-1.5 py-0.5 rounded-full backdrop-blur-sm">
                          {new Date(reel.timestamp).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
                        </span>
                      </div>
                    )}
                    {/* always-visible gradient + stat chips */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent pointer-events-none" />
                    <div className="absolute bottom-0 left-0 right-0 p-2 flex flex-wrap gap-1">
                      {reel.plays != null && (
                        <span className="flex items-center gap-0.5 bg-indigo-500/90 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full backdrop-blur-sm">▶ {fmt(reel.plays)}</span>
                      )}
                      {reel.like_count > 0 && (
                        <span className="flex items-center gap-0.5 bg-pink-500/90 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full backdrop-blur-sm">♥ {fmt(reel.like_count)}</span>
                      )}
                      {reel.comments_count > 0 && (
                        <span className="flex items-center gap-0.5 bg-slate-600/90 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full backdrop-blur-sm">💬 {fmt(reel.comments_count)}</span>
                      )}
                      {reel.format && reel.format !== "other" && (
                        <span className="flex items-center gap-0.5 bg-white/85 text-slate-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full backdrop-blur-sm">
                          {reel.format === "talking_head" ? "🎙" : reel.format === "text_overlay" ? "📝" : "🎞"}
                        </span>
                      )}
                    </div>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {subTab === "find" && <FinderTab client={client} onAccepted={reload} />}

      {showAdd && <CompetitorModal clientId={client.id} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); reload(); }} />}
      {editing && <CompetitorModal clientId={client.id} competitor={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {selectedReel && <ReelDetailPanel reel={selectedReel} client={client} onClose={() => setSelectedReel(null)} />}
    </div>
  );
}

// ─── Competitor Finder: crawl an account's network for niche peers, review, accept ──
type Candidate = { id: number; handle: string; name: string | null; profilePicUrl: string | null; matched: string | null; gender?: string | null; language?: string | null; bio?: string | null; followerCount?: number | null };

function fmtFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}

function FinderTab({ client, onAccepted }: { client: Client; onAccepted: () => void }) {
  const [seed, setSeed] = useState("");
  const [keyword, setKeyword] = useState("");
  const [goal, setGoal] = useState(100);
  const [gender, setGender] = useState("any");
  const [language, setLanguage] = useState("any");
  const [crawling, setCrawling] = useState(false);
  const [status, setStatus] = useState("");
  const [found, setFound] = useState(0);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [preview, setPreview] = useState<Candidate | null>(null);
  const [enriching, setEnriching] = useState(false);
  const stopRef = useRef(false);
  const enrichRef = useRef(false);

  const loadCandidates = useCallback(async () => {
    const d = await fetch(`/api/competitors/candidates?clientId=${client.id}`).then((r) => r.json());
    setCandidates(Array.isArray(d) ? d : []);
  }, [client.id]);
  useEffect(() => { loadCandidates(); }, [loadCandidates]);

  // Enrichment drip: pulls bio, follower count, a fresh profile pic, and infers
  // gender/language for un-enriched candidates in small batches (off the crawl path → no
  // timeouts). Always runs after a crawl so cards show bio + pic regardless of filters.
  const filterActive = gender !== "any" || language !== "any";
  const runEnrichment = useCallback(async () => {
    if (enrichRef.current) return;
    enrichRef.current = true;
    setEnriching(true);
    try {
      for (let i = 0; i < 60; i++) {
        const d = await fetch("/api/competitors/candidates/enrich", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId: client.id }),
        }).then((r) => r.json()).catch(() => null);
        await loadCandidates();
        if (!d || d.error || d.enriched === 0 || d.remaining === 0) break;
      }
    } finally { enrichRef.current = false; setEnriching(false); }
  }, [client.id, loadCandidates]);
  useEffect(() => {
    if (!enrichRef.current && candidates.some((c) => !c.gender)) runEnrichment();
  }, [candidates, runEnrichment]);

  const shown = candidates.filter((c) =>
    (gender === "any" || c.gender === gender) && (language === "any" || c.language === language)
  );

  async function startCrawl() {
    if (!seed.trim() || crawling) return;
    setCrawling(true); stopRef.current = false; setStatus("Starting…"); setFound(0);
    try {
      const start = await fetch("/api/competitors/find", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "start", clientId: client.id, seed: seed.trim(), keyword: keyword.trim(), goal }),
      }).then((r) => r.json());
      if (start.error) { setStatus("Error: " + start.error); setCrawling(false); return; }
      let queue: string[] = start.queue, seen: string[] = start.seen;
      const keywords: string[] = start.keywords || [];
      setStatus(`Crawling @${seed.trim()}'s niche network…`);
      let lastFound = 0;
      for (let i = 0; i < 120 && !stopRef.current; i++) {
        let step: { error?: string; queue?: string[]; seen?: string[]; found?: number; source?: string; done?: boolean };
        try {
          const res = await fetch("/api/competitors/find", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "step", clientId: client.id, queue, seen, goal, keywords }),
          });
          if (!res.ok) { setStatus(`Hiccup (server ${res.status}) — retrying…`); await new Promise((r) => setTimeout(r, 1500)); continue; }
          step = await res.json();
        } catch {
          setStatus("Network hiccup — retrying…"); await new Promise((r) => setTimeout(r, 1500)); continue;
        }
        if (step.error) { setStatus("Error: " + step.error); break; }
        queue = step.queue || []; seen = step.seen || []; lastFound = step.found || 0; setFound(lastFound);
        setStatus(`Scanning @${step.source ?? "…"} · found ${lastFound}/${goal}`);
        await loadCandidates();
        if (step.done) { setStatus(`✓ Done — found ${lastFound} candidates. Review them below.`); break; }
      }
      if (stopRef.current) setStatus(`Stopped — ${lastFound} candidates so far.`);
    } finally {
      setCrawling(false);
      loadCandidates();
    }
  }

  async function act(c: Candidate, action: "accept" | "reject") {
    const d = await fetch(`/api/competitors/candidates/${c.id}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }).then((r) => r.json());
    setCandidates((prev) => prev.filter((x) => x.id !== c.id));
    setPreview(null);
    if (action === "accept") {
      if (d.competitorId) fetch(`/api/competitors/${d.competitorId}/scrape`, { method: "POST" }).catch(() => {});
      onAccepted();
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
        <div>
          <p className="text-sm font-semibold text-slate-700">Find competitors</p>
          <p className="text-xs text-slate-400 mt-0.5">Give one account in your niche — we pull Instagram's "similar accounts" for it (and theirs, and so on) to surface peers. Review and accept them into your tracked list.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Seed account</label>
            <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden">
              <span className="px-2.5 py-2 bg-slate-50 text-slate-400 text-sm">@</span>
              <input value={seed} onChange={(e) => setSeed(e.target.value.replace("@", ""))} placeholder="someone in your niche"
                className="flex-1 px-2 py-2 text-sm focus:outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Niche keyword <span className="text-slate-300 normal-case">(optional, keeps it on‑niche)</span></label>
            <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="e.g. social media"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Goal</label>
            <input type="number" value={goal} onChange={(e) => setGoal(Math.max(1, Math.min(500, parseInt(e.target.value) || 100)))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          {!crawling ? (
            <button onClick={startCrawl} disabled={!seed.trim()}
              className="px-4 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
              🔎 Start finding
            </button>
          ) : (
            <button onClick={() => { stopRef.current = true; }}
              className="px-4 py-2 text-sm font-semibold bg-red-50 text-red-600 rounded-lg hover:bg-red-100">
              ■ Stop
            </button>
          )}
          {status && <span className="text-xs text-slate-500">{status}</span>}
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm font-semibold text-slate-700">
          Candidates to review · {shown.length}{filterActive && candidates.length !== shown.length ? ` (of ${candidates.length})` : ""}
        </p>
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-[11px] text-slate-400">Filter:</span>
          <select value={gender} onChange={(e) => setGender(e.target.value)}
            className="border border-slate-200 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400">
            <option value="any">Any gender</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
          <select value={language} onChange={(e) => setLanguage(e.target.value)}
            className="border border-slate-200 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400">
            <option value="any">Any language</option>
            <option value="nl">Dutch</option>
            <option value="en">English</option>
            <option value="de">German</option>
            <option value="es">Spanish</option>
            <option value="fr">French</option>
          </select>
          {enriching && <span className="text-[11px] text-indigo-500">classifying…</span>}
        </div>
        {candidates.length > 0 && (
          <button onClick={async () => { if (confirm("Clear all candidates?")) { await fetch(`/api/competitors/candidates?clientId=${client.id}`, { method: "DELETE" }); loadCandidates(); } }}
            className="text-xs text-slate-400 hover:text-red-500">Clear all</button>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-12 text-center text-sm text-slate-400">
          {candidates.length === 0
            ? "No candidates yet. Run a search above."
            : enriching ? "Classifying candidates for your filter…" : "No candidates match the current gender/language filter."}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {shown.map((c) => (
            <div key={c.id} className="bg-white border border-slate-200 rounded-xl p-3 flex flex-col gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {c.profilePicUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={`/api/img?u=${encodeURIComponent(c.profilePicUrl)}`} alt="" className="w-9 h-9 rounded-full object-cover bg-slate-100 flex-shrink-0" />
                  : <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-400 flex-shrink-0">{c.handle.slice(0, 2).toUpperCase()}</div>}
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">@{c.handle}</p>
                  <p className="text-[10px] text-slate-400 truncate">
                    {typeof c.followerCount === "number" ? `${fmtFollowers(c.followerCount)} followers` : (c.matched ? `matched "${c.matched}"` : "")}
                    {(c.gender && c.gender !== "unknown") ? ` · ${c.gender === "male" ? "♂" : "♀"}` : ""}
                    {(c.language && c.language !== "unknown") ? ` · ${c.language.toUpperCase()}` : ""}
                  </p>
                </div>
              </div>
              {c.bio
                ? <p className="text-[11px] leading-snug text-slate-500 line-clamp-3 whitespace-pre-line">{c.bio}</p>
                : <p className="text-[11px] text-slate-300 italic">{enriching ? "loading bio…" : "no bio"}</p>}
              <div className="flex gap-1.5 mt-auto">
                <button onClick={() => setPreview(c)} className="flex-1 py-1.5 text-[11px] font-semibold bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200">👁 View</button>
                <button onClick={() => act(c, "accept")} className="px-2.5 py-1.5 text-[11px] font-semibold bg-green-50 text-green-600 rounded-lg hover:bg-green-100">✓</button>
                <button onClick={() => act(c, "reject")} className="px-2.5 py-1.5 text-[11px] font-semibold bg-red-50 text-red-500 rounded-lg hover:bg-red-100">✕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {preview && <CandidatePreview candidate={preview} onClose={() => setPreview(null)} onAccept={() => act(preview, "accept")} onReject={() => act(preview, "reject")} />}
    </div>
  );
}

function CandidatePreview({ candidate, onClose, onAccept, onReject }: { candidate: Candidate; onClose: () => void; onAccept: () => void; onReject: () => void }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{ profile: { followerCount?: number; postCount?: number; bio?: string } | null; reels: { shortcode: string; thumbnailUrl?: string; mediaUrl?: string | null; permalink?: string; views: number | null; caption: string }[] } | null>(null);
  const [playing, setPlaying] = useState<{ shortcode: string; mediaUrl?: string | null; permalink?: string } | null>(null);
  const [playerUrl, setPlayerUrl] = useState<string | null>(null);
  const [playerLoading, setPlayerLoading] = useState(false);
  useEffect(() => {
    setLoading(true);
    fetch(`/api/competitors/preview?handle=${encodeURIComponent(candidate.handle)}`)
      .then((r) => r.json()).then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [candidate.handle]);

  // When a reel is opened, resolve a fresh playable video url (the reels list only
  // carries thumbnails, so we fetch the video file on demand).
  useEffect(() => {
    if (!playing) { setPlayerUrl(null); setPlayerLoading(false); return; }
    if (playing.mediaUrl) { setPlayerUrl(playing.mediaUrl); setPlayerLoading(false); return; }
    let cancelled = false;
    setPlayerUrl(null); setPlayerLoading(true);
    fetch(`/api/competitors/reel-media?handle=${encodeURIComponent(candidate.handle)}&shortcode=${encodeURIComponent(playing.shortcode)}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setPlayerUrl(d?.url || null); })
      .catch(() => { if (!cancelled) setPlayerUrl(null); })
      .finally(() => { if (!cancelled) setPlayerLoading(false); });
    return () => { cancelled = true; };
  }, [playing, candidate.handle]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white">
          <div className="flex items-center gap-2">
            <a href={`https://instagram.com/${candidate.handle}`} target="_blank" rel="noopener noreferrer" className="text-base font-bold text-slate-800 hover:text-indigo-600">@{candidate.handle}</a>
            {data?.profile?.followerCount != null && <span className="text-xs text-slate-400">{fmt(data.profile.followerCount)} followers</span>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">×</button>
        </div>
        <div className="p-5">
          {data?.profile?.bio && <p className="text-xs text-slate-500 mb-3 whitespace-pre-wrap">{data.profile.bio}</p>}
          {loading ? (
            <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" /></div>
          ) : !data?.reels?.length ? (
            <p className="text-sm text-slate-400 text-center py-8">No reels found (private or no recent reels).</p>
          ) : (
            <div className="grid grid-cols-3 gap-1.5">
              {data.reels.map((r) => {
                const isPlaying = playing?.shortcode === r.shortcode;
                return (
                  <div key={r.shortcode} className="relative aspect-[9/16] bg-slate-900 rounded-lg overflow-hidden group">
                    {isPlaying ? (
                      playerLoading ? (
                        <div className="w-full h-full flex items-center justify-center">
                          <div className="w-6 h-6 border-2 border-white/70 border-t-transparent rounded-full animate-spin" />
                        </div>
                      ) : playerUrl ? (
                        // eslint-disable-next-line jsx-a11y/media-has-caption
                        <video src={`/api/vid?u=${encodeURIComponent(playerUrl)}`} controls autoPlay playsInline className="w-full h-full object-contain bg-black" />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-2 px-2 text-center">
                          <p className="text-white/60 text-[10px]">Couldn&apos;t load</p>
                          <a href={r.permalink || `https://instagram.com/reel/${r.shortcode}`} target="_blank" rel="noopener noreferrer" className="bg-white/90 text-slate-800 text-[10px] font-semibold px-2 py-1 rounded-full">Open on IG ↗</a>
                        </div>
                      )
                    ) : (
                      <button type="button" onClick={() => setPlaying(r)} className="w-full h-full block">
                        {r.thumbnailUrl
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={r.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center text-2xl opacity-30">▶</div>}
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
                          <span className="w-9 h-9 rounded-full bg-white/90 text-slate-900 flex items-center justify-center text-sm shadow">▶</span>
                        </div>
                        {r.views != null && <span className="absolute bottom-1 left-1 bg-indigo-500/90 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">▶ {fmt(r.views)}</span>}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="px-5 py-4 border-t border-slate-100 flex gap-2 sticky bottom-0 bg-white">
          <button onClick={onReject} className="flex-1 py-2.5 text-sm font-semibold bg-red-50 text-red-600 rounded-xl hover:bg-red-100">✕ Reject</button>
          <button onClick={onAccept} className="flex-1 py-2.5 text-sm font-semibold bg-green-600 text-white rounded-xl hover:bg-green-700">✓ Accept as competitor</button>
        </div>
      </div>
    </div>
  );
}


function CompetitorRow({ competitor: c, onEdit, onDelete }: { competitor: Competitor; onEdit: () => void; onDelete: () => void }) {
  const url = c.profileUrl || `https://instagram.com/${c.handle}`;
  return (
    <tr className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60 transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          {c.profilePicUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.profilePicUrl} alt="" className="w-9 h-9 rounded-full object-cover flex-shrink-0 bg-slate-100" />
          ) : (
            <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 text-xs font-bold flex-shrink-0">
              {c.handle.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-slate-800 hover:text-indigo-600 truncate">@{c.handle}</a>
              {c.verified && <span className="text-blue-500 text-xs" title="Verified">✔</span>}
            </div>
            {c.name && <p className="text-xs text-slate-400 truncate max-w-[220px]">{c.name}</p>}
          </div>
        </div>
      </td>
      <td className="px-3 py-3 text-right font-semibold text-slate-700 tabular-nums">{c.followerCount != null ? fmt(c.followerCount) : "—"}</td>
      <td className="px-3 py-3 text-right text-slate-500 tabular-nums">{c.followingCount != null ? fmt(c.followingCount) : "—"}</td>
      <td className="px-3 py-3 text-right text-slate-500 tabular-nums">{c.postCount != null ? fmt(c.postCount) : "—"}</td>
      <td className="px-4 py-3">
        {c.niche ? (
          <div className="flex flex-wrap gap-1">
            {c.niche.split(",").slice(0, 3).map((n) => (
              <span key={n} className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] rounded-full font-medium">{n.trim()}</span>
            ))}
          </div>
        ) : <span className="text-slate-300">—</span>}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1.5">
          <a href={url} target="_blank" rel="noopener noreferrer"
            className="px-2.5 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100">View ↗</a>
          <button onClick={onEdit} className="px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200">Edit</button>
          <button onClick={onDelete} className="px-2.5 py-1.5 text-xs font-medium text-red-500 bg-red-50 rounded-lg hover:bg-red-100">✕</button>
        </div>
      </td>
    </tr>
  );
}

function CompetitorModal({ clientId, competitor, onClose, onSaved }: {
  clientId: number; competitor?: Competitor; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    handle: competitor?.handle || "",
    name: competitor?.name || "",
    niche: competitor?.niche || "",
    followerCount: competitor?.followerCount?.toString() || "",
    notes: competitor?.notes || "",
    profileUrl: competitor?.profileUrl || "",
  });
  function set(k: string, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  const [saving, setSaving] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const method = competitor ? "PUT" : "POST";
      const url = competitor ? `/api/competitors/${competitor.id}` : "/api/competitors";
      const saved = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, clientId }) }).then((r) => r.json());
      // New competitor → kick a background pull of its data (don't await; the row
      // appears instantly and reels fill in shortly after).
      if (!competitor && saved?.id) {
        fetch(`/api/competitors/${saved.id}/scrape`, { method: "POST" }).catch(() => {});
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={competitor ? "Edit Competitor" : "Add Competitor"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Instagram Handle *</label>
          <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500">
            <span className="px-3 py-2 bg-slate-50 text-slate-400 text-sm border-r border-slate-200">@</span>
            <input required value={form.handle} onChange={(e) => set("handle", e.target.value.replace("@", ""))}
              placeholder="username" className="flex-1 px-3 py-2 text-sm focus:outline-none" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
            <input value={form.name} onChange={(e) => set("name", e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Followers</label>
            <input type="number" value={form.followerCount} onChange={(e) => set("followerCount", e.target.value)}
              placeholder="e.g. 45000"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Niche / Tags <span className="text-slate-300 font-normal">(comma separated)</span></label>
          <input value={form.niche} onChange={(e) => set("niche", e.target.value)}
            placeholder="e.g. fitness, online coaching"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">What's working for them?</label>
          <textarea rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            {saving ? "Saving…" : competitor ? "Save Changes" : "Add Competitor"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ReelDetailPanel({ reel, client, onClose, attachConcept }: { reel: IGReel; client: Client; onClose: () => void; attachConcept?: { id: number; name: string } | null }) {
  const storageKey = `reel_transcript_${reel.id}`;
  const clearedKey = `reel_transcript_cleared_${reel.id}`;
  const [transcript, setTranscript] = useState<string | null>(() => {
    try { return localStorage.getItem(storageKey); } catch { return null; }
  });
  // Set when the user explicitly clears the transcript — stops auto-transcribe
  // (on save / open concept) from silently re-adding it.
  const [cleared, setCleared] = useState<boolean>(() => {
    try { return localStorage.getItem(clearedKey) === "1"; } catch { return false; }
  });
  const [transcribing, setTranscribing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [attachState, setAttachState] = useState<"idle" | "saving" | "added">("idle");

  // Add this reel to the active concept group (attach mode)
  async function addToConceptGroup() {
    if (!attachConcept) return;
    setAttachState("saving");
    const url = reel.permalink || `https://instagram.com/reel/${reel.id}`;
    try {
      const concept = await fetch(`/api/concepts/${attachConcept.id}`).then((r) => r.json()).catch(() => null);
      let current: string[] = [];
      try { current = JSON.parse(concept?.reelUrls || "[]"); } catch { current = []; }
      if (!current.includes(url)) current.push(url);
      await fetch(`/api/concepts/${attachConcept.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reelUrls: current }),
      });
      // Pull this reel's on-screen text into the concept's examples (background).
      fetch(`/api/concepts/${attachConcept.id}/extract-examples`, { method: "POST" }).catch(() => {});
      setAttachState("added");
    } catch { setAttachState("idle"); }
  }
  const [showConceptModal, setShowConceptModal] = useState(false);
  const [existingConcepts, setExistingConcepts] = useState<any[]>([]);
  const [conceptInitial, setConceptInitial] = useState<any>(null);

  // Link this reel into an EXISTING concept's reel group
  const [showLinkPicker, setShowLinkPicker] = useState(false);
  const [linkConcepts, setLinkConcepts] = useState<any[]>([]);
  const [linkBusy, setLinkBusy] = useState<number | null>(null);
  const [linkedTo, setLinkedTo] = useState<string | null>(null);
  const reelLink = reel.permalink || reel.instagramUrl || (reel.id ? `https://instagram.com/reel/${reel.id}` : "");

  // ── Translate transcript + send competitor reel to Script Kanban as an idea ──
  const [translating, setTranslating] = useState(false);
  const [showKanbanPicker, setShowKanbanPicker] = useState(false);
  const [kanbanConcepts, setKanbanConcepts] = useState<any[]>([]);
  const [kanbanBusy, setKanbanBusy] = useState<number | null>(null);
  const [sentToKanban, setSentToKanban] = useState<string | null>(null);

  async function translateToDutch() {
    if (!transcript || !transcript.trim()) { alert("Transcribe first, then translate."); return; }
    setTranslating(true);
    try {
      const d = await fetch("/api/translate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: transcript, target: "Dutch" }),
      }).then((r) => r.json());
      if (d.text) {
        setTranscript(d.text);
        setCleared(false);
        try { localStorage.setItem(storageKey, d.text); localStorage.removeItem(clearedKey); } catch { /* ignore */ }
      } else alert("Translation failed: " + (d.error || "unknown"));
    } catch { alert("Translation failed."); }
    finally { setTranslating(false); }
  }

  async function openKanbanPicker() {
    if (!transcript || !transcript.trim()) { alert("Transcribe (and translate) first, then send to Kanban."); return; }
    setShowKanbanPicker(true);
    try {
      const cs = await fetch(`/api/concepts?clientId=${client.id}`).then((r) => r.json());
      setKanbanConcepts((Array.isArray(cs) ? cs : []).filter((c: any) => !c.isIdea));
    } catch { setKanbanConcepts([]); }
  }

  async function sendToKanban(c: any) {
    setKanbanBusy(c.id);
    try {
      const d = await fetch("/api/competitors/to-kanban", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reelId: reel.id, clientId: client.id, conceptId: c.id, script: transcript }),
      }).then((r) => r.json());
      if (d.ok) {
        setSentToKanban(c.conceptType ? `${c.conceptType} · ${c.name}` : c.name);
        setShowKanbanPicker(false);
      } else alert("Failed to send to Kanban: " + (d.error || "unknown"));
    } finally { setKanbanBusy(null); }
  }

  async function openLinkPicker() {
    setShowLinkPicker(true);
    try {
      const cs = await fetch(`/api/concepts?clientId=${client.id}`).then((r) => r.json());
      setLinkConcepts((Array.isArray(cs) ? cs : []).filter((c: any) => !c.isIdea));
    } catch { setLinkConcepts([]); }
  }

  async function linkToConcept(c: any) {
    if (!reelLink) return;
    setLinkBusy(c.id);
    try {
      const full = await fetch(`/api/concepts/${c.id}`).then((r) => r.json()).catch(() => null);
      let urls: string[] = [];
      try { urls = JSON.parse(full?.reelUrls || "[]"); } catch { urls = []; }
      if (!urls.includes(reelLink)) urls.push(reelLink);
      await fetch(`/api/concepts/${c.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reelUrls: urls }),
      });
      fetch(`/api/concepts/${c.id}/extract-examples`, { method: "POST" }).catch(() => {});
      setLinkedTo(c.conceptType ? `${c.conceptType} · ${c.name}` : c.name);
      setShowLinkPicker(false);
    } finally {
      setLinkBusy(null);
    }
  }

  // Transcribe (if needed) + load the client's concepts, then open the New Concept form.
  // For B-roll/text reels (no speech) we read the on-screen text overlay via vision instead.
  async function openConceptForm() {
    setSaving(true);
    // Whisper hallucinates "thanks for watching" etc. on silent/music b-roll audio.
    // Ignore a cached hallucinated transcript so the on-screen-text path can run.
    const isHallucination = (s: string | null) =>
      /^(thank(s| you)( so much)?( for watching)?|please subscribe|like and subscribe|don'?t forget to subscribe|see you( next time| in the next video)?|bye|you|music|\[music( playing)?\]|♪+)[.!?\s]*$/i
        .test((s || "").trim());
    let t = isHallucination(transcript) ? "" : transcript;
    if (!t && !cleared && reel.media_url) {
      try {
        const res = await fetch("/api/instagram/transcribe", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mediaUrl: reel.media_url }),
        });
        const data = await res.json();
        if (!data.error) { t = data.transcript || ""; setTranscript(t); try { localStorage.setItem(storageKey, t!); } catch {} }
      } catch {/* ignore */}
    }

    // No meaningful speech → likely a B-roll + text-overlay reel. Read the on-screen text.
    const isTextOverlay = (t ?? "").trim().length < 40;
    let overlayText = "";
    if (isTextOverlay && reel.thumbnail_url) {
      try {
        const r = await fetch("/api/instagram/read-text", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageUrl: reel.thumbnail_url }),
        });
        const d = await r.json();
        overlayText = (d.text || "").trim();
      } catch {/* ignore */}
    }

    try {
      const cs = await fetch(`/api/concepts?clientId=${client.id}`).then((r) => r.json());
      setExistingConcepts(Array.isArray(cs) ? cs : []);
    } catch {/* ignore */}

    setConceptInitial({
      exampleUrl: reel.permalink || `https://instagram.com/reel/${reel.id}`,
      reelUrls: [reel.permalink || `https://instagram.com/reel/${reel.id}`],
      scriptExamples: isTextOverlay ? overlayText : (t || ""),
      textOverlay: isTextOverlay,
    });
    setSaving(false);
    setShowConceptModal(true);
  }

  async function transcribe() {
    setTranscribing(true);
    try {
      // Competitor reels don't carry a usable stored media_url (IG CDN links expire),
      // so resolve a fresh playable URL the same way the player does.
      let videoUrl: string | null = reel.media_url || null;
      if (reel.handle && reel.id) {
        const d = await fetch(`/api/competitors/reel-media?id=${reel.id}`).then((r) => r.json()).catch(() => ({}));
        if (d.url) videoUrl = d.url;
      }
      if (!videoUrl) {
        setTranscript("No video URL available for this reel.");
        setTranscribing(false);
        return;
      }
      const res = await fetch("/api/instagram/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaUrl: videoUrl }),
      });
      const data = await res.json();
      const text = data.error ? `Error: ${data.error}` : (data.transcript || "No speech detected.");
      setTranscript(text);
      setCleared(false);
      if (!data.error) {
        try { localStorage.setItem(storageKey, text); localStorage.removeItem(clearedKey); } catch { /* ignore */ }
      }
    } catch {
      setTranscript("Transcription failed. Please try again.");
    }
    setTranscribing(false);
  }

  function clearTranscript() {
    setTranscript("");
    setCleared(true);
    try { localStorage.removeItem(storageKey); localStorage.setItem(clearedKey, "1"); } catch { /* ignore */ }
  }

  async function saveAsConcept(asIdea: boolean) {
    setSaving(true);
    let finalTranscript = transcript;
    if (!finalTranscript && !cleared && reel.media_url) {
      try {
        const res = await fetch("/api/instagram/transcribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mediaUrl: reel.media_url }),
        });
        const data = await res.json();
        if (!data.error) {
          finalTranscript = data.transcript || "";
          setTranscript(finalTranscript);
          try { localStorage.setItem(storageKey, finalTranscript!); } catch { /* ignore */ }
        }
      } catch { /* save without transcript */ }
    }
    await fetch("/api/concepts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: client.id,
        name: reel.caption?.slice(0, 80) || `Reel ${new Date(reel.timestamp).toLocaleDateString()}`,
        exampleUrl: `https://instagram.com/reel/${reel.id}`,
        notes: [
          reel.plays != null ? `Views: ${fmt(reel.plays)}` : null,
          reel.reach != null ? `Reach: ${fmt(reel.reach)}` : null,
          `Likes: ${fmt(reel.like_count)}`,
          reel.saved != null ? `Saved: ${fmt(reel.saved)}` : null,
        ].filter(Boolean).join(" · "),
        scriptExamples: finalTranscript || "",
        isIdea: asIdea,
      }),
    });
    setSaving(false);
    setSaved(true);
  }

  const plays = reel.plays ?? 0;
  const likeRate   = plays > 0 ? ((reel.like_count / plays) * 100).toFixed(1) : null;
  const saveRate   = plays > 0 && reel.saved   != null ? ((reel.saved   / plays) * 100).toFixed(1) : null;
  const shareRate  = plays > 0 && reel.shares  != null ? ((reel.shares  / plays) * 100).toFixed(1) : null;
  const commentRate= plays > 0 ? ((reel.comments_count / plays) * 100).toFixed(1) : null;
  const avgWatchSec   = reel.avgWatchTime   != null ? (reel.avgWatchTime / 1000).toFixed(1) : null;
  const totalWatchMin = reel.totalWatchTime != null ? Math.round(reel.totalWatchTime / 60000) : null;
  const skipRatePct   = reel.skipRate       != null ? reel.skipRate.toFixed(1) : null;

  const primaryStats = [
    { label: "Views",       value: reel.plays,             icon: "▶",  color: "bg-indigo-50 text-indigo-700" },
    { label: "Reach",       value: reel.reach,              icon: "👁", color: "bg-sky-50 text-sky-700" },
    { label: "Likes",       value: reel.like_count,         icon: "♥",  color: "bg-pink-50 text-pink-700" },
    { label: "Saves",       value: reel.saved,              icon: "🔖", color: "bg-amber-50 text-amber-700" },
    { label: "Shares",      value: reel.shares,             icon: "↗",  color: "bg-teal-50 text-teal-700" },
    { label: "Comments",    value: reel.comments_count,     icon: "💬", color: "bg-slate-50 text-slate-700" },
    { label: "Reposts",     value: reel.reposts,            icon: "🔁", color: "bg-green-50 text-green-700" },
    { label: "Interactions",value: reel.totalInteractions,  icon: "⚡", color: "bg-violet-50 text-violet-700" },
  ];

  const rateStats = [
    { label: "Skip rate",    value: skipRatePct,                                              suffix: "%" },
    { label: "Like rate",    value: likeRate,                                                 suffix: "%" },
    { label: "Save rate",    value: saveRate,                                                 suffix: "%" },
    { label: "Share rate",   value: shareRate,                                                suffix: "%" },
    { label: "Comment rate", value: commentRate,                                              suffix: "%" },
    { label: "Avg watch",    value: avgWatchSec,                                              suffix: "s" },
    { label: "Total watch",  value: totalWatchMin != null ? fmt(totalWatchMin) : null,        suffix: "m" },
  ].filter(s => s.value != null);

  const [mounted, setMounted] = useState(false);
  useEffect(() => { const t = setTimeout(() => setMounted(true), 10); return () => clearTimeout(t); }, []);

  // Competitor reels: their stored CDN url is expired — fetch a fresh one to play directly.
  const isCompetitorReel = !!reel.handle;
  const [compUrl, setCompUrl] = useState<string | null>(null);
  const [compLoading, setCompLoading] = useState(false);
  const [compTriedRefresh, setCompTriedRefresh] = useState(false);
  useEffect(() => {
    if (!isCompetitorReel || !reel.id) return;
    let cancelled = false;
    setCompLoading(true);
    fetch(`/api/competitors/reel-media?id=${reel.id}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled && d.url) setCompUrl(d.url); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setCompLoading(false); });
    return () => { cancelled = true; };
  }, [isCompetitorReel, reel.id]);

  // If a cached URL is stale/dead the <video> errors — fetch a guaranteed-fresh
  // one once (this is the only path that spends an API request on playback).
  function refreshCompUrl() {
    if (compTriedRefresh || !reel.id) return;
    setCompTriedRefresh(true);
    setCompUrl(null);
    setCompLoading(true);
    fetch(`/api/competitors/reel-media?id=${reel.id}&refresh=1`)
      .then((r) => r.json())
      .then((d) => { if (d.url) setCompUrl(d.url); })
      .catch(() => {})
      .finally(() => setCompLoading(false));
  }

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/40" onClick={onClose}>
      <div
        className={`w-[520px] h-full bg-white flex flex-col shadow-2xl overflow-hidden transform transition-transform duration-300 ease-out ${mounted ? "translate-x-0" : "translate-x-full"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold text-white" style={{ backgroundColor: client.color }}>
              {client.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-700">{client.name}</p>
              <p className="text-[10px] text-slate-400">{new Date(reel.timestamp).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", year: "numeric" })}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="relative bg-slate-900 aspect-[9/16] max-h-72 w-full flex items-center justify-center overflow-hidden">
            {(() => {
              const igLink = reel.permalink || reel.instagramUrl || (reel.id ? `https://www.instagram.com/reel/${reel.id}/` : null);
              const isCompetitor = !!reel.handle;
              // Competitor reels: play the freshly-fetched CDN url directly in the browser.
              if (isCompetitor && reel.id) {
                if (compUrl) {
                  return <video key={compUrl} src={compUrl} poster={reel.thumbnail_url} controls autoPlay playsInline
                    onError={refreshCompUrl}
                    className="w-full h-full object-contain" />;
                }
                // still fetching the fresh url, or it failed → show thumbnail (+ spinner)
                return (
                  <div className="relative w-full h-full">
                    {reel.thumbnail_url
                      ? <img src={reel.thumbnail_url} alt="" className="w-full h-full object-cover" />
                      : <div className="w-full h-full bg-gradient-to-br from-slate-800 to-slate-900" />}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                      {compLoading
                        ? <div className="w-7 h-7 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                        : igLink && <a href={igLink} target="_blank" rel="noopener noreferrer" className="flex flex-col items-center gap-1.5 text-white">
                            <span className="text-4xl">▶</span>
                            <span className="text-xs font-medium opacity-90">Watch on Instagram ↗</span>
                          </a>}
                    </div>
                  </div>
                );
              }
              if (reel.media_url) {
                return <video src={reel.media_url} poster={reel.thumbnail_url} controls className="w-full h-full object-contain" />;
              }
              if (igLink) {
                return (
                  <a href={igLink} target="_blank" rel="noopener noreferrer" className="relative w-full h-full flex items-center justify-center group">
                    {reel.thumbnail_url
                      ? <img src={reel.thumbnail_url} alt="" className="w-full h-full object-cover" />
                      : <div className="w-full h-full bg-gradient-to-br from-slate-800 to-slate-900" />}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/40 transition-colors">
                      <div className="flex flex-col items-center gap-1.5">
                        <span className="text-4xl">▶</span>
                        <p className="text-white text-xs font-medium opacity-90">Watch on Instagram ↗</p>
                      </div>
                    </div>
                  </a>
                );
              }
              return reel.thumbnail_url
                ? <img src={reel.thumbnail_url} alt="" className="w-full h-full object-cover" />
                : <div className="flex flex-col items-center gap-2 text-slate-600">
                    <span className="text-4xl opacity-20">▶</span>
                    <p className="text-xs opacity-40">No preview available</p>
                  </div>;
            })()}
          </div>
          {reel.handle && (reel.permalink || reel.id) && (
            <a href={reel.permalink || `https://www.instagram.com/reel/${reel.id}/`} target="_blank" rel="noopener noreferrer"
              className="block text-center text-[11px] text-indigo-500 hover:text-indigo-700 py-1.5 border-b border-slate-100">
              Doesn't play? Watch on Instagram ↗
            </a>
          )}
          <div className="p-5 space-y-5">
            {reel.caption && (
              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Caption</p>
                <p className="text-sm text-slate-700 leading-relaxed">{reel.caption}</p>
              </div>
            )}
            <div>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2.5">Analytics</p>
              {/* Primary counts */}
              <div className="grid grid-cols-4 gap-1.5 mb-2">
                {primaryStats.filter(s => s.value != null).map(({ label, value, icon, color }) => (
                  <div key={label} className={`rounded-xl p-2.5 text-center ${color}`}>
                    <p className="text-[10px] font-medium opacity-70 mb-0.5">{icon} {label}</p>
                    <p className="text-sm font-bold">{fmt(value as number)}</p>
                  </div>
                ))}
              </div>
              {/* Engagement rates */}
              {rateStats.length > 0 && (
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-[10px] font-semibold text-slate-400 mb-2">Engagement rates</p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {rateStats.map(({ label, value, suffix }) => (
                      <div key={label} className="text-center">
                        <p className="text-[9px] text-slate-400 mb-0.5">{label}</p>
                        <p className="text-xs font-bold text-slate-700">{value}{suffix}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Transcript</p>
                {transcript
                  ? <div className="flex items-center gap-3">
                      <button onClick={translateToDutch} disabled={translating || transcribing} className="text-xs font-medium text-orange-600 hover:text-orange-800 disabled:opacity-50">
                        {translating ? "Translating…" : "🇳🇱 To Dutch"}
                      </button>
                      <button onClick={transcribe} disabled={transcribing} className="text-xs font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50">
                        {transcribing ? "Transcribing…" : "↻ Redo"}
                      </button>
                      <button onClick={clearTranscript} disabled={transcribing} className="text-xs font-medium text-red-500 hover:text-red-700 disabled:opacity-50">
                        ✕ Clear
                      </button>
                    </div>
                  : <button onClick={transcribe} disabled={transcribing} className="text-xs font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50">
                      {transcribing ? "Transcribing…" : "↯ Auto-transcribe"}
                    </button>
                }
              </div>
              {transcript
                ? <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3.5 text-sm text-slate-700 leading-relaxed max-h-40 overflow-y-auto">{transcript}</div>
                : <div className="bg-slate-50 border border-dashed border-slate-200 rounded-xl p-4 text-center">
                    {transcribing
                      ? <div className="flex flex-col items-center gap-2">
                          <div className="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                          <p className="text-xs text-slate-400">Transcribing audio…</p>
                        </div>
                      : <p className="text-xs text-slate-400">Click to auto-transcribe via Whisper</p>
                    }
                  </div>
              }
            </div>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-slate-100 flex-shrink-0 space-y-2.5">
          {/* Competitor reel → send straight into Script Kanban as an idea, with the
              IG video attached as the example to copy. */}
          {reel.handle && (
            sentToKanban ? (
              <div className="w-full py-2.5 rounded-xl text-sm font-semibold bg-green-100 text-green-700 text-center">
                ✓ Added to Kanban ideas · {sentToKanban}
              </div>
            ) : (
              <button onClick={openKanbanPicker}
                className="w-full py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700">
                ➡️ Send to Script Kanban (idea)
              </button>
            )
          )}
          <div className="flex gap-2.5">
          {attachConcept ? (
            <button onClick={addToConceptGroup} disabled={attachState !== "idle"}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors ${attachState === "added" ? "bg-green-100 text-green-700" : "bg-indigo-600 text-white hover:bg-indigo-700"} disabled:opacity-70`}>
              {attachState === "added" ? `✓ Added to ${attachConcept.name}` : attachState === "saving" ? "Adding…" : `➕ Add to "${attachConcept.name}"`}
            </button>
          ) : saved ? (
            <div className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-green-100 text-green-700 text-center">✓ Saved</div>
          ) : linkedTo ? (
            <div className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-green-100 text-green-700 text-center">✓ Linked to {linkedTo}</div>
          ) : (
            <>
              <button onClick={() => saveAsConcept(true)} disabled={saving}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-60">
                {saving ? "Saving…" : "💡 Save as Idea"}
              </button>
              <button onClick={openConceptForm} disabled={saving}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60">
                {saving ? "Preparing…" : "✅ Save as Concept"}
              </button>
              <button onClick={openLinkPicker} disabled={saving} title="Add this reel to an existing concept's group"
                className="px-3 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-60">
                🔗 Link
              </button>
            </>
          )}
          {reel.media_url && (
            <a href={reel.media_url} target="_blank" rel="noopener noreferrer"
              className="px-4 py-2.5 rounded-xl text-sm font-medium bg-slate-100 text-slate-600 hover:bg-slate-200">
              Open ↗
            </a>
          )}
          </div>
        </div>
      </div>
    </div>

    {showLinkPicker && (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={() => setShowLinkPicker(false)}>
        <div className="w-[420px] max-h-[70vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
          <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
            <p className="text-sm font-bold text-slate-800">🔗 Link reel to a concept</p>
            <button onClick={() => setShowLinkPicker(false)} className="text-slate-400 hover:text-slate-600">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {linkConcepts.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-8">No concepts yet for this client.</p>
            ) : linkConcepts.map((c: any) => (
              <button key={c.id} onClick={() => linkToConcept(c)} disabled={linkBusy === c.id}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-left hover:bg-indigo-50 disabled:opacity-60">
                <span className="text-sm text-slate-700">
                  {c.conceptType && <span className="text-slate-400">{c.conceptType} · </span>}
                  <span className="font-medium">{c.name}</span>
                </span>
                <span className="text-[10px] text-slate-400">{linkBusy === c.id ? "Linking…" : (() => { try { return `📎 ${JSON.parse(c.reelUrls || "[]").length}`; } catch { return ""; } })()}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    )}

    {showKanbanPicker && (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={() => setShowKanbanPicker(false)}>
        <div className="w-[420px] max-h-[70vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
          <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-slate-800">➡️ Send to Kanban — pick a concept</p>
              <p className="text-[11px] text-slate-400 mt-0.5">Creates an idea with this script + the IG video as the example.</p>
            </div>
            <button onClick={() => setShowKanbanPicker(false)} className="text-slate-400 hover:text-slate-600">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {kanbanConcepts.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-8">No concepts yet for this client. Add one in the Concept Library first.</p>
            ) : kanbanConcepts.map((c: any) => (
              <button key={c.id} onClick={() => sendToKanban(c)} disabled={kanbanBusy === c.id}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-left hover:bg-indigo-50 disabled:opacity-60">
                <span className="text-sm text-slate-700">
                  {c.conceptType && <span className="text-slate-400">{c.conceptType} · </span>}
                  <span className="font-medium">{c.name}</span>
                </span>
                <span className="text-[10px] text-slate-400">{kanbanBusy === c.id ? "Sending…" : "→ Ideas"}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    )}

    {showConceptModal && (
      <ConceptModal
        clients={[client]}
        selectedClientId={client.id}
        existingConcepts={existingConcepts.map((c: any) => ({ conceptType: c.conceptType, name: c.name }))}
        initial={conceptInitial || {
          exampleUrl: reel.permalink || `https://instagram.com/reel/${reel.id}`,
          reelUrls: [reel.permalink || `https://instagram.com/reel/${reel.id}`],
          scriptExamples: transcript || "",
        }}
        onClose={() => setShowConceptModal(false)}
        onSaved={() => { setShowConceptModal(false); setSaved(true); }}
      />
    )}
    </>
  );
}
