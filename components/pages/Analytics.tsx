"use client";

import { useEffect, useState } from "react";
import { Client, TrackedVideo, Concept, HOOK_TYPE_SUGGESTIONS } from "@/lib/types";
import Modal from "@/components/ui/Modal";

type Props = { clients: Client[]; selectedClientId: number | null; refreshClients: () => void };

function viewColor(views: number) {
  if (views >= 50000) return "text-green-600 bg-green-50";
  if (views >= 10000) return "text-amber-600 bg-amber-50";
  return "text-red-600 bg-red-50";
}

function fmt(n: number) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return n.toString();
}

type Tab = "videos" | "concepts" | "hooks";

export default function Analytics({ clients, selectedClientId }: Props) {
  const [videos, setVideos] = useState<TrackedVideo[]>([]);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [tab, setTab] = useState<Tab>("videos");
  const [showTrack, setShowTrack] = useState(false);

  useEffect(() => {
    reload();
  }, [selectedClientId]);

  async function reload() {
    const qs = selectedClientId ? `?clientId=${selectedClientId}` : "";
    const [v, c] = await Promise.all([
      fetch(`/api/videos${qs}`).then((r) => r.json()),
      fetch(`/api/concepts${qs}`).then((r) => r.json()),
    ]);
    setVideos(v);
    setConcepts(c);
  }

  async function deleteVideo(id: number) {
    if (!confirm("Remove this tracked video?")) return;
    await fetch(`/api/videos/${id}`, { method: "DELETE" });
    reload();
  }

  // Concept performance aggregation
  const conceptPerf = concepts
    .map((c) => {
      const vids = videos.filter((v) => v.conceptId === c.id);
      if (vids.length === 0) return null;
      const avgViews = Math.round(vids.reduce((s, v) => s + v.views, 0) / vids.length);
      const engRate = vids.reduce((s, v) => {
        const er = v.views > 0 ? ((v.likes + v.comments) / v.views) * 100 : 0;
        return s + er;
      }, 0) / vids.length;
      const best = vids.sort((a, b) => b.views - a.views)[0];
      return { concept: c, avgViews, count: vids.length, engRate: engRate.toFixed(2), best };
    })
    .filter(Boolean)
    .sort((a, b) => b!.avgViews - a!.avgViews);

  // Hook analysis
  const hookMap: Record<string, TrackedVideo[]> = {};
  for (const v of videos) {
    const key = v.hookType || "unknown";
    if (!hookMap[key]) hookMap[key] = [];
    hookMap[key].push(v);
  }
  const hookPerf = Object.entries(hookMap)
    .map(([hookType, vids]) => {
      const avgViews = Math.round(vids.reduce((s, v) => s + v.views, 0) / vids.length);
      const engRate = vids.reduce((s, v) => {
        const er = v.views > 0 ? ((v.likes + v.comments) / v.views) * 100 : 0;
        return s + er;
      }, 0) / vids.length;
      return { hookType, count: vids.length, avgViews, engRate: engRate.toFixed(2) };
    })
    .sort((a, b) => b.avgViews - a.avgViews);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Analytics</h1>
          <p className="text-slate-500 mt-1">Data-driven content insights</p>
        </div>
        <button
          onClick={() => setShowTrack(true)}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700"
        >
          + Track Video
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {(["videos", "concepts", "hooks"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === t ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t === "videos" ? "Tracked Videos" : t === "concepts" ? "Concept Performance" : "Hook Analysis"}
          </button>
        ))}
      </div>

      {tab === "videos" && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {videos.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-sm">No tracked videos yet. Start tracking to see performance data.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {["Title", "Client", "Views", "Likes", "Comments", "Shares", "Saves", "Concept", "Hook Type", "Date", ""].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {videos.map((v) => (
                    <tr key={v.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-800 max-w-[160px] truncate">
                        {v.url ? <a href={v.url} target="_blank" rel="noopener noreferrer" className="hover:text-indigo-600">{v.title}</a> : v.title}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{v.client?.name}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${viewColor(v.views)}`}>{fmt(v.views)}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-500">{fmt(v.likes)}</td>
                      <td className="px-4 py-3 text-slate-500">{fmt(v.comments)}</td>
                      <td className="px-4 py-3 text-slate-500">{fmt(v.shares)}</td>
                      <td className="px-4 py-3 text-slate-500">{fmt(v.saves)}</td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{v.concept?.name || "—"}</td>
                      <td className="px-4 py-3">
                        {v.hookType && <span className="px-2 py-0.5 rounded-full text-xs bg-indigo-50 text-indigo-600">{v.hookType}</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{v.datePosted || "—"}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => deleteVideo(v.id)} className="text-red-400 hover:text-red-600 text-xs">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "concepts" && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {conceptPerf.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-sm">No concept data yet. Track videos and tag concepts to see performance.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {["Concept", "Videos", "Avg Views", "Engagement Rate", "Best Video"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {conceptPerf.map((cp) => cp && (
                  <tr key={cp.concept.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{cp.concept.name}</td>
                    <td className="px-4 py-3 text-slate-500">{cp.count}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${viewColor(cp.avgViews)}`}>{fmt(cp.avgViews)}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{cp.engRate}%</td>
                    <td className="px-4 py-3 text-slate-400 text-xs truncate max-w-[160px]">{cp.best?.title}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "hooks" && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {hookPerf.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-sm">No hook data yet. Track videos with hook types to see analysis.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {["Hook Type", "Videos", "Avg Views", "Avg Engagement Rate"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {hookPerf.map((hp) => (
                  <tr key={hp.hookType} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">{hp.hookType}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{hp.count}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${viewColor(hp.avgViews)}`}>{fmt(hp.avgViews)}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{hp.engRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {showTrack && (
        <TrackVideoModal
          clients={clients}
          concepts={concepts}
          selectedClientId={selectedClientId}
          onClose={() => setShowTrack(false)}
          onSaved={() => { setShowTrack(false); reload(); }}
        />
      )}
    </div>
  );
}

