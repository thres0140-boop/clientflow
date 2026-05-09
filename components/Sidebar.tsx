"use client";

import { useState } from "react";
import { Client, Notification, TeamMember } from "@/lib/types";
import type { SessionPayload } from "@/lib/session";

type Page = "pipeline" | "kanban" | "concepts" | "analytics" | "instagram" | "board" | "dms" | "team" | "chat" | "settings" | "context";

// ── Custom SVG Icons ─────────────────────────────────────────────────────────
function IconCalendar({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="2.5" width="13" height="12" rx="2" stroke={active ? "white" : "#94a3b8"} strokeWidth="1.3"/>
      <path d="M5 1.5V3.5M11 1.5V3.5" stroke={active ? "white" : "#94a3b8"} strokeWidth="1.3" strokeLinecap="round"/>
      <path d="M1.5 6H14.5" stroke={active ? "white" : "#94a3b8"} strokeWidth="1.3"/>
      <rect x="4" y="8.5" width="2" height="2" rx="0.5" fill={active ? "white" : "#94a3b8"}/>
      <rect x="7" y="8.5" width="2" height="2" rx="0.5" fill={active ? "white" : "#94a3b8"}/>
      <rect x="10" y="8.5" width="2" height="2" rx="0.5" fill={active ? "white" : "#94a3b8"}/>
    </svg>
  );
}

function IconKanban({ active }: { active: boolean }) {
  const c = active ? "white" : "#94a3b8";
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="1.5" width="4" height="10" rx="1.5" stroke={c} strokeWidth="1.3"/>
      <rect x="6" y="1.5" width="4" height="7" rx="1.5" stroke={c} strokeWidth="1.3"/>
      <rect x="10.5" y="1.5" width="4" height="13" rx="1.5" stroke={c} strokeWidth="1.3"/>
    </svg>
  );
}

function IconConcepts({ active }: { active: boolean }) {
  const c = active ? "white" : "#94a3b8";
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 1.5C5.51 1.5 3.5 3.51 3.5 6c0 1.68.9 3.14 2.25 3.93V11h4.5V9.93C11.6 9.14 12.5 7.68 12.5 6c0-2.49-2.01-4.5-4.5-4.5z" stroke={c} strokeWidth="1.3" strokeLinejoin="round"/>
      <path d="M5.75 11h4.5M6.5 13h3" stroke={c} strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  );
}

function IconBrain({ active }: { active: boolean }) {
  const c = active ? "white" : "#94a3b8";
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 2C6.9 2 6 2.67 6 3.5c0 .28.1.54.26.77C5.55 4.56 5 5.22 5 6c0 .55.23 1.05.6 1.4C5.23 7.75 5 8.25 5 8.8c0 .97.68 1.78 1.6 1.96V12h2.8v-1.24C10.32 10.58 11 9.77 11 8.8c0-.55-.23-1.05-.6-1.4.37-.35.6-.85.6-1.4 0-.78-.55-1.44-1.26-1.73.16-.23.26-.49.26-.77C10 2.67 9.1 2 8 2z" stroke={c} strokeWidth="1.2" strokeLinejoin="round"/>
      <path d="M6.5 12h3M7 9.5h2" stroke={c} strokeWidth="1.2" strokeLinecap="round"/>
      <path d="M8 5.5V7.5" stroke={c} strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}

function IconAnalytics({ active }: { active: boolean }) {
  const c = active ? "white" : "#94a3b8";
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="7.5" width="3" height="6" rx="1" stroke={c} strokeWidth="1.3"/>
      <rect x="6.5" y="4.5" width="3" height="9" rx="1" stroke={c} strokeWidth="1.3"/>
      <rect x="11.5" y="2" width="3" height="11.5" rx="1" stroke={c} strokeWidth="1.3"/>
    </svg>
  );
}

function IconDMs({ active }: { active: boolean }) {
  const c = active ? "white" : "#94a3b8";
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M2 3.5C2 2.67 2.67 2 3.5 2h9C13.33 2 14 2.67 14 3.5v7c0 .83-.67 1.5-1.5 1.5H9l-3 2v-2H3.5C2.67 12 2 11.33 2 10.5v-7z" stroke={c} strokeWidth="1.3" strokeLinejoin="round"/>
      <path d="M5 6h6M5 8.5h3.5" stroke={c} strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  );
}

function IconInstagram({ active }: { active: boolean }) {
  const c = active ? "white" : "#94a3b8";
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="2" y="2" width="12" height="12" rx="3.5" stroke={c} strokeWidth="1.3"/>
      <circle cx="8" cy="8" r="2.5" stroke={c} strokeWidth="1.3"/>
      <circle cx="11.5" cy="4.5" r="0.75" fill={c}/>
    </svg>
  );
}

function IconBoard({ active }: { active: boolean }) {
  const c = active ? "white" : "#94a3b8";
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="1.5" width="6" height="6" rx="1.5" stroke={c} strokeWidth="1.3"/>
      <rect x="8.5" y="1.5" width="6" height="3.5" rx="1.5" stroke={c} strokeWidth="1.3"/>
      <rect x="8.5" y="6.5" width="6" height="8" rx="1.5" stroke={c} strokeWidth="1.3"/>
      <rect x="1.5" y="9" width="6" height="5.5" rx="1.5" stroke={c} strokeWidth="1.3"/>
    </svg>
  );
}

