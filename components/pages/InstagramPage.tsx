"use client";

import { useState, useEffect, useCallback } from "react";
import { Client, Competitor } from "@/lib/types";
import Modal from "@/components/ui/Modal";

type Props = {
  clients: Client[];
  selectedClientId: number | null;
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
  handle?: string; // for competitor reels
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

type Tab = "reels" | "competitors";

export default function InstagramPage({ clients, selectedClientId }: Props) {
  const client = clients.find((c) => c.id === selectedClientId) ?? null;
  const [tab, setTab] = useState<Tab>("reels");
  const [profile, setProfile] = useState<IGProfile | null>(null);
  const [reels, setReels] = useState<IGReel[]>([]);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [loadingReels, setLoadingReels] = useState(false);
  const [selected, setSelected] = useState<IGReel | null>(null);
  const [connected, setConnected] = useState(false);

  const fetchProfile = useCallback(async () => {
    if (!client) return;
    setLoadingProfile(true);
    try {
      const res = await fetch(`/api/instagram/profile?clientId=${client.id}`);
      if (res.ok) {
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
    try {
      const res = await fetch(`/api/instagram/media?clientId=${client.id}`);
      if (res.ok) setReels(await res.json());
    } catch {/* ignore */}
    setLoadingReels(false);
  }, [client, connected]);

  useEffect(() => {
    setProfile(null);
    setReels([]);
    setConnected(false);
    fetchProfile();
  }, [fetchProfile]);

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
        connected
          ? loadingReels
            ? <div className="flex items-center justify-center h-40 text-slate-400 text-sm">Loading reels…</div>
            : reels.length > 0
              ? <>
                  <ReelsGrid reels={reels} onSelect={setSelected} />
                  {selected && <ReelDetailPanel reel={selected} client={client} onClose={() => setSelected(null)} />}
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

function ReelsGrid({ reels, onSelect }: { reels: IGReel[]; onSelect: (r: IGReel) => void }) {
  const [sort, setSort] = useState<"recent" | "best">("recent");

  const sorted = sort === "best"
    ? [...reels].sort((a, b) => (b.plays ?? b.like_count ?? 0) - (a.plays ?? a.like_count ?? 0))
    : reels;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Reels · {reels.length}</p>
        <button
          onClick={() => setSort(sort === "recent" ? "best" : "recent")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
            sort === "best"
              ? "bg-amber-400 text-white"
              : "bg-slate-100 text-slate-500 hover:bg-slate-200"
          }`}
        >
          🏆 {sort === "best" ? "Best Performing" : "Best Performing"}
        </button>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {sorted.map((reel) => (
          <button key={reel.id} onClick={() => onSelect(reel)}
            className="relative aspect-[9/16] bg-slate-900 rounded-xl overflow-hidden group">
            {reel.thumbnail_url
              ? <img src={reel.thumbnail_url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
              : <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900">
                  <span className="text-3xl opacity-30">▶</span>
                </div>
            }
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
            <div className="absolute bottom-0 left-0 right-0 p-2.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
              <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                <div className="flex items-center gap-1 text-white text-[11px] font-semibold">
                  <span className="opacity-70">▶</span>
                  <span>{reel.plays != null ? fmt(reel.plays) : "—"}</span>
                </div>
                <div className="flex items-center gap-1 text-white text-[11px] font-semibold">
                  <span className="opacity-70">♥</span>
                  <span>{fmt(reel.like_count)}</span>
                </div>
                <div className="flex items-center gap-1 text-white text-[11px] font-semibold">
                  <span className="opacity-70">🔖</span>
                  <span>{reel.saved != null ? fmt(reel.saved) : "—"}</span>
                </div>
                <div className="flex items-center gap-1 text-white text-[11px] font-semibold">
                  <span className="opacity-70">💬</span>
                  <span>{fmt(reel.comments_count)}</span>
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

type CompSubTab = "list" | "reels";
type TimeFilter = "7" | "14" | "30" | "90" | "all";

function CompetitorsTab({ client }: { client: Client }) {
  const [subTab, setSubTab] = useState<CompSubTab>("list");
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Competitor | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  // Reels sub-tab state
  const [allReels, setAllReels] = useState<IGReel[]>([]);
  const [fetchErrors, setFetchErrors] = useState<{ handle: string; error: string }[]>([]);
  const [loadingReels, setLoadingReels] = useState(false);
  const [reelsFetched, setReelsFetched] = useState(false);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [reelSort, setReelSort] = useState<"recent" | "best">("recent");
  const [selectedReel, setSelectedReel] = useState<IGReel | null>(null);

  const reload = useCallback(async () => {
    const data = await fetch(`/api/competitors?clientId=${client.id}`).then((r) => r.json());
    setCompetitors(data);
    setReelsFetched(false);
    setAllReels([]);
  }, [client.id]);

  useEffect(() => { reload(); }, [reload]);

  async function remove(id: number) {
    if (!confirm("Remove this competitor?")) return;
    await fetch(`/api/competitors/${id}`, { method: "DELETE" });
    reload();
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

  async function fetchAllReels() {
    if (competitors.length === 0) return;
    setLoadingReels(true);
    setAllReels([]);
    setFetchErrors([]);
    const results = await Promise.allSettled(
      competitors.map(async (c) => {
        const res = await fetch(`/api/instagram/competitor-reels?clientId=${client.id}&handle=${encodeURIComponent(c.handle)}`);
        const data = await res.json();
        if (data.error) return { handle: c.handle, reels: [], error: data.error as string };
        return { handle: c.handle, reels: (data.reels || []).map((r: IGReel) => ({ ...r, handle: c.handle })), error: null };
      })
    );
    const reels = results.flatMap((r) => r.status === "fulfilled" ? r.value.reels : []);
    const errors = results.flatMap((r) => r.status === "fulfilled" && r.value.error ? [{ handle: r.value.handle, error: r.value.error }] : []);
    setAllReels(reels);
    setFetchErrors(errors);
    setLoadingReels(false);
    setReelsFetched(true);
  }

  useEffect(() => {
    if (subTab === "reels" && !reelsFetched && competitors.length > 0) fetchAllReels();
  }, [subTab, reelsFetched, competitors.length]);

  const now = Date.now();
  const days = timeFilter === "all" ? Infinity : parseInt(timeFilter);
  const filteredReels = allReels.filter((r) =>
    days === Infinity || now - new Date(r.timestamp).getTime() < days * 24 * 60 * 60 * 1000
  );
  const sortedReels = reelSort === "best"
    ? [...filteredReels].sort((a, b) => (b.like_count ?? 0) - (a.like_count ?? 0))
    : [...filteredReels].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-white border border-slate-200 rounded-xl p-1 w-fit">
        {([["list", "📋 List"], ["reels", "🎬 Reels"]] as [CompSubTab, string][]).map(([id, label]) => (
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

          {competitors.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-12 text-center">
              <div className="text-3xl mb-2">🔍</div>
              <p className="text-sm text-slate-500">No competitors tracked yet.</p>
              <p className="text-xs text-slate-400 mt-1">Add handles manually or let AI suggest accounts in your niche.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {competitors.map((c) => (
                <CompetitorCard key={c.id} competitor={c} onEdit={() => setEditing(c)} onDelete={() => remove(c.id)} />
              ))}
            </div>
          )}
        </div>
      )}

      {subTab === "reels" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex gap-1 bg-white border border-slate-200 rounded-lg p-0.5">
              {(["7", "14", "30", "90", "all"] as TimeFilter[]).map((d) => (
                <button key={d} onClick={() => setTimeFilter(d)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    timeFilter === d ? "bg-indigo-600 text-white" : "text-slate-500 hover:text-slate-700"
                  }`}>
                  {d === "all" ? "All time" : `${d}d`}
                </button>
              ))}
            </div>
            <button onClick={() => setReelSort(reelSort === "best" ? "recent" : "best")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                reelSort === "best" ? "bg-amber-400 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
              }`}>
              🏆 Best Performing
            </button>
            <button onClick={() => { setReelsFetched(false); }}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500 bg-slate-100 hover:bg-slate-200">
              ↺ Refresh
            </button>
            <span className="text-xs text-slate-400 ml-auto">{sortedReels.length} reels from {competitors.length} accounts</span>
          </div>

          {fetchErrors.length > 0 && (
            <div className="space-y-1.5">
              {fetchErrors.map((e) => (
                <div key={e.handle} className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
                  <span className="text-red-400 text-xs font-bold flex-shrink-0 mt-0.5">!</span>
                  <div>
                    <span className="text-xs font-semibold text-red-700">@{e.handle}</span>
                    <span className="text-xs text-red-500 ml-2">{e.error}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {loadingReels ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3">
              <div className="w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-slate-400">Fetching reels from {competitors.length} accounts…</p>
            </div>
          ) : competitors.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-12 text-center">
              <p className="text-sm text-slate-500">Add competitors in the List tab first.</p>
            </div>
          ) : sortedReels.length === 0 && fetchErrors.length === 0 ? (
            <div className="text-center py-16 text-slate-400 text-sm">
              No reels found in the selected time window. Try "All time".
            </div>
          ) : sortedReels.length === 0 ? null : (
            <div className="grid grid-cols-4 gap-1.5">
              {sortedReels.map((reel) => (
                <button key={reel.id} onClick={() => setSelectedReel(reel)}
                  className="relative aspect-[9/16] bg-slate-900 rounded-xl overflow-hidden group">
                  {reel.thumbnail_url
                    ? <img src={reel.thumbnail_url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                    : <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900">
                        <span className="text-3xl opacity-30">▶</span>
                      </div>
                  }
                  <div className="absolute top-2 left-2">
                    <span className="text-[10px] font-semibold text-white bg-black/50 backdrop-blur-sm px-1.5 py-0.5 rounded-full">
                      @{reel.handle}
                    </span>
                  </div>
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                  <div className="absolute bottom-0 left-0 right-0 p-2.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                      <div className="flex items-center gap-1 text-white text-[11px] font-semibold">
                        <span className="opacity-70">♥</span><span>{fmt(reel.like_count)}</span>
                      </div>
                      <div className="flex items-center gap-1 text-white text-[11px] font-semibold">
                        <span className="opacity-70">💬</span><span>{fmt(reel.comments_count)}</span>
                      </div>
                    </div>
                    <p className="text-white text-[10px] opacity-60 mt-1">
                      {new Date(reel.timestamp).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {showAdd && <CompetitorModal clientId={client.id} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); reload(); }} />}
      {editing && <CompetitorModal clientId={client.id} competitor={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {selectedReel && <ReelDetailPanel reel={selectedReel} client={client} onClose={() => setSelectedReel(null)} />}
    </div>
  );
}

function CompetitorCard({ competitor, onEdit, onDelete }: { competitor: Competitor; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold text-slate-800">@{competitor.handle}</span>
            <a href={competitor.profileUrl || `https://instagram.com/${competitor.handle}`}
              target="_blank" rel="noopener noreferrer"
              className="text-slate-300 hover:text-indigo-500 text-xs">↗</a>
          </div>
          {competitor.name && <p className="text-xs text-slate-400 mt-0.5">{competitor.name}</p>}
        </div>
        {competitor.followerCount && (
          <span className="text-xs font-semibold text-slate-500 flex-shrink-0 ml-2">
            {fmt(competitor.followerCount)} followers
          </span>
        )}
      </div>
      {competitor.niche && (
        <div className="flex flex-wrap gap-1 mb-3">
          {competitor.niche.split(",").map((n) => (
            <span key={n} className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] rounded-full font-medium">{n.trim()}</span>
          ))}
        </div>
      )}
      {competitor.notes && <p className="text-xs text-slate-500 line-clamp-2 mb-3">{competitor.notes}</p>}
      <div className="flex gap-2">
        <a href={competitor.profileUrl || `https://instagram.com/${competitor.handle}`}
          target="_blank" rel="noopener noreferrer"
          className="flex-1 text-center py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100">
          View Profile ↗
        </a>
        <button onClick={onEdit} className="px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200">Edit</button>
        <button onClick={onDelete} className="px-2.5 py-1.5 text-xs font-medium text-red-500 bg-red-50 rounded-lg hover:bg-red-100">✕</button>
      </div>
    </div>
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const method = competitor ? "PUT" : "POST";
    const url = competitor ? `/api/competitors/${competitor.id}` : "/api/competitors";
    await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, clientId }) });
    onSaved();
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
          <button type="submit" className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
            {competitor ? "Save Changes" : "Add Competitor"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ReelDetailPanel({ reel, client, onClose }: { reel: IGReel; client: Client; onClose: () => void }) {
  const storageKey = `reel_transcript_${reel.id}`;
  const [transcript, setTranscript] = useState<string | null>(() => {
    try { return localStorage.getItem(storageKey); } catch { return null; }
  });
  const [transcribing, setTranscribing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function transcribe() {
    if (!reel.media_url) {
      setTranscript("No video URL available for this reel.");
      return;
    }
    setTranscribing(true);
    try {
      const res = await fetch("/api/instagram/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaUrl: reel.media_url }),
      });
      const data = await res.json();
      const text = data.error ? `Error: ${data.error}` : (data.transcript || "No speech detected.");
      setTranscript(text);
      if (!data.error) {
        try { localStorage.setItem(storageKey, text); } catch { /* ignore */ }
      }
    } catch {
      setTranscript("Transcription failed. Please try again.");
    }
    setTranscribing(false);
  }

  async function saveAsConceptIdea() {
    setSaving(true);
    let finalTranscript = transcript;
    if (!finalTranscript && reel.media_url) {
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
        isIdea: true,
      }),
    });
    setSaving(false);
    setSaved(true);
  }

  const stats = [
    { label: "Views", value: reel.plays, icon: "▶" },
    { label: "Reach", value: reel.reach, icon: "👁" },
    { label: "Likes", value: reel.like_count, icon: "♥" },
    { label: "Comments", value: reel.comments_count, icon: "💬" },
    { label: "Saved", value: reel.saved, icon: "🔖" },
    { label: "Shares", value: reel.shares, icon: "↗" },
  ];

  const [mounted, setMounted] = useState(false);
  useEffect(() => { const t = setTimeout(() => setMounted(true), 10); return () => clearTimeout(t); }, []);

  return (
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
              <p className="text-[10px] text-slate-400">{new Date(reel.timestamp).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="relative bg-slate-900 aspect-[9/16] max-h-72 w-full flex items-center justify-center overflow-hidden">
            {reel.media_url
              ? <video
                  src={reel.media_url}
                  poster={reel.thumbnail_url}
                  controls
                  className="w-full h-full object-contain"
                />
              : reel.thumbnail_url
                ? <img src={reel.thumbnail_url} alt="" className="w-full h-full object-cover" />
                : <div className="flex flex-col items-center gap-2 text-slate-600">
                    <span className="text-4xl opacity-20">▶</span>
                    <p className="text-xs opacity-40">No preview available</p>
                  </div>
            }
          </div>
          <div className="p-5 space-y-5">
            {reel.caption && (
              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Caption</p>
                <p className="text-sm text-slate-700 leading-relaxed">{reel.caption}</p>
              </div>
            )}
            <div>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2.5">Analytics</p>
              <div className="grid grid-cols-3 gap-2">
                {stats.map(({ label, value, icon }) => (
                  <div key={label} className="bg-slate-50 rounded-xl p-3 text-center">
                    <p className="text-[11px] text-slate-400 mb-0.5">{icon} {label}</p>
                    <p className="text-base font-bold text-slate-800">{value != null ? fmt(value) : "—"}</p>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Transcript</p>
                {!transcript && (
                  <button onClick={transcribe} disabled={transcribing} className="text-xs font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50">
                    {transcribing ? "Transcribing…" : "↯ Auto-transcribe"}
                  </button>
                )}
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
        <div className="px-5 py-4 border-t border-slate-100 flex-shrink-0 flex gap-2.5">
          <button onClick={saveAsConceptIdea} disabled={saved || saving}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors ${saved ? "bg-green-100 text-green-700 cursor-default" : "bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"}`}>
            {saved ? "✓ Saved as Concept Idea" : saving ? "Saving…" : "💡 Save as Concept Idea"}
          </button>
          {reel.media_url && (
            <a href={reel.media_url} target="_blank" rel="noopener noreferrer"
              className="px-4 py-2.5 rounded-xl text-sm font-medium bg-slate-100 text-slate-600 hover:bg-slate-200">
              Open ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