function TrackVideoModal({
  clients, concepts, selectedClientId, onClose, onSaved,
}: {
  clients: Client[];
  concepts: Concept[];
  selectedClientId: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const activeClient = clients.find((c) => c.id === selectedClientId) ?? null;

  const [form, setForm] = useState({
    clientId: selectedClientId?.toString() || (clients[0]?.id?.toString() ?? ""),
    conceptId: "", title: "", url: "", hookUsed: "", hookType: "",
    views: "", likes: "", comments: "", shares: "", saves: "", datePosted: "", notes: "",
  });
  function set(k: string, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/videos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    onSaved();
  }

  return (
    <Modal title="Track Video" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        {/* Client context banner or selector */}
        {activeClient ? (
          <div
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
            style={{ backgroundColor: activeClient.color + "15", border: `1.5px solid ${activeClient.color}30` }}
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
              style={{ backgroundColor: activeClient.color }}
            >
              {activeClient.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800">{activeClient.name}</p>
              <p className="text-xs text-slate-500 capitalize">{activeClient.platform}</p>
            </div>
          </div>
        ) : (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Client *</label>
            <select required value={form.clientId} onChange={(e) => set("clientId", e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="">Select client</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Title *</label>
            <input required value={form.title} onChange={(e) => set("title", e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">URL</label>
            <input type="url" value={form.url} onChange={(e) => set("url", e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Concept</label>
          <select value={form.conceptId} onChange={(e) => set("conceptId", e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="">No concept</option>
            {concepts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Hook Used</label>
            <input value={form.hookUsed} onChange={(e) => set("hookUsed", e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Hook Type (free text)</label>
            <input list="hookTypeListV" value={form.hookType} onChange={(e) => set("hookType", e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <datalist id="hookTypeListV">
              {HOOK_TYPE_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
            </datalist>
          </div>
        </div>
        <div className="grid grid-cols-5 gap-3">
          {(["views", "likes", "comments", "shares", "saves"] as const).map((k) => (
            <div key={k}>
              <label className="block text-xs font-medium text-slate-600 mb-1 capitalize">{k}</label>
              <input type="number" min="0" value={form[k]} onChange={(e) => set(k, e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Date Posted</label>
            <input type="date" value={form.datePosted} onChange={(e) => set("datePosted", e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
            <input value={form.notes} onChange={(e) => set("notes", e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
          <button type="submit" className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">Track Video</button>
        </div>
      </form>
    </Modal>
  );
}
