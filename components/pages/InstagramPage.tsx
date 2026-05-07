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
  thumbnail_url: string;
  media_url?: string;
  caption?: string;
  timestamp: string;
  like_count: number;
  comments_count: number;
  plays?: number;
  reach?: number;
  saved?: number;
  shares?: number;
};

const MOCK_REELS: IGReel[] = Array.from({ length: 12 }, (_, i) => ({
  id: `mock_${i}`,
  thumbnail_url: "",
  caption: i % 3 === 0
    ? "Did you know most PTs fail online because they do this one thing wrong? 👇"
    : i % 3 === 1
    ? "From 0 to fully booked in 90 days — here's exactly how we did it"
    : "The #1 mistake coaches make when trying to go online (and how to fix it)",
  timestamp: new Date(Date.now() - i * 3 * 24 * 60 * 60 * 1000).toISOString(),
  like_count: Math.floor(Math.random() * 3000) + 200,
  comments_count: Math.floor(Math.random() * 200) + 10,
  plays: Math.floor(Math.random() * 80000) + 5000,
  reach: Math.floor(Math.random() * 60000) + 3000,
  saved: Math.floor(Math.random() * 800) + 50,
  shares: Math.floor(Math.random() * 400) + 20,
}));

function fmt(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

type Tab = "reels" | "competitors";

export default function InstagramPage({ clients, selectedClientId }: Props) {
  const client = clients.find((c) => c.id === selectedClientId) ?? null;
  const isConnected = false; // TODO: check client.instagramToken
  const [tab, setTab] = useState<Tab>("reels");
  const [selected, setSelected] = useState<IGReel | null>(null);

  if (!client) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
        Select a client to view their Instagram
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Profile header */}
      <ProfileHeader client={client} reelCount={MOCK_REELS.length} isConnected={isConnected} />

      {/* Tabs */}
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
        isConnected
          ? <>
              <ReelsGrid reels={MOCK_REELS} onSelect={setSelected} />
              {selected && <ReelDetailPanel reel={selected} client={client} onClose={() => setSelected(null)} />}
            </>
          : <NotConnectedReels client={client} />
      )}

      {tab === "competitors" && (
        <CompetitorsTab client={client} />
      )}
    </div>
  );
}

/* ── Not connected ── */
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
      <div className="bg-slate-50 border border-slate-200 rounded-xl px-5 py-4 text-left max-w-sm w-full space-y-2">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">What you'll need</p>
        {["Meta Developer App (App ID + Secret)", "Instagram Business or Creator account", "AssemblyAI key (for auto-transcription)"].map((item) => (
          <div key={item} className="flex items-start gap-2 text-xs text-slate-600">
            <span className="text-slate-300 mt-0.5">○</span>
            {item}
          </div>
        ))}
      </div>
      <button disabled className="px-5 py-2.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm font-semibold rounded-xl opacity-50 cursor-not-allowed">
        Connect Instagram — coming soon
      </button>
    </div>
  );
}

/* ── Profile header ── */
function ProfileHeader({ client, reelCount, isConnected }: { client: Client; reelCount: number; isConnected: boolean }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 px-6 py-5 flex items-center gap-6">
      <div className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold text-white flex-shrink-0 shadow"
        style={{ backgroundColor: client.color }}>
        {client.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <h2 className="text-base font-bold text-slate-800">
            {client.profileUrl?.replace("https://instagram.com/", "@") || client.name}
          </h2>
          <span className="text-[10px] bg-blue-100 text-blue-600 font-semibold px-1.5 py-0.5 rounded-full">Creator</span>
        </div>
        <p className="text-xs text-slate-400">{client.name}</p>
      </div>
      <div className="flex gap-8 flex-shrink-0">
        {[{ label: "Reels", value: reelCount }, { label: "Followers", value: "—" }, { label: "Following", value: "—" }].map(({ label, value }) => (
          <div key={label} className="text-center">
            <p className="text-base font-bold text-slate-800">{value}</p>
            <p className="text-xs text-slate-400">{label}</p>
          </div>
        ))}
      </div>
      <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium flex-shrink-0 ${
        isConnected ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
      }`}>
        <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? "bg-green-500" : "bg-amber-400"}`} />
        {isConnected ? "Connected" : "Not connected"}
      </span>
    </div>
  );
}

