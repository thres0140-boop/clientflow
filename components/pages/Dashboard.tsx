"use client";

import { useEffect, useState } from "react";
import { Client, ContentPiece, Concept, TrackedVideo, STATUSES } from "@/lib/types";
import StatusBadge from "@/components/ui/StatusBadge";
import ClientAvatar from "@/components/ui/ClientAvatar";
import { Page } from "@/app/page";

type Props = {
  clients: Client[];
  selectedClientId: number | null;
  refreshClients: () => void;
  onNavigate: (page: Page) => void;
};

export default function Dashboard({ clients, selectedClientId, onNavigate }: Props) {
  const [content, setContent] = useState<ContentPiece[]>([]);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [videos, setVideos] = useState<TrackedVideo[]>([]);

  useEffect(() => {
    const qs = selectedClientId ? `?clientId=${selectedClientId}` : "";
    Promise.all([
      fetch(`/api/content${qs}`).then((r) => r.json()),
      fetch(`/api/concepts${qs}`).then((r) => r.json()),
      fetch(`/api/videos${qs}`).then((r) => r.json()),
    ]).then(([c, co, v]) => { setContent(c); setConcepts(co); setVideos(v); });
  }, [selectedClientId]);

  const filteredClients = selectedClientId ? clients.filter((c) => c.id === selectedClientId) : clients;
  const readyToFilm = content.filter((c) => c.status === "ready_to_film").length;
  const totalViews = videos.reduce((s, v) => s + v.views, 0);

  const upcoming = content
    .filter((c) => c.status !== "posted" && c.scheduledDate)
    .sort((a, b) => (a.scheduledDate! > b.scheduledDate! ? 1 : -1))
    .slice(0, 6);

  const statusCounts = STATUSES.map((s) => ({
    ...s,
    count: content.filter((c) => c.status === s.value).length,
  }));

  function fmt(n: number) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
    if (n >= 1000) return (n / 1000).toFixed(1) + "K";
    return n.toString();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {selectedClientId
              ? clients.find((c) => c.id === selectedClientId)?.name
              : "All clients overview"}
          </p>
        </div>
        <div className="text-sm text-slate-400">
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Clients", value: filteredClients.length, sub: "active", color: "from-indigo-500 to-indigo-600", icon: "👥", page: "settings" as Page },
          { label: "Content Pieces", value: content.length, sub: `${readyToFilm} ready to film`, color: "from-violet-500 to-violet-600", icon: "🎬", page: "pipeline" as Page },
          { label: "Concepts", value: concepts.length, sub: "in playbook", color: "from-pink-500 to-pink-600", icon: "💡", page: "concepts" as Page },
          { label: "Total Views", value: fmt(totalViews), sub: "tracked videos", color: "from-amber-500 to-amber-600", icon: "👁️", page: "analytics" as Page },
        ].map((stat) => (
          <button
            key={stat.label}
            onClick={() => onNavigate(stat.page)}
            className="bg-white rounded-2xl border border-slate-200 p-5 text-left hover:shadow-md hover:border-slate-300 transition-all group"
          >
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${stat.color} flex items-center justify-center text-lg mb-4 group-hover:scale-105 transition-transform`}>
              {stat.icon}
            </div>
            <div className="text-3xl font-bold text-slate-900">{stat.value}</div>
            <div className="text-sm font-medium text-slate-700 mt-1">{stat.label}</div>
            <div className="text-xs text-slate-400 mt-0.5">{stat.sub}</div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Pipeline status */}
        <div className="col-span-2 bg-white rounded-2xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-800">Pipeline Status</h2>
            <button onClick={() => onNavigate("pipeline")} className="text-xs text-indigo-600 hover:underline">View all →</button>
          </div>
          <div className="space-y-2.5">
            {statusCounts.map((s) => {
              const pct = content.length > 0 ? (s.count / content.length) * 100 : 0;
              return (
                <div key={s.value} className="flex items-center gap-3">
                  <span className={`w-24 text-xs font-medium ${s.text} flex-shrink-0`}>{s.label}</span>
                  <div className="flex-1 bg-slate-100 rounded-full h-2">
                    <div
                      className="h-2 rounded-full transition-all"
                      style={{ width: `${pct}%`, backgroundColor: `var(--${s.bg.replace("bg-", "").replace("-100", "")}-500, #6366f1)` }}
                    />
                  </div>
                  <span className="text-sm font-bold text-slate-700 w-6 text-right">{s.count}</span>
                </div>
              );
            })}
          </div>
          {content.length === 0 && (
            <p className="text-center text-slate-400 text-sm py-4">No content yet</p>
          )}
        </div>

        {/* Clients quick view */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-800">Clients</h2>
            <button onClick={() => onNavigate("settings")} className="text-xs text-indigo-600 hover:underline">Manage →</button>
          </div>
          {filteredClients.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-slate-400 text-sm mb-3">No clients yet</p>
              <button onClick={() => onNavigate("settings")} className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg">Add Client</button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredClients.slice(0, 5).map((c) => (
                <div key={c.id} className="flex items-center gap-2.5">
                  <ClientAvatar name={c.name} color={c.color} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{c.name}</p>
                    <p className="text-xs text-slate-400 capitalize">{c.platform}</p>
                  </div>
                  <span className="text-xs text-slate-400">
                    {content.filter((p) => p.clientId === c.id).length}
                  </span>
                </div>
              ))}
              {filteredClients.length > 5 && (
                <p className="text-xs text-slate-400 text-center">+{filteredClients.length - 5} more</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Upcoming content */}
      <div className="bg-white rounded-2xl border border-slate-200">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-semibold text-slate-800">Upcoming Content</h2>
          <button onClick={() => onNavigate("pipeline")} className="text-xs text-indigo-600 hover:underline">View pipeline →</button>
        </div>
        {upcoming.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-slate-400 text-sm mb-3">No upcoming content scheduled</p>
            <button onClick={() => onNavigate("pipeline")} className="text-xs bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700">
              + Add Content
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {upcoming.map((piece) => (
              <div key={piece.id} className="flex items-center gap-3 px-5 py-3.5">
                <div
                  className="w-1 h-10 rounded-full flex-shrink-0"
                  style={{ backgroundColor: piece.client?.color || "#6366f1" }}
                />
                {piece.client && <ClientAvatar name={piece.client.name} color={piece.client.color} size="sm" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{piece.title}</p>
                  <p className="text-xs text-slate-400">
                    {piece.client?.name}{piece.concept ? ` · ${piece.concept.name}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {piece.scheduledDate && (
                    <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-md font-medium">
                      {piece.scheduledDate}
                    </span>
                  )}
                  <StatusBadge status={piece.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