function IconTeam({ active }: { active: boolean }) {
  const c = active ? "white" : "#94a3b8";
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="6" cy="5" r="2.5" stroke={c} strokeWidth="1.3"/>
      <path d="M1.5 13.5c0-2.49 2.01-4.5 4.5-4.5s4.5 2.01 4.5 4.5" stroke={c} strokeWidth="1.3" strokeLinecap="round"/>
      <circle cx="12" cy="5.5" r="1.8" stroke={c} strokeWidth="1.2"/>
      <path d="M14.5 12.5c0-1.66-1.12-3.08-2.67-3.42" stroke={c} strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}

function IconChat({ active }: { active: boolean }) {
  const c = active ? "white" : "#94a3b8";
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M2 3C2 2.45 2.45 2 3 2h10c.55 0 1 .45 1 1v7c0 .55-.45 1-1 1H9.5L7 14v-3H3c-.55 0-1-.45-1-1V3z" stroke={c} strokeWidth="1.3" strokeLinejoin="round"/>
      <circle cx="5.5" cy="6.5" r="0.8" fill={c}/>
      <circle cx="8" cy="6.5" r="0.8" fill={c}/>
      <circle cx="10.5" cy="6.5" r="0.8" fill={c}/>
    </svg>
  );
}

function IconSettings({ active }: { active: boolean }) {
  const c = active ? "white" : "#94a3b8";
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="2" stroke={c} strokeWidth="1.3"/>
      <path d="M8 1.5v1.2M8 13.3v1.2M1.5 8h1.2M13.3 8h1.2M3.4 3.4l.85.85M11.75 11.75l.85.85M12.6 3.4l-.85.85M4.25 11.75l-.85.85" stroke={c} strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  );
}

const PAGE_ICONS: Record<Page, (active: boolean) => React.ReactNode> = {
  pipeline: (a) => <IconCalendar active={a} />,
  kanban:   (a) => <IconKanban active={a} />,
  concepts: (a) => <IconConcepts active={a} />,
  context:  (a) => <IconBrain active={a} />,
  analytics:(a) => <IconAnalytics active={a} />,
  dms:      (a) => <IconDMs active={a} />,
  instagram:(a) => <IconInstagram active={a} />,
  board:    (a) => <IconBoard active={a} />,
  team:     (a) => <IconTeam active={a} />,
  chat:     (a) => <IconChat active={a} />,
  settings: (a) => <IconSettings active={a} />,
};

const NAV_GROUPS = [
  {
    label: "WORK",
    items: [
      { id: "pipeline" as Page, label: "Content Scheduling" },
      { id: "kanban" as Page, label: "Script Kanban" },
      { id: "concepts" as Page, label: "Concept Library" },
      { id: "context" as Page, label: "AI Context" },
      { id: "analytics" as Page, label: "Analytics" },
      { id: "dms" as Page, label: "DM Pipeline" },
      { id: "instagram" as Page, label: "Instagram" },
      { id: "board" as Page, label: "Strategy Board" },
    ],
  },
  {
    label: "MANAGE",
    items: [
      { id: "team" as Page, label: "Team" },
      { id: "chat" as Page, label: "Client Chat" },
      { id: "settings" as Page, label: "Settings" },
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
  session: SessionPayload | null;
  onSignOut: () => void;
};

export default function Sidebar({
  currentPage, onNavigate, clients, selectedClientId, onSelectClient,
  unreadCount, notifications, onMarkRead, onMarkAllRead,
  allowedPages, activeProfile,
  session, onSignOut,
}: Props) {
  const [showNotifs, setShowNotifs] = useState(false);
  const [showClientPicker, setShowClientPicker] = useState(false);

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
      {session?.type !== "member" && <div className="flex-shrink-0 border-b border-slate-100">
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
      </div>}

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
                    <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                      {PAGE_ICONS[item.id]?.(currentPage === item.id)}
                    </span>
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Identity + sign out */}
      <div className="px-3 py-3 border-t border-slate-200 flex-shrink-0 space-y-1">
        <div className="flex items-center gap-2.5 px-3 py-2">
          {session?.type === "member" ? (
            <>
              <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0"
                style={{ backgroundColor: activeProfile?.color || "#6366f1" }}>
                {activeProfile?.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-slate-700 truncate">{activeProfile?.name || session.name}</p>
                <p className="text-[10px] text-slate-400">Team member</p>
              </div>
            </>
          ) : (
            <>
              <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center text-indigo-600 text-xs font-bold flex-shrink-0">
                👑
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-slate-700">{session?.name || "Owner"}</p>
                <p className="text-[10px] text-slate-400">Full access</p>
              </div>
            </>
          )}
        </div>

        {/* Sign out */}
        <button
          onClick={onSignOut}
          className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
        >
          <span>↩</span> Sign out
        </button>
      </div>
    </aside>
  );
}