/* ── Reels grid ── */
function ReelsGrid({ reels, onSelect }: { reels: IGReel[]; onSelect: (r: IGReel) => void }) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-3">Reels · {reels.length}</p>
      <div className="grid grid-cols-4 gap-1.5">
        {reels.map((reel) => (
          <button key={reel.id} onClick={() => onSelect(reel)}
            className="relative aspect-[9/16] bg-slate-900 rounded-xl overflow-hidden group hover:opacity-90 transition-opacity">
            {reel.thumbnail_url
              ? <img src={reel.thumbnail_url} alt="" className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900">
                  <span className="text-3xl opacity-30">▶</span>
                </div>
            }
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="absolute bottom-0 left-0 right-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="flex items-center gap-2 text-white text-xs font-semibold">
                <span>▶ {fmt(reel.plays ?? 0)}</span>
                <span>♥ {fmt(reel.like_count)}</span>
              </div>
            </div>
            <div className="absolute top-2 right-2 opacity-70">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Competitors tab ── */
function CompetitorsTab({ client }: { client: Client }) {
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Competitor | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);

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

  return (
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

      {/* AI suggestions strip */}
      {suggestions.length > 0 && (
        <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4">
          <p className="text-xs font-semibold text-indigo-700 mb-2.5">Suggested accounts to track:</p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((handle) => (
              <button key={handle}
                onClick={() => { setShowAdd(true); setSuggestions([]); }}
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

      {showAdd && (
        <CompetitorModal clientId={client.id} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); reload(); }} />
      )}
      {editing && (
        <CompetitorModal clientId={client.id} competitor={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
      )}
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
      {competitor.notes && (
        <p className="text-xs text-slate-500 line-clamp-2 mb-3">{competitor.notes}</p>
      )}
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
    await fetch(url, {
      method, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, clientId }),
    });
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
            placeholder="e.g. fitness, online coaching, Dutch content"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">What's working for them?</label>
          <textarea rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)}
            placeholder="Hook styles, content formats, posting frequency, topics that perform well…"
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

/* ── Reel detail panel ── */
function ReelDetailPanel({ reel, client, onClose }: { reel: IGReel; client: Client; onClose: () => void }) {
  const [transcript, setTranscript] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [saved, setSaved] = useState(false);

  async function transcribe() {
    setTranscribing(true);
    await new Promise((r) => setTimeout(r, 2000));
    setTranscript(reel.caption || "Transcript will appear here once AssemblyAI is connected.");
    setTranscribing(false);
  }

  async function saveAsConcept() {
    await fetch("/api/concepts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: client.id,
        name: reel.caption?.slice(0, 60) || `Reel ${new Date(reel.timestamp).toLocaleDateString()}`,
        exampleUrl: reel.id,
        notes: `Plays: ${fmt(reel.plays ?? 0)} · Likes: ${fmt(reel.like_count)} · Saved: ${fmt(reel.saved ?? 0)}`,
        scriptExamples: transcript || "",
      }),
    });
    setSaved(true);
  }

  const stats = [
    { label: "Plays", value: reel.plays ?? 0, icon: "▶" },
    { label: "Reach", value: reel.reach ?? 0, icon: "👁" },
    { label: "Likes", value: reel.like_count, icon: "♥" },
    { label: "Comments", value: reel.comments_count, icon: "💬" },
    { label: "Saved", value: reel.saved ?? 0, icon: "🔖" },
    { label: "Shares", value: reel.shares ?? 0, icon: "↗" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/40" onClick={onClose}>
      <div className="w-[520px] h-full bg-white flex flex-col shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
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
          <div className="relative bg-slate-900 aspect-[9/16] max-h-64 w-full flex items-center justify-center overflow-hidden">
            {reel.thumbnail_url
              ? <img src={reel.thumbnail_url} alt="" className="w-full h-full object-cover" />
              : <div className="flex flex-col items-center gap-2 text-slate-600">
                  <span className="text-4xl opacity-20">▶</span>
                  <p className="text-xs opacity-40">Preview loads with real API</p>
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
                    <p className="text-base font-bold text-slate-800">{fmt(value)}</p>
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
                      : <p className="text-xs text-slate-400">Click to auto-transcribe via AssemblyAI</p>
                    }
                  </div>
              }
            </div>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-slate-100 flex-shrink-0 flex gap-2.5">
          <button onClick={saveAsConcept} disabled={saved}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors ${saved ? "bg-green-100 text-green-700 cursor-default" : "bg-indigo-600 text-white hover:bg-indigo-700"}`}>
            {saved ? "✓ Saved as Concept" : "💡 Save as Concept"}
          </button>
          <a href="#" className="px-4 py-2.5 rounded-xl text-sm font-medium bg-slate-100 text-slate-600 hover:bg-slate-200">Open ↗</a>
        </div>
      </div>
    </div>
  );
}
