"use client";

import { useState } from "react";
import { Client, Notification, TeamMember } from "@/lib/types";

type Page = "pipeline" | "kanban" | "concepts" | "analytics" | "instagram" | "board" | "dms" | "team" | "chat" | "settings";

const NAV_GROUPS = [
  {
    label: "WORK",
    items: [
      { id: "pipeline" as Page, label: "Content Scheduling", icon: "📅" },
      { id: "kanban" as Page, label: "Script Kanban", icon: "📋" },
      { id: "concepts" as Page, label: "Concept Library", icon: "💡" },
      { id: "analytics" as Page, label: "Analytics", icon: "📊" },
      { id: "dms" as Page, label: "DM Pipeline", icon: "💌" },
      { id: "instagram" as Page, label: "Instagram", icon: "📸" },
      { id: "board" as Page, label: "Strategy Board", icon: "🗂️" },
    ],
  },
  {
    label: "MANAGE",
    items: [
      { id: "team" as Page, label: "Team", icon: "🤝" },
      { id: "chat" as Page, label: "Client Chat", icon: "💬" },
      { id: "settings" as Page, label: "Settings", icon: "⚙️" },
    ],
  },
];

const PLATFORM_ICONS: Record<string, string> = {
  instagram: "📸",
  tiktok: "🎵",
  youtube: "▶️",
  linkedin: "💼",
};

type Props = {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  clients: Client[];
  selectedClientId: number | null;
  onSelectClient: (id: number | null) => void;
  unreadCount: number;
  notifications: Notification[];
  onMarkRead: (id: number) => void;
  onMarkAllRead: () => void;
  allowedPages: Page[];
  activeProfile: TeamMember | null;
  team: TeamMember[];
  onSwitchProfile: (id: number | null) => void;
};

