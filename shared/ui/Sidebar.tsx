"use client";

import { useState } from "react";
import { Client, Notification, TeamMember, Workspace } from "@/shared/types";
import type { SessionPayload } from "@/shared/auth/session";
import { imgSrc } from "@/shared/media/videoSrc";

// The client's connected TikTok profile pic, if their own-profile has been scraped (cached JSON).
function tiktokAvatar(c: Client): string | undefined {
  try { const d = JSON.parse((c as any).tiktokProfileData || "{}"); return d?.profile?.avatarUrl || undefined; } // eslint-disable-line @typescript-eslint/no-explicit-any
  catch { return undefined; }
}

type Page = "headquarters" | "pipeline" | "kanban" | "tasks" | "concepts" | "analytics" | "instagram" | "board" | "dms" | "team" | "chat" | "settings" | "context" | "transcribe" | "clientsettings" | "tiktok" | "tiktokcompetitors" | "tiktokinstructions";

function IconHQ({ active }: { active: boolean }) {
  const c = active ? "white" : "rgba(147,197,253,0.6)";
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1.5L14 5v9.5H2V5L8 1.5z" stroke={c} strokeWidth="1.3" strokeLinejoin="round"/><rect x="5" y="9" width="2.2" height="5.5" fill={c}/><rect x="8.8" y="7" width="2.2" height="7.5" fill={c}/></svg>;
}
function IconCalendar({ active }: { active: boolean }) {
  const c = active ? "white" : "rgba(147,197,253,0.6)";
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="2.5" width="13" height="12" rx="2" stroke={c} strokeWidth="1.3"/><path d="M5 1.5V3.5M11 1.5V3.5" stroke={c} strokeWidth="1.3" strokeLinecap="round"/><path d="M1.5 6H14.5" stroke={c} strokeWidth="1.3"/><rect x="4" y="8.5" width="2" height="2" rx="0.5" fill={c}/><rect x="7" y="8.5" width="2" height="2" rx="0.5" fill={c}/><rect x="10" y="8.5" width="2" height="2" rx="0.5" fill={c}/></svg>;
}
function IconKanban({ active }: { active: boolean }) {
  const c = active ? "white" : "rgba(147,197,253,0.6)";
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="1.5" width="4" height="10" rx="1.5" stroke={c} strokeWidth="1.3"/><rect x="6" y="1.5" width="4" height="7" rx="1.5" stroke={c} strokeWidth="1.3"/><rect x="10.5" y="1.5" width="4" height="13" rx="1.5" stroke={c} strokeWidth="1.3"/></svg>;
}
function IconConcepts({ active }: { active: boolean }) {
  const c = active ? "white" : "rgba(147,197,253,0.6)";
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1.5C5.51 1.5 3.5 3.51 3.5 6c0 1.68.9 3.14 2.25 3.93V11h4.5V9.93C11.6 9.14 12.5 7.68 12.5 6c0-2.49-2.01-4.5-4.5-4.5z" stroke={c} strokeWidth="1.3" strokeLinejoin="round"/><path d="M5.75 11h4.5M6.5 13h3" stroke={c} strokeWidth="1.3" strokeLinecap="round"/></svg>;
}
function IconBrain({ active }: { active: boolean }) {
  const c = active ? "white" : "rgba(147,197,253,0.6)";
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2C6.9 2 6 2.67 6 3.5c0 .28.1.54.26.77C5.55 4.56 5 5.22 5 6c0 .55.23 1.05.6 1.4C5.23 7.75 5 8.25 5 8.8c0 .97.68 1.78 1.6 1.96V12h2.8v-1.24C10.32 10.58 11 9.77 11 8.8c0-.55-.23-1.05-.6-1.4.37-.35.6-.85.6-1.4 0-.78-.55-1.44-1.26-1.73.16-.23.26-.49.26-.77C10 2.67 9.1 2 8 2z" stroke={c} strokeWidth="1.2" strokeLinejoin="round"/><path d="M6.5 12h3M7 9.5h2M8 5.5V7.5" stroke={c} strokeWidth="1.2" strokeLinecap="round"/></svg>;
}
function IconAnalytics({ active }: { active: boolean }) {
  const c = active ? "white" : "rgba(147,197,253,0.6)";
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="7.5" width="3" height="6" rx="1" stroke={c} strokeWidth="1.3"/><rect x="6.5" y="4.5" width="3" height="9" rx="1" stroke={c} strokeWidth="1.3"/><rect x="11.5" y="2" width="3" height="11.5" rx="1" stroke={c} strokeWidth="1.3"/></svg>;
}
function IconDMs({ active }: { active: boolean }) {
  const c = active ? "white" : "rgba(147,197,253,0.6)";
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 3.5C2 2.67 2.67 2 3.5 2h9C13.33 2 14 2.67 14 3.5v7c0 .83-.67 1.5-1.5 1.5H9l-3 2v-2H3.5C2.67 12 2 11.33 2 10.5v-7z" stroke={c} strokeWidth="1.3" strokeLinejoin="round"/><path d="M5 6h6M5 8.5h3.5" stroke={c} strokeWidth="1.3" strokeLinecap="round"/></svg>;
}
function IconInstagram({ active }: { active: boolean }) {
  const c = active ? "white" : "rgba(147,197,253,0.6)";
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="3.5" stroke={c} strokeWidth="1.3"/><circle cx="8" cy="8" r="2.5" stroke={c} strokeWidth="1.3"/><circle cx="11.5" cy="4.5" r="0.75" fill={c}/></svg>;
}
function IconBoard({ active }: { active: boolean }) {
  const c = active ? "white" : "rgba(147,197,253,0.6)";
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="1.5" width="6" height="6" rx="1.5" stroke={c} strokeWidth="1.3"/><rect x="8.5" y="1.5" width="6" height="3.5" rx="1.5" stroke={c} strokeWidth="1.3"/><rect x="8.5" y="6.5" width="6" height="8" rx="1.5" stroke={c} strokeWidth="1.3"/><rect x="1.5" y="9" width="6" height="5.5" rx="1.5" stroke={c} strokeWidth="1.3"/></svg>;
}
function IconTeam({ active }: { active: boolean }) {
  const c = active ? "white" : "rgba(147,197,253,0.6)";
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="6" cy="5" r="2.5" stroke={c} strokeWidth="1.3"/><path d="M1.5 13.5c0-2.49 2.01-4.5 4.5-4.5s4.5 2.01 4.5 4.5" stroke={c} strokeWidth="1.3" strokeLinecap="round"/><circle cx="12" cy="5.5" r="1.8" stroke={c} strokeWidth="1.2"/><path d="M14.5 12.5c0-1.66-1.12-3.08-2.67-3.42" stroke={c} strokeWidth="1.2" strokeLinecap="round"/></svg>;
}
function IconChat({ active }: { active: boolean }) {
  const c = active ? "white" : "rgba(147,197,253,0.6)";
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 3C2 2.45 2.45 2 3 2h10c.55 0 1 .45 1 1v7c0 .55-.45 1-1 1H9.5L7 14v-3H3c-.55 0-1-.45-1-1V3z" stroke={c} strokeWidth="1.3" strokeLinejoin="round"/><circle cx="5.5" cy="6.5" r="0.8" fill={c}/><circle cx="8" cy="6.5" r="0.8" fill={c}/><circle cx="10.5" cy="6.5" r="0.8" fill={c}/></svg>;
}
function IconSettings({ active }: { active: boolean }) {
  const c = active ? "white" : "rgba(147,197,253,0.6)";
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2" stroke={c} strokeWidth="1.3"/><path d="M8 1.5v1.2M8 13.3v1.2M1.5 8h1.2M13.3 8h1.2M3.4 3.4l.85.85M11.75 11.75l.85.85M12.6 3.4l-.85.85M4.25 11.75l-.85.85" stroke={c} strokeWidth="1.3" strokeLinecap="round"/></svg>;
}
function IconTasks({ active }: { active: boolean }) {
  const c = active ? "white" : "rgba(147,197,253,0.6)";
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2.5" width="12" height="11" rx="1.5" stroke={c} strokeWidth="1.3"/><path d="M4.8 6l1 1 1.8-1.8M4.8 10l1 1 1.8-1.8M9.5 6.2h2.2M9.5 10.2h2.2" stroke={c} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

function IconTranscribe({ active }: { active: boolean }) {
  const c = active ? "white" : "rgba(147,197,253,0.6)";
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="6" y="1.5" width="4" height="7.5" rx="2" stroke={c} strokeWidth="1.3"/><path d="M3.5 7.5a4.5 4.5 0 009 0" stroke={c} strokeWidth="1.3" strokeLinecap="round"/><path d="M8 12v2.5M5.5 14.5h5" stroke={c} strokeWidth="1.3" strokeLinecap="round"/></svg>;
}

function IconTikTok({ active }: { active: boolean }) {
  const c = active ? "white" : "rgba(147,197,253,0.6)";
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M9.3 1.8v8.3a2.4 2.4 0 11-2.4-2.4c.2 0 .4 0 .55.05" stroke={c} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/><path d="M9.3 1.8c.25 1.7 1.5 2.95 3.2 3.1" stroke={c} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function IconSearch({ active }: { active: boolean }) {
  const c = active ? "white" : "rgba(147,197,253,0.6)";
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.5" stroke={c} strokeWidth="1.3"/><path d="M10.5 10.5L14 14" stroke={c} strokeWidth="1.3" strokeLinecap="round"/></svg>;
}
function IconCompass({ active }: { active: boolean }) {
  const c = active ? "white" : "rgba(147,197,253,0.6)";
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke={c} strokeWidth="1.3"/><path d="M10.8 5.2L9.3 9.3 5.2 10.8 6.7 6.7 10.8 5.2z" stroke={c} strokeWidth="1.3" strokeLinejoin="round"/></svg>;
}

const PAGE_ICONS: Record<Page, (active: boolean) => React.ReactNode> = {
  headquarters: (a) => <IconHQ active={a} />,
  pipeline: (a) => <IconCalendar active={a} />, kanban: (a) => <IconKanban active={a} />,
  concepts: (a) => <IconConcepts active={a} />, context: (a) => <IconBrain active={a} />,
  analytics: (a) => <IconAnalytics active={a} />, dms: (a) => <IconDMs active={a} />,
  instagram: (a) => <IconInstagram active={a} />, board: (a) => <IconBoard active={a} />,
  team: (a) => <IconTeam active={a} />, chat: (a) => <IconChat active={a} />,
  tasks: (a) => <IconTasks active={a} />,
  transcribe: (a) => <IconTranscribe active={a} />,
  settings: (a) => <IconSettings active={a} />,
  clientsettings: (a: boolean) => <IconSettings active={a} />,
  tiktok: (a) => <IconTikTok active={a} />,
  tiktokcompetitors: (a) => <IconSearch active={a} />,
  tiktokinstructions: (a) => <IconCompass active={a} />,
};

const NAV_GROUPS = [
  { label: "WORK", items: [
    { id: "pipeline" as Page, label: "Content Scheduling" },
    { id: "kanban" as Page, label: "Script Kanban" },
    { id: "tasks" as Page, label: "Script Tasks" },
    { id: "concepts" as Page, label: "Concept Library" },
    { id: "context" as Page, label: "AI Context" },
    { id: "analytics" as Page, label: "Analytics" },
    { id: "dms" as Page, label: "DM Pipeline" },
    { id: "instagram" as Page, label: "Instagram" },
    { id: "tiktok" as Page, label: "TikTok" },
    { id: "tiktokinstructions" as Page, label: "Instructions" },
    { id: "tiktokcompetitors" as Page, label: "Competitors" },
    { id: "board" as Page, label: "Strategy Board" },
    { id: "transcribe" as Page, label: "Transcribe" },
  ]},
  { label: "MANAGE", items: [
    { id: "team" as Page, label: "Team" },
    { id: "chat" as Page, label: "Messages" },
    { id: "clientsettings" as Page, label: "Settings" }, // this client's settings (incl. TikTok)
  ]},
];

type Props = {
  currentPage: Page; onNavigate: (page: Page) => void;
  clients: Client[]; selectedClientId: number | null; onSelectClient: (id: number | null) => void;
  unreadCount: number; notifications: Notification[]; onMarkRead: (id: number) => void; onMarkAllRead: () => void;
  badges?: Partial<Record<Page, number>>;
  allowedPages: Page[]; activeProfile: TeamMember | null; session: SessionPayload | null; onSignOut: () => void;
  ownerEmail?: string | null;
  collapsed?: boolean; onToggleCollapsed?: () => void;
  splitPage?: Page | null; onOpenSplit?: (page: Page) => void;
  workspaces?: Workspace[]; activeWorkspaceId?: number | null;
  onSelectWorkspace?: (id: number) => void; onCreateWorkspace?: (name: string) => void;
  tiktokEnabled?: boolean; instagramEnabled?: boolean; platform?: "instagram" | "tiktok"; onSelectPlatform?: (p: "instagram" | "tiktok") => void;
  onMoveClient?: (clientId: number, workspaceId: number) => void;
};

// Page lists for the per-platform folders (shown only when a client has TikTok enabled).
const PAGE_NAV_LABEL: Record<string, string> = {
  pipeline: "Content Scheduling", kanban: "Script Kanban", tasks: "Script Tasks",
  concepts: "Concept Library", context: "AI Context", analytics: "Analytics",
  dms: "DM Pipeline", instagram: "Instagram", tiktok: "TikTok", tiktokcompetitors: "Competitors", tiktokinstructions: "Instructions", board: "Strategy Board", transcribe: "Transcribe",
};
const IG_FOLDER: Page[] = ["pipeline", "kanban", "tasks", "concepts", "context", "analytics", "dms", "instagram"];
const TT_FOLDER: Page[] = ["tiktok", "tiktokinstructions", "tiktokcompetitors", "concepts", "analytics"];
const SHARED_WORK: Page[] = ["board", "transcribe"];

const DIVIDER = { borderColor: "rgba(255,255,255,0.08)" };
const STRIP_BG = "#0f1c34";
const NAV_BG = "#1a2f52";

export default function Sidebar({ currentPage, onNavigate, clients, selectedClientId, onSelectClient, allowedPages, activeProfile, session, onSignOut, ownerEmail, badges, collapsed = false, onToggleCollapsed, splitPage, onOpenSplit, workspaces, activeWorkspaceId, onSelectWorkspace, onCreateWorkspace, tiktokEnabled, instagramEnabled = true, platform = "instagram", onSelectPlatform, onMoveClient }: Props) {
  const [showAccount, setShowAccount] = useState(false);
  const [peeking, setPeeking] = useState(false);
  const [showClientPicker, setShowClientPicker] = useState(false);
  const activeClient = clients.find((c) => c.id === selectedClientId) ?? null;
  // Client accounts only ever have one project — hide the project-switcher strip for them.
  // Team members keep it (so they can toggle between projects they're assigned to).
  const isClient = session?.type === "member" && !!activeProfile?.isClientAccount;

  // Collapsible client-switcher strip (persisted).
  const collapsible = !isClient || clients.length > 1;
  const [stripCollapsed, setStripCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem("cf_strip_collapsed") === "1"; } catch { return false; }
  });
  const toggleStrip = () => setStripCollapsed((v) => {
    const n = !v;
    try { localStorage.setItem("cf_strip_collapsed", n ? "1" : "0"); } catch { /* ignore */ }
    return n;
  });
  const showStrip = collapsible && !stripCollapsed;
  // Arc-style: when fully collapsed, the sidebar hides and peeks out when you hover the
  // far-left edge. "visible" = shown (either pinned open, or peeking while collapsed).
  const visible = !collapsed || peeking;

  // Custom project order (drag to reorder), persisted per browser.
  const [order, setOrder] = useState<number[]>(() => {
    try { return JSON.parse(localStorage.getItem("cf_client_order") || "[]"); } catch { return []; }
  });
  const [dragId, setDragId] = useState<number | null>(null);
  // Right-click a client avatar → move it to another workspace/project (owner only).
  const [clientMenu, setClientMenu] = useState<{ x: number; y: number; client: Client } | null>(null);
  const [wsMenu, setWsMenu] = useState(false);
  const activeWs = (workspaces || []).find((w) => w.id === activeWorkspaceId) || (workspaces || [])[0] || null;
  const [foldersClosed, setFoldersClosed] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem("cf_folders_closed") || "{}"); } catch { return {}; }
  });
  function toggleFolder(key: string) {
    setFoldersClosed((prev) => { const n = { ...prev, [key]: !prev[key] }; try { localStorage.setItem("cf_folders_closed", JSON.stringify(n)); } catch { /* ignore */ } return n; });
  }
  // Owners with workspaces see only the active workspace's clients; members are unaffected.
  const scopedClients = (session?.type === "owner" && activeWorkspaceId != null)
    ? clients.filter((c) => c.workspaceId === activeWorkspaceId)
    : clients;
  const orderedClients = [...scopedClients].sort((a, b) => {
    const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
    if (ia === -1 && ib === -1) return 0;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  function reorderTo(targetId: number) {
    if (dragId == null || dragId === targetId) { setDragId(null); return; }
    const ids = orderedClients.map((c) => c.id);
    const from = ids.indexOf(dragId), to = ids.indexOf(targetId);
    if (from === -1 || to === -1) { setDragId(null); return; }
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    setOrder(ids);
    try { localStorage.setItem("cf_client_order", JSON.stringify(ids)); } catch { /* ignore */ }
    setDragId(null);
  }

  return (
    <>
    {/* Left-edge hover zone — when collapsed, hovering here peeks the sidebar out */}
    {collapsed && (
      <div className="fixed top-0 left-0 h-full z-40" style={{ width: 12 }}
        onMouseEnter={() => setPeeking(true)} title="Show sidebar" />
    )}

    <aside
      className="fixed top-0 left-0 h-full flex z-50"
      style={{
        width: 280,
        transform: visible ? "translateX(0)" : "translateX(-100%)",
        transition: "transform 200ms ease",
        boxShadow: collapsed && peeking ? "8px 0 40px rgba(0,0,0,0.35)" : "none",
      }}
      onMouseLeave={() => { if (collapsed) setPeeking(false); }}
    >
      {/* Pin open (when peeking) / hide (when open) toggle */}
      {onToggleCollapsed && (
        <button
          onClick={() => { onToggleCollapsed(); setPeeking(false); }}
          title={collapsed ? "Pin sidebar open" : "Hide sidebar"}
          className="absolute top-2 right-2 z-10 w-6 h-6 rounded-md flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all text-xs">
          {collapsed ? "📌" : "«"}
        </button>
      )}

      {/* ── LEFT STRIP — client/project switcher (collapsible) ── */}
      {showStrip && (
      <div className="flex flex-col h-full flex-shrink-0" style={{ width: 56, backgroundColor: STRIP_BG }}>

        {/* Headquarters — pinned global view above all clients (owner only). */}
        {session?.type !== "member" && (
          <div className="flex flex-col items-center pt-3 pb-2.5 flex-shrink-0" style={{ borderBottom: `1px solid ${DIVIDER.borderColor}` }}>
            <button onClick={() => { onSelectClient(null); onNavigate("headquarters"); }} title="Headquarters — overview of all clients"
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-all flex-shrink-0"
              style={{
                backgroundColor: currentPage === "headquarters" ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.06)",
                boxShadow: currentPage === "headquarters" ? "0 0 0 2px white" : "none",
              }}>
              <IconHQ active={currentPage === "headquarters"} />
            </button>
          </div>
        )}

        {/* Client avatars + add button (Discord-style: add sits under the last project) */}
        <div className="flex flex-col items-center gap-2.5 py-3 flex-1 overflow-y-auto">
          {orderedClients.map((c) => {
            const rawPic = (c.instagramConnection as any)?.profilePictureUrl || tiktokAvatar(c); // eslint-disable-line @typescript-eslint/no-explicit-any
            const pic = rawPic ? imgSrc(rawPic) : undefined;
            return (
              <button key={c.id} onClick={() => { onSelectClient(c.id); if (currentPage === "headquarters") onNavigate("kanban"); }}
                title={`${c.name} — drag to reorder${session?.type === "owner" && workspaces && workspaces.length > 1 ? " · right-click to move project" : ""}`}
                draggable
                onDragStart={() => setDragId(c.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => reorderTo(c.id)}
                onDragEnd={() => setDragId(null)}
                onContextMenu={(e) => { if (session?.type === "owner" && workspaces && workspaces.length > 1) { e.preventDefault(); setClientMenu({ x: e.clientX, y: e.clientY, client: c }); } }}
                className="w-9 h-9 rounded-xl overflow-hidden flex items-center justify-center text-[10px] font-bold text-white transition-all flex-shrink-0 cursor-grab active:cursor-grabbing"
                style={{
                  backgroundColor: c.color,
                  opacity: dragId === c.id ? 0.3 : c.id === selectedClientId ? 1 : 0.45,
                  boxShadow: c.id === selectedClientId ? "0 0 0 2px white" : "none",
                }}>
                {pic
                  ? <img src={pic} alt={c.name} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  : c.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()
                }
              </button>
            );
          })}
          {session?.type !== "member" && (
            <button onClick={() => onNavigate("settings")} title="Add client"
              className="w-9 h-9 rounded-xl flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all text-xl font-light flex-shrink-0">
              +
            </button>
          )}
        </div>

        {clientMenu && (
          <>
            <div className="fixed inset-0 z-[90]" onClick={() => setClientMenu(null)} onContextMenu={(e) => { e.preventDefault(); setClientMenu(null); }} />
            <div className="fixed z-[91] w-56 bg-white border border-slate-200 rounded-xl shadow-xl py-1 max-h-72 overflow-auto text-slate-800"
              style={{ left: Math.min(clientMenu.x, (typeof window !== "undefined" ? window.innerWidth : 1200) - 232), top: Math.min(clientMenu.y, (typeof window !== "undefined" ? window.innerHeight : 800) - 300) }}>
              <p className="px-3 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wide truncate">Move {clientMenu.client.name} to</p>
              {(workspaces || []).filter((w) => w.id !== clientMenu.client.workspaceId).map((w) => (
                <button key={w.id} onClick={() => { onMoveClient?.(clientMenu.client.id, w.id); setClientMenu(null); }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-100 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: w.color }} />
                  <span className="truncate">{w.name}</span>
                </button>
              ))}
              {(workspaces || []).filter((w) => w.id !== clientMenu.client.workspaceId).length === 0 && (
                <p className="px-3 py-2 text-xs text-slate-400">No other projects.</p>
              )}
            </div>
          </>
        )}

        {/* Workspace switcher (owner only) — pinned at the bottom of the strip. */}
        {session?.type === "owner" && workspaces && workspaces.length > 0 && activeWs && (
          <div className="relative flex flex-col items-center pt-2.5 pb-2 flex-shrink-0" style={{ borderTop: `1px solid ${DIVIDER.borderColor}` }}>
            <button onClick={() => setWsMenu((o) => !o)} title={`Workspace: ${activeWs.name}`}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-[11px] font-bold text-white transition-all flex-shrink-0"
              style={{ backgroundColor: activeWs.color, boxShadow: "0 0 0 2px rgba(255,255,255,0.25)" }}>
              {activeWs.name.slice(0, 2).toUpperCase()}
            </button>
            {wsMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setWsMenu(false)} />
                <div className="absolute left-full bottom-0 ml-1 w-52 bg-white rounded-xl o-elev-lift z-50 p-1.5 text-ink">
                  <p className="text-[10px] font-semibold text-faint uppercase tracking-wide px-2 py-1">Workspaces</p>
                  {workspaces.map((w) => (
                    <button key={w.id} onClick={() => { onSelectWorkspace?.(w.id); setWsMenu(false); }}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-sm ${w.id === activeWs.id ? "bg-accent-tint" : "hover:bg-slate-50"}`}>
                      <span className="w-5 h-5 rounded-md flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0" style={{ backgroundColor: w.color }}>{w.name.slice(0, 2).toUpperCase()}</span>
                      <span className="flex-1 truncate font-medium text-ink">{w.name}</span>
                      <span className="text-[10px] text-faint">{w._count?.clients ?? ""}</span>
                    </button>
                  ))}
                  <button onClick={() => { const n = prompt("New workspace name:"); if (n && n.trim()) onCreateWorkspace?.(n.trim()); setWsMenu(false); }}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-sm text-accent hover:bg-accent-tint mt-0.5">
                    <span className="w-5 h-5 rounded-md flex items-center justify-center text-sm flex-shrink-0 border border-dashed border-accent/40">＋</span>
                    <span className="font-semibold">New workspace</span>
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Collapse the strip */}
        <button onClick={toggleStrip} title="Hide client switcher"
          className="flex items-center justify-center py-1.5 flex-shrink-0 text-white/30 hover:text-white hover:bg-white/5 transition-all text-sm"
          style={{ borderTop: `1px solid ${DIVIDER.borderColor}` }}>
          ‹
        </button>

        {/* Strip footer: owner = Settings/client-management button (👑); member = avatar */}
        <div className="flex items-center justify-center py-3 flex-shrink-0" style={{ borderTop: `1px solid ${DIVIDER.borderColor}`, height: 48 }}>
          {session?.type !== "member" ? (
            <button onClick={() => onNavigate("settings")} title="Settings — workspace & clients"
              className="w-8 h-8 rounded-xl flex items-center justify-center transition-all hover:bg-white/10"
              style={{
                backgroundColor: currentPage === "settings" ? "rgba(255,255,255,0.12)" : "transparent",
                boxShadow: currentPage === "settings" ? "0 0 0 2px rgba(255,255,255,0.5)" : "none",
              }}>
              <IconSettings active={currentPage === "settings"} />
            </button>
          ) : (
            <div className="w-8 h-8 rounded-xl flex items-center justify-center text-[10px] font-bold text-white"
              style={{ backgroundColor: activeProfile?.color || "#6366f1" }}>
              {activeProfile?.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?"}
            </div>
          )}
        </div>
      </div>
      )}

      {/* ── RIGHT NAV ── */}
      <div className="flex flex-col flex-1 h-full" style={{ backgroundColor: NAV_BG }}>

        {/* Expand the strip when it's collapsed */}
        {collapsible && stripCollapsed && (
          <button onClick={toggleStrip} title="Show client switcher"
            className="flex items-center gap-1.5 px-3 pt-3 pb-1 text-[11px] font-medium transition-colors"
            style={{ color: "rgba(147,197,253,0.55)" }}>
            <span className="text-sm">›</span> Clients
          </button>
        )}

        {/* Nav items */}
        <nav className="flex-1 px-3 py-3 space-y-4 overflow-y-auto">
          {(() => {
            const renderItem = (id: Page, label: string, active: boolean, onClick: () => void, keyPrefix = "") => (
              <div key={`${keyPrefix}${id}`} className="group relative">
                <button onClick={onClick}
                  className="w-full flex items-center gap-2.5 px-3 py-2 pr-9 rounded-lg text-sm font-medium transition-all text-left"
                  style={{ backgroundColor: active ? "rgba(255,255,255,0.12)" : "transparent", color: active ? "white" : "rgba(147,197,253,0.65)" }}
                  onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(255,255,255,0.06)"; }}
                  onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}>
                  <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">{PAGE_ICONS[id]?.(active)}</span>
                  <span className="flex-1 min-w-0 truncate whitespace-nowrap">{label}</span>
                </button>
                <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  {!!badges?.[id] && (
                    <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                      {badges[id]! > 9 ? "9+" : badges[id]}
                    </span>
                  )}
                  {onOpenSplit && (
                    <button onClick={(e) => { e.stopPropagation(); onOpenSplit(id); }}
                      title={splitPage === id ? "Showing in split" : "Open in split view →"}
                      className={`w-6 h-6 rounded-md flex items-center justify-center text-[12px] transition-opacity ${splitPage === id ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                      style={{ color: splitPage === id ? "white" : "rgba(147,197,253,0.85)", backgroundColor: splitPage === id ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.1)" }}>⇆</button>
                  )}
                </div>
              </div>
            );
            const groupHeader = (label: string) => (
              <p className="text-[10px] font-semibold px-3 mb-1.5 tracking-wider" style={{ color: "rgba(147,197,253,0.35)" }}>{label}</p>
            );
            // Collapsible folder header (for the Instagram / TikTok platform folders).
            const folderHeader = (label: string, key: string) => (
              <button onClick={() => toggleFolder(key)}
                className="w-full flex items-center gap-1 px-3 mb-1.5 text-[10px] font-semibold tracking-wider hover:text-white/70 transition-colors"
                style={{ color: "rgba(147,197,253,0.45)" }}>
                <span className="text-[8px] w-2 inline-block transition-transform" style={{ transform: foldersClosed[key] ? "rotate(-90deg)" : "none" }}>▼</span>
                {label}
              </button>
            );

            const igOn = instagramEnabled !== false;
            const ttOn = !!tiktokEnabled;
            const manage = NAV_GROUPS.find((g) => g.label === "MANAGE")?.items.filter((i) => allowedPages.includes(i.id)) || [];
            const sharedItems = SHARED_WORK.filter((id) => allowedPages.includes(id));

            // Only one platform on (owner) → flat nav for that platform (no folders needed).
            if (session?.type === "owner" && ttOn && !igOn) {
              const ttItems = TT_FOLDER.filter((id) => allowedPages.includes(id));
              return (
                <>
                  <div>
                    {groupHeader("🎵 TIKTOK")}
                    <div className="space-y-0.5">
                      {ttItems.map((id) => renderItem(id, PAGE_NAV_LABEL[id] || id, currentPage === id, () => { onSelectPlatform?.("tiktok"); onNavigate(id); }, "tt-"))}
                    </div>
                  </div>
                  {sharedItems.length > 0 && <div>{groupHeader("WORK")}<div className="space-y-0.5">{sharedItems.map((id) => renderItem(id, PAGE_NAV_LABEL[id] || id, currentPage === id, () => onNavigate(id), "sh-"))}</div></div>}
                  {manage.length > 0 && <div>{groupHeader("MANAGE")}<div className="space-y-0.5">{manage.map((item) => renderItem(item.id, item.label, currentPage === item.id, () => onNavigate(item.id), "mg-"))}</div></div>}
                </>
              );
            }

            // Both platforms on (owner) → split WORK into per-platform folders.
            if (session?.type === "owner" && ttOn && igOn) {
              const igItems = IG_FOLDER.filter((id) => allowedPages.includes(id));
              const ttItems = TT_FOLDER.filter((id) => allowedPages.includes(id));
              return (
                <>
                  <div>
                    {folderHeader("📸 INSTAGRAM", "instagram")}
                    {!foldersClosed["instagram"] && (
                      <div className="space-y-0.5">
                        {igItems.map((id) => renderItem(id, PAGE_NAV_LABEL[id] || id, currentPage === id && platform === "instagram", () => { onSelectPlatform?.("instagram"); onNavigate(id); }, "ig-"))}
                      </div>
                    )}
                  </div>
                  <div>
                    {folderHeader("🎵 TIKTOK", "tiktok")}
                    {!foldersClosed["tiktok"] && (
                      <div className="space-y-0.5">
                        {ttItems.map((id) => renderItem(id, PAGE_NAV_LABEL[id] || id, currentPage === id && platform === "tiktok", () => { onSelectPlatform?.("tiktok"); onNavigate(id); }, "tt-"))}
                      </div>
                    )}
                  </div>
                  {sharedItems.length > 0 && (
                    <div>
                      {groupHeader("WORK")}
                      <div className="space-y-0.5">
                        {sharedItems.map((id) => renderItem(id, PAGE_NAV_LABEL[id] || id, currentPage === id, () => { onSelectPlatform?.("instagram"); onNavigate(id); }, "sh-"))}
                      </div>
                    </div>
                  )}
                  {manage.length > 0 && (
                    <div>
                      {groupHeader("MANAGE")}
                      <div className="space-y-0.5">
                        {manage.map((item) => renderItem(item.id, item.label, currentPage === item.id, () => onNavigate(item.id), "mg-"))}
                      </div>
                    </div>
                  )}
                </>
              );
            }

            // Only Instagram on (owner) → same collapsible Instagram folder as the both-platforms
            // case, just without the TikTok folder, so the grouping doesn't change when TikTok is off.
            if (session?.type === "owner" && igOn && !ttOn) {
              const igItems = IG_FOLDER.filter((id) => allowedPages.includes(id));
              return (
                <>
                  <div>
                    {folderHeader("📸 INSTAGRAM", "instagram")}
                    {!foldersClosed["instagram"] && (
                      <div className="space-y-0.5">
                        {igItems.map((id) => renderItem(id, PAGE_NAV_LABEL[id] || id, currentPage === id && platform === "instagram", () => { onSelectPlatform?.("instagram"); onNavigate(id); }, "ig-"))}
                      </div>
                    )}
                  </div>
                  {sharedItems.length > 0 && (
                    <div>
                      {groupHeader("WORK")}
                      <div className="space-y-0.5">
                        {sharedItems.map((id) => renderItem(id, PAGE_NAV_LABEL[id] || id, currentPage === id, () => { onSelectPlatform?.("instagram"); onNavigate(id); }, "sh-"))}
                      </div>
                    </div>
                  )}
                  {manage.length > 0 && (
                    <div>
                      {groupHeader("MANAGE")}
                      <div className="space-y-0.5">
                        {manage.map((item) => renderItem(item.id, item.label, currentPage === item.id, () => onNavigate(item.id), "mg-"))}
                      </div>
                    </div>
                  )}
                </>
              );
            }

            // Default flat nav. Hide platform-specific pages when that platform is off for the
            // client — a TikTok-disabled client must never show the TikTok tab (to owner OR client).
            const platformHidden = (id: Page) => ((id === "tiktok" || id === "tiktokcompetitors" || id === "tiktokinstructions") && !ttOn) || (id === "instagram" && !igOn);
            return NAV_GROUPS.map((group) => {
              const visibleItems = group.items.filter((item) => allowedPages.includes(item.id) && !platformHidden(item.id));
              if (visibleItems.length === 0) return null;
              return (
                <div key={group.label}>
                  {groupHeader(group.label)}
                  <div className="space-y-0.5">
                    {visibleItems.map((item) => renderItem(item.id, item.label, currentPage === item.id, () => onNavigate(item.id)))}
                  </div>
                </div>
              );
            });
          })()}
        </nav>

        {/* Footer: account + sign out */}
        <div className="px-3 py-2 flex-shrink-0" style={{ borderTop: `1px solid ${DIVIDER.borderColor}` }}>
          <div className="flex items-center gap-2 px-2 py-1">
            {/* Account — click for connected email / role */}
            <div className="relative flex-1 min-w-0">
              <button onClick={() => setShowAccount((s) => !s)}
                className="flex items-center gap-1.5 text-xs font-semibold text-white truncate hover:text-white/80 transition-colors w-full text-left">
                <span className="truncate">{session?.type === "member" ? (activeProfile?.name || session.name) : (session?.name || "Owner")}</span>
                <span className="text-white/40 text-[10px]">▾</span>
              </button>
              {showAccount && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowAccount(false)} />
                  <div className="absolute bottom-9 left-0 w-72 bg-white border border-slate-200 rounded-xl shadow-2xl z-50 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                        style={{ backgroundColor: session?.type === "member" ? (activeProfile?.color || "#6366f1") : "#3b5bdb" }}>
                        {session?.type === "member"
                          ? (activeProfile?.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?")
                          : "👑"}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{session?.type === "member" ? (activeProfile?.name || session.name) : (session?.name || "Owner")}</p>
                        <p className="text-[11px] text-slate-400">
                          {session?.type === "member" ? (activeProfile?.isClientAccount ? "Client" : (activeProfile?.role || "Team member")) : "Owner"}
                        </p>
                      </div>
                    </div>
                    <div className="px-4 py-3 space-y-2">
                      <div>
                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Email</p>
                        <p className="text-sm text-slate-700 truncate">
                          {session?.type === "member" ? (activeProfile?.email || "—") : (ownerEmail || "—")}
                        </p>
                      </div>
                      {session?.type === "member" && activeProfile?.isClientAccount && (
                        <div>
                          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Instagram</p>
                          <p className="text-sm text-slate-700 truncate">
                            {(clients.find((c) => c.id === activeProfile.clientId)?.instagramConnection as any)?.username
                              ? `@${(clients.find((c) => c.id === activeProfile.clientId)?.instagramConnection as any).username}`
                              : "Not connected"}
                          </p>
                        </div>
                      )}
                    </div>
                    <button onClick={onSignOut}
                      className="w-full text-left px-4 py-2.5 text-sm font-medium text-red-500 hover:bg-red-50 border-t border-slate-100">
                      ↩ Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
            <button onClick={onSignOut} title="Sign out"
              className="w-7 h-7 flex items-center justify-center rounded-lg text-white/30 hover:text-red-400 hover:bg-white/10 transition-all text-sm flex-shrink-0">
              ↩
            </button>
          </div>
        </div>
      </div>
    </aside>
    </>
  );
}