export default function Sidebar({
  currentPage, onNavigate, clients, selectedClientId, onSelectClient,
  unreadCount, notifications, onMarkRead, onMarkAllRead,
  allowedPages, activeProfile, team, onSwitchProfile,
}: Props) {
  const [showNotifs, setShowNotifs] = useState(false);
  const [showClientPicker, setShowClientPicker] = useState(false);
  const [showProfilePicker, setShowProfilePicker] = useState(false);

  const activeClient = clients.find((c) => c.id === selectedClientId) ?? null;

  return (
    <aside className="fixed top-0 left-0 h-full w-64 bg-white border-r border-slate-200 flex flex-col z-10">

      {/* Brand + notification bell */}
      <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-bold text-indigo-600 tracking-tight">ClientFlow</h1>
          <p className="text-[11px] text-slate-400">SMM Management</p>
        </div>
        <div className="relative">
          <button
            onClick={() => setShowNotifs((s) => !s)}
            className="relative w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500"
          >
            🔔
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>

          {showNotifs && (
            <div className="absolute right-0 top-10 w-80 bg-white border border-slate-200 rounded-xl shadow-xl z-50">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                <span className="text-sm font-semibold text-slate-700">Notifications</span>
                {unreadCount > 0 && (
                  <button onClick={onMarkAllRead} className="text-xs text-indigo-600 hover:underline">Mark all read</button>
                )}
              </div>
              <div className="max-h-72 overflow-y-auto">
                {notifications.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-slate-400">No notifications</p>
                ) : (
                  notifications.map((n) => (
                    <button key={n.id} onClick={() => { onMarkRead(n.id); setShowNotifs(false); }}
                      className={`w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 ${!n.read ? "bg-indigo-50/50" : ""}`}>
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 mt-0.5"
                        style={{ backgroundColor: n.member?.color || "#6366f1" }}>
                        {n.member?.name?.[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-slate-700 leading-relaxed">{n.message}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">{new Date(n.createdAt).toLocaleDateString()}</p>
                      </div>
                      {!n.read && <div className="w-2 h-2 bg-indigo-500 rounded-full flex-shrink-0 mt-1.5" />}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── CLIENT CONTEXT ── */}
      <div className="flex-shrink-0 border-b border-slate-100">
        <div className="px-2 py-1.5">
          {activeClient ? (
            <button
              onClick={() => clients.length > 1 ? setShowClientPicker((s) => !s) : undefined}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-slate-50 transition-colors text-left"
              style={{ cursor: clients.length > 1 ? "pointer" : "default" }}
            >
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0"
                style={{ backgroundColor: activeClient.color }}
              >
                {activeClient.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-slate-800 truncate leading-tight">{activeClient.name}</p>
                <p className="text-[10px] text-slate-400 capitalize leading-tight">{activeClient.platform}</p>
              </div>
              {clients.length > 1 && (
                <span className="text-slate-300 text-[10px] flex-shrink-0">{showClientPicker ? "▲" : "▼"}</span>
              )}
            </button>
          ) : (
            <button
              onClick={() => { onNavigate("settings"); }}
              className="w-full px-3 py-2 rounded-lg border border-dashed border-slate-200 text-xs text-slate-400 hover:border-indigo-400 hover:text-indigo-500 transition-colors text-center"
            >
              + Add a client
            </button>
          )}

          {showClientPicker && clients.length > 1 && (
            <div className="mt-1.5 rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden">
              {clients.map((c) => (
                <button
                  key={c.id}
                  onClick={() => { onSelectClient(c.id); setShowClientPicker(false); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-slate-50 text-left border-b border-slate-100 last:border-b-0 ${c.id === selectedClientId ? "bg-indigo-50" : ""}`}
                >
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                    style={{ backgroundColor: c.color }}>
                    {c.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-700 font-medium truncate">{c.name}</p>
                    <p className="text-[10px] text-slate-400 capitalize">{c.platform}</p>
                  </div>
                  {c.id === selectedClientId && <span className="text-indigo-500 text-xs">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-3 space-y-4 overflow-y-auto">
        {NAV_GROUPS.map((group) => {
          const visibleItems = group.items.filter((item) => allowedPages.includes(item.id));
          if (visibleItems.length === 0) return null;
          return (
            <div key={group.label}>
              <p className="text-[10px] font-semibold text-slate-400 px-3 mb-1.5 tracking-wider">{group.label}</p>
              <div className="space-y-0.5">
                {visibleItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => onNavigate(item.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
                      currentPage === item.id
                        ? "bg-indigo-600 text-white"
                        : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    <span className="text-base">{item.icon}</span>
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Profile switcher */}
      <div className="px-3 py-3 border-t border-slate-200 flex-shrink-0">
        <div className="relative">
          <button
            onClick={() => setShowProfilePicker((s) => !s)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors text-left"
          >
            {activeProfile ? (
              <>
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0"
                  style={{ backgroundColor: activeProfile.color }}
                >
                  {activeProfile.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-700 truncate">{activeProfile.name}</p>
                  <p className="text-[10px] text-slate-400 truncate">{activeProfile.role || "Team member"}</p>
                </div>
              </>
            ) : (
              <>
                <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center text-indigo-600 text-xs font-bold flex-shrink-0">
                  👑
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-700">Owner</p>
                  <p className="text-[10px] text-slate-400">Full access</p>
                </div>
              </>
            )}
            <span className="text-slate-400 text-[10px]">{showProfilePicker ? "▲" : "▼"}</span>
          </button>

          {showProfilePicker && (
            <div className="absolute bottom-full left-0 right-0 mb-1 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden z-50">
              <div className="px-3 py-2 border-b border-slate-100">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Switch Profile</p>
              </div>
              {/* Owner option */}
              <button
                onClick={() => { onSwitchProfile(null); setShowProfilePicker(false); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-slate-50 text-left ${activeProfile === null ? "bg-indigo-50" : ""}`}
              >
                <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center text-indigo-600 text-xs font-bold flex-shrink-0">👑</div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-700">Owner</p>
                  <p className="text-[10px] text-slate-400">Full access</p>
                </div>
                {activeProfile === null && <span className="text-indigo-500 text-xs">✓</span>}
              </button>
              {/* Team members */}
              {team.map((m) => (
                <button
                  key={m.id}
                  onClick={() => { onSwitchProfile(m.id); setShowProfilePicker(false); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-slate-50 text-left border-t border-slate-50 ${activeProfile?.id === m.id ? "bg-indigo-50" : ""}`}
                >
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0"
                    style={{ backgroundColor: m.color }}>
                    {m.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-slate-700 truncate">{m.name}</p>
                    <p className="text-[10px] text-slate-400 truncate">{m.role || "Team member"}</p>
                  </div>
                  {activeProfile?.id === m.id && <span className="text-indigo-500 text-xs">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
