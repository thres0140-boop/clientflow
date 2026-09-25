"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Sidebar from "@/shared/ui/Sidebar";
import Pipeline from "@/features/content/pages/Pipeline";
import Concepts from "@/features/scripts/pages/Concepts";
import Analytics from "@/features/analytics/pages/Analytics";
import TeamPage from "@/features/clients/pages/TeamPage";
import ChatPage from "@/features/chat/pages/ChatPage";
import SettingsPage from "@/features/clients/pages/SettingsPage";
import Kanban from "@/features/scripts/pages/Kanban";
import ScriptTasksPage from "@/features/scripts/pages/ScriptTasksPage";
import InstagramPage from "@/features/instagram/pages/InstagramPage";
import BoardPage from "@/features/content/pages/BoardPage";
import ClientSettingsPage from "@/features/clients/pages/ClientSettingsPage";
import DmsPage from "@/features/instagram/pages/DmsPage";
import ContextPage from "@/features/scripts/pages/ContextPage";
import TranscribePage from "@/features/content/pages/TranscribePage";
import CapCutPage from "@/features/editor/pages/CapCutPage";
import { Client, Notification, TeamMember, Workspace } from "@/shared/types";
import type { SessionPayload } from "@/shared/auth/session";
import { applyTheme, readStoredTheme, startThemeColorSync } from "@/shared/theme";
import { countUnseenSentBack } from "@/features/scripts/sentBackSeen";
import { buildDeepLinkSearch, parseDeepLink, readEmbedFlag, type OrdoClientsMessage, type OrdoNavigateMessage, type ParentNavigateMessage } from "@/shared/embed";

export type Page =
  | "pipeline"
  | "kanban"
  | "tasks"
  | "concepts"
  | "analytics"
  | "dms"
  | "iginbox"
  | "instagram"
  | "board"
  | "team"
  | "chat"
  | "settings"
  | "context"
  | "transcribe"
  | "capcut"
  | "clientsettings"
  | "ytkanban"
  | "ytclipping";

const PAGE_LABELS: Record<Page, string> = {
  pipeline: "Content Scheduling", kanban: "Script Kanban",
  tasks: "Script Tasks", concepts: "Concept Library", analytics: "Analytics", dms: "DM Pipeline",
  iginbox: "Instagram Inbox", instagram: "Instagram", board: "Strategy Board", team: "Team", chat: "Messages",
  settings: "Settings", context: "AI Context", transcribe: "Transcribe", capcut: "CapCut", clientsettings: "Settings",
  ytkanban: "YouTube Kanban", ytclipping: "Clipping",
};

// The platform the content pages operate on. Must stay in step with PlatformId in
// shared/agencyPlatforms.ts (the API filter contract). "tiktok" is data-only in the agency app: it
// lives on in stored rows but is never selectable here (TikTok moved to the AI product).
export type Platform = "instagram" | "tiktok" | "youtube";
// Platforms the agency app can actually put on screen.
const isSelectablePlatform = (p: unknown): p is Platform => p === "instagram" || p === "youtube";

// Pages that only exist inside one platform's folder. Cross-platform pages (WORK / MANAGE /
// Editing) are left alone by the platform bounce below.
const IG_ONLY_PAGES: Page[] = ["instagram", "kanban", "tasks", "context", "dms", "iginbox"];
const YT_ONLY_PAGES: Page[] = ["ytkanban", "ytclipping"];

const isPage = (p: string): p is Page => p in PAGE_LABELS;

export default function App() {
  // Deep link (?page=&clientId=&draft=) — used by the Cenks Dashboard embed and by refreshes.
  const [deepLink] = useState(() => parseDeepLink(isPage));
  // Embedded inside the Cenks Dashboard iframe: no own sidebar, navigation mirrored to parent.
  const [embedded] = useState(() => readEmbedFlag());

  const [page, setPage] = useState<Page>(() => {
    if (deepLink.page) return deepLink.page as Page;
    // Validate the stored id: a browser may still hold a page that no longer exists.
    try { const v = localStorage.getItem("cf_active_page"); return v && isPage(v) ? v : "pipeline"; } catch { return "pipeline"; }
  });
  // The platform the content pages operate on (Instagram or YouTube). Persisted so a refresh keeps
  // you on the platform you were viewing; a stale value (e.g. "tiktok") falls back to Instagram.
  const [platform, setPlatform] = useState<Platform>(() => {
    try { const v = localStorage.getItem("cf_active_platform"); return isSelectablePlatform(v) ? v : "instagram"; } catch { return "instagram"; }
  });
  // Split view: when set, a second page renders in a resizable right pane next to `page`.
  const [splitPage, setSplitPage] = useState<Page | null>(null);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<number | null>(deepLink.clientId);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<number | null>(() => {
    try { const v = localStorage.getItem("cf_active_workspace"); return v ? parseInt(v) : null; } catch { return null; }
  });
  const [chatContext, setChatContext] = useState<{ id?: number; title: string; hook?: string | null; script: string; caption?: string | null; channel?: string } | null>(null);
  // When set, the Instagram reels view enters "attach mode" — clicking reels adds them to this concept
  const [attachConcept, setAttachConcept] = useState<{ id: number; name: string } | null>(null);
  const [kanbanHighlightId, setKanbanHighlightId] = useState<number | null>(deepLink.draft);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<number | null>(null);
  const [activeProfile, setActiveProfile] = useState<TeamMember | null>(null);
  const [session, setSession] = useState<SessionPayload | null>(null);
  // Projects this logged-in member belongs to (shared-email grouping) — drives the
  // client project-switcher for multi-project clients/members.
  const [projects, setProjects] = useState<{ memberId: number; clientId: number; clientName: string | null; isClientAccount: boolean }[]>([]);
  const [ownerName, setOwnerName] = useState("Cenk");
  const [ownerEmail, setOwnerEmail] = useState<string | null>(null);
  const [appReady, setAppReady] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchClients = useCallback(async () => {
    const data: Client[] = await fetch("/api/clients").then((r) => r.json());
    setClients(data);
    // Embedded in the Cenks Dashboard: hand it the client list for its own client switcher.
    if (embedded && window.parent !== window && Array.isArray(data)) {
      const msg: OrdoClientsMessage = {
        type: "ordo:clients",
        clients: data.map((c) => ({ id: c.id, name: c.name, color: c.color, platform: c.platform, workspace: (c as { workspace?: { name?: string } | null }).workspace?.name ?? null })),
      };
      window.parent.postMessage(msg, "*");
    }
    // Always keep a client selected — default to first if none saved
    setSelectedClientId((prev) => {
      if (prev !== null) return prev;
      const saved = localStorage.getItem("cf_active_client");
      if (saved) {
        const id = parseInt(saved);
        if (data.find((c) => c.id === id)) return id;
      }
      return data[0]?.id ?? null;
    });
  }, [embedded]);

  const fetchWorkspaces = useCallback(async () => {
    try {
      const data: Workspace[] = await fetch("/api/workspaces").then((r) => r.json());
      if (!Array.isArray(data)) return;
      setWorkspaces(data);
      setActiveWorkspaceId((prev) => (prev && data.find((w) => w.id === prev)) ? prev : (data[0]?.id ?? null));
    } catch { /* ignore */ }
  }, []);

  async function createWorkspace(name: string) {
    const ws = await fetch("/api/workspaces", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }).then((r) => r.json());
    await fetchWorkspaces();
    if (ws?.id) selectWorkspace(ws.id);
  }

  // Clients visible inside a workspace: its own plus any UNASSIGNED client (workspaceId null),
  // which the sidebar shows everywhere so it can never vanish.
  const clientsVisibleIn = (list: Client[], wsId: number | null) =>
    list.filter((c) => c.workspaceId === wsId || c.workspaceId == null);

  function selectWorkspace(id: number) {
    setActiveWorkspaceId(id);
    try { localStorage.setItem("cf_active_workspace", String(id)); } catch { /* ignore */ }
    // Keep a valid client selected: if the current one isn't in this workspace, jump to its first.
    setSelectedClientId((prev) => {
      const inWs = clientsVisibleIn(clients, id);
      if (prev != null && inWs.some((c) => c.id === prev)) return prev;
      return inWs[0]?.id ?? null;
    });
  }

  // Delete a workspace = remove the grouping. Its clients are NOT deleted (Client.workspaceId is
  // SetNull); they become unassigned and show in every workspace until moved. If the deleted one
  // was active, fall back to another workspace and keep a valid client selected.
  async function deleteWorkspace(id: number) {
    const ws = workspaces.find((w) => w.id === id);
    if (!ws) return;
    const inside = clients.filter((c) => c.workspaceId === id);
    const who = inside.length === 0
      ? "It has no clients."
      : `Its ${inside.length} client${inside.length === 1 ? "" : "s"} (${inside.map((c) => c.name).join(", ")}) will NOT be deleted — ${inside.length === 1 ? "it" : "they"} become unassigned and show in every workspace until you move ${inside.length === 1 ? "it" : "them"}.`;
    if (!confirm(`Delete workspace "${ws.name}"?\n\n${who}\n\nThis only removes the workspace grouping; no client data is touched.`)) return;
    const res = await fetch(`/api/workspaces/${id}`, { method: "DELETE" });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { alert(d?.error || "Couldn't delete the workspace."); return; }
    const [wsList, clientList] = await Promise.all([
      fetch("/api/workspaces").then((r) => r.json()).catch(() => []),
      fetch("/api/clients").then((r) => r.json()).catch(() => []),
    ]);
    const nextWs: Workspace[] = Array.isArray(wsList) ? wsList : [];
    const nextClients: Client[] = Array.isArray(clientList) ? clientList : [];
    setWorkspaces(nextWs);
    setClients(nextClients);
    const nextActive = activeWorkspaceId === id || !nextWs.some((w) => w.id === activeWorkspaceId)
      ? (nextWs[0]?.id ?? null)
      : activeWorkspaceId;
    setActiveWorkspaceId(nextActive);
    try { if (nextActive != null) localStorage.setItem("cf_active_workspace", String(nextActive)); } catch { /* ignore */ }
    const visible = clientsVisibleIn(nextClients, nextActive);
    setSelectedClientId((prev) => (prev != null && visible.some((c) => c.id === prev)) ? prev : (visible[0]?.id ?? nextClients[0]?.id ?? null));
  }

  // Keep page and platform consistent with the selected client's enabled channels. The PAGE wins:
  // every platform page lives in exactly one folder, so being on the YouTube Kanban means the
  // platform is YouTube (a deep link or a stored page is never bounced just because the stored
  // platform disagrees). A page whose platform is OFF for this client bounces to the other
  // platform's board, or to Content Scheduling when neither applies. Cross-platform pages
  // (WORK / MANAGE / Editing) keep whatever platform is on for the client.
  useEffect(() => {
    const c = clients.find((cl) => cl.id === selectedClientId);
    const igOn = c ? (c as { instagramEnabled?: boolean }).instagramEnabled !== false : true;
    const ytOn = !!c?.youtubeEnabled;

    let nextPage: Page = page;
    if (YT_ONLY_PAGES.includes(page) && !ytOn) nextPage = igOn ? "kanban" : "pipeline";
    else if (IG_ONLY_PAGES.includes(page) && !igOn) nextPage = ytOn ? "ytkanban" : "pipeline";

    const nextPlatform: Platform =
      YT_ONLY_PAGES.includes(nextPage) ? "youtube"
      : IG_ONLY_PAGES.includes(nextPage) ? "instagram"
      : (platform === "youtube" && ytOn) ? "youtube"
      : (platform === "instagram" && igOn) ? "instagram"
      : (ytOn && !igOn) ? "youtube"
      : "instagram";

    if (nextPage !== page) setPage(nextPage);
    if (nextPlatform !== platform) setPlatform(nextPlatform);
  }, [selectedClientId, clients, page, platform]);

  const fetchNotifications = useCallback(async () => {
    const data = await fetch("/api/notifications").then((r) => r.json());
    setNotifications(data);
  }, []);

  // Per-nav-item badges (e.g. unread messages, reels sent back to you).
  const [badges, setBadges] = useState<{ chat?: number; kanban?: number }>({});
  const refreshBadges = useCallback(async (clientId: number | null) => {
    if (!clientId) { setBadges({}); return; }
    try {
      // Unread chat: channels with a newer message than what's been read locally.
      const summary = await fetch(`/api/messages?clientId=${clientId}&summary=1`).then((r) => r.json()).catch(() => []);
      let read: Record<string, string> = {};
      try { read = JSON.parse(localStorage.getItem(`cf_chat_read_${clientId}`) || "{}"); } catch { /* ignore */ }
      let chat = 0;
      for (const s of (Array.isArray(summary) ? summary : [])) {
        if (!s?.lastAt) continue;
        const r = read[s.channel];
        if (!r || new Date(s.lastAt).getTime() > new Date(r).getTime()) chat++;
      }
      // Reels sent back to a team member (rejectionFeedback set) that they haven't
      // opened yet — ticks down as they open each one.
      let kanban = 0;
      const isMember = session?.type === "member" && !activeProfile?.isClientAccount;
      if (isMember) {
        const drafts = await fetch(`/api/script-drafts?clientId=${clientId}&staged=true`).then((r) => r.json()).catch(() => []);
        kanban = countUnseenSentBack(clientId, Array.isArray(drafts) ? drafts : []);
      }
      setBadges({ chat: chat || undefined, kanban: kanban || undefined });
    } catch { /* non-fatal */ }
  }, [session, activeProfile]);

  const fetchTeam = useCallback(async (clientId?: number | null) => {
    const url = clientId ? `/api/team?clientId=${clientId}` : "/api/team";
    const data = await fetch(url).then((r) => r.json());
    setTeam(data);
  }, []);

  // Handle Unipile OAuth callback redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("unipile") === "connected") {
      const clientId = params.get("clientId");
      if (clientId) setSelectedClientId(parseInt(clientId));
      setPage("dms");
      window.history.replaceState({}, "", "/");
    } else if (params.get("unipile") === "failed") {
      alert("Instagram connect failed. Please try again.");
      window.history.replaceState({}, "", "/");
    }
  }, []);

  useEffect(() => {
    async function init() {
      // Wake up Neon DB (free tier pauses after inactivity) — retry up to 5x
      for (let i = 0; i < 5; i++) {
        try {
          const ping = await fetch("/api/clients");
          if (ping.ok) break;
        } catch {}
        await new Promise((r) => setTimeout(r, 2000));
      }

      // Fetch session first to know if we're a member login
      const sessData = await fetch("/api/auth/me").then((r) => r.json());
      const sess: SessionPayload | null = sessData;
      setSession(sess);
      // Dark mode is owner-only: re-assert the theme from the verified session so a
      // member/client session renders light whatever cf_theme holds in this browser.
      applyTheme(sess?.type === "owner" ? readStoredTheme() : "light");
      if (sessData?.ownerName) setOwnerName(sessData.ownerName);
      if (sessData?.ownerEmail !== undefined) setOwnerEmail(sessData.ownerEmail);

      setProjects(Array.isArray(sessData?.projects) ? sessData.projects : []);

      if (sess?.type === "member" && sess.memberId !== null) {
        setActiveProfileId(sess.memberId);
        // Fetch this member directly (unfiltered) so page access check is always correct
        const memberData: TeamMember = await fetch(`/api/team/${sess.memberId}`).then((r) => r.json());
        setActiveProfile(memberData);
      }

      const clientList: Client[] = await fetch("/api/clients").then((r) => r.json());
      const saved = localStorage.getItem("cf_active_client");
      // Members default to the project they logged into; honour a saved choice only if
      // it's one of their projects.
      const savedId = saved ? parseInt(saved) : null;
      const memberDefault = sess?.type === "member" ? (sess as any).clientId ?? null : null;
      const initClientId = (savedId && clientList.find((c) => c.id === savedId)) ? savedId
        : (memberDefault && clientList.find((c) => c.id === memberDefault)) ? memberDefault
        : clientList[0]?.id ?? null;
      await Promise.all([fetchClients(), fetchNotifications(), fetchTeam(initClientId), fetchWorkspaces()]);
      setAppReady(true);
    }
    init().catch((e) => { console.error("Init failed", e); setAppReady(true); });
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [fetchClients, fetchNotifications, fetchTeam]);

  // Recompute sidebar badges on client/page change and on a short poll.
  useEffect(() => {
    refreshBadges(selectedClientId);
    const t = setInterval(() => refreshBadges(selectedClientId), 20000);
    return () => clearInterval(t);
  }, [selectedClientId, page, refreshBadges]);

  // When a multi-project member switches project, swap the active profile to that
  // project's member record so its per-project page access applies.
  useEffect(() => {
    if (session?.type !== "member" || !selectedClientId || projects.length < 2) return;
    const proj = projects.find((p) => p.clientId === selectedClientId);
    if (!proj || proj.memberId === activeProfileId) return;
    setActiveProfileId(proj.memberId);
    fetch(`/api/team/${proj.memberId}`).then((r) => r.json()).then(setActiveProfile).catch(() => {});
  }, [selectedClientId, projects, session, activeProfileId]);

  // Persist selected client and refresh team when client switches
  useEffect(() => {
    if (selectedClientId !== null) {
      localStorage.setItem("cf_active_client", String(selectedClientId));
      fetchTeam(selectedClientId);
    }
  }, [selectedClientId, fetchTeam]);

  // Persist the active page on EVERY change, so restarting the app reopens where you left off.
  useEffect(() => {
    try { localStorage.setItem("cf_active_page", page); } catch { /* */ }
  }, [page]);

  // Persist the active platform too, so a refresh reopens on the same platform's folder.
  useEffect(() => {
    try { localStorage.setItem("cf_active_platform", platform); } catch { /* */ }
  }, [platform]);

  // Mirror the active screen into the URL (?page=&clientId=) so a refresh or a deep link lands
  // on the same screen, and — when embedded — tell the Cenks Dashboard so it can keep its own
  // URL in sync. Only the root path is touched; OAuth callbacks etc. keep their own URLs.
  useEffect(() => {
    if (window.location.pathname !== "/") return;
    const search = buildDeepLinkSearch({ page, clientId: selectedClientId, embedded });
    if (window.location.search !== search) window.history.replaceState(window.history.state, "", `/${search}`);
    if (embedded && window.parent !== window) {
      const msg: OrdoNavigateMessage = { type: "ordo:navigate", page, clientId: selectedClientId, path: `/${search}` };
      window.parent.postMessage(msg, "*");
    }
  }, [page, selectedClientId, embedded]);

  // Embedded: the dashboard can switch screens without reloading the iframe.
  useEffect(() => {
    if (!embedded) return;
    function onMessage(e: MessageEvent) {
      if (e.source !== window.parent) return;
      const d = e.data as ParentNavigateMessage | null;
      if (!d || d.type !== "ordo:navigate") return;
      if (typeof d.clientId === "number") setSelectedClientId(d.clientId);
      if (typeof d.draft === "number") setKanbanHighlightId(d.draft);
      if (typeof d.page === "string" && isPage(d.page)) setPage(d.page);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [embedded]);

  // Brief loading flash when switching client or page
  useEffect(() => {
    if (!appReady) return;
    setTransitioning(true);
    if (transitionTimer.current) clearTimeout(transitionTimer.current);
    transitionTimer.current = setTimeout(() => setTransitioning(false), 500);
  }, [selectedClientId, page]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the team list current when opening Messages/Kanban so chat channels
  // always match the latest members (e.g. after a member is added/re-added).
  useEffect(() => {
    if (appReady && selectedClientId !== null && (page === "chat" || page === "kanban")) {
      fetchTeam(selectedClientId);
    }
  }, [page, selectedClientId, appReady, fetchTeam]);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  // Compute which pages the active profile can see (owner controls per-member access)
  const allowedPages: Page[] = (() => {
    const all: Page[] = ["pipeline","kanban","tasks","concepts","analytics","dms","iginbox","instagram","board","team","chat","settings","context","transcribe","capcut","clientsettings","ytkanban","ytclipping"];
    if (!activeProfile) return all;
    const base = activeProfile.pageAccess === "all"
      ? all
      : activeProfile.pageAccess.split(",").filter(isPage); // drops ids that no longer exist
    // Always give member logins access to chat.
    if (session?.type === "member" && !base.includes("chat")) base.push("chat");
    // Clients always get their Script Tasks; team members only if the owner granted it.
    if (activeProfile?.isClientAccount && !base.includes("tasks")) base.push("tasks");
    // Instagram Inbox used to live inside DM Pipeline: anyone with "dms" keeps the inbox they
    // could already use (no stored pageAccess contains "iginbox" yet).
    if (base.includes("dms") && !base.includes("iginbox")) base.push("iginbox");
    // CapCut (the video editor) is new: anyone who can see the Script Kanban, where its Edit
    // stage lives, gets it (no stored pageAccess contains "capcut" yet).
    if (base.includes("kanban") && !base.includes("capcut")) base.push("capcut");
    // YouTube is new (no stored pageAccess contains its ids yet): the YouTube Kanban is the same
    // board as the Script Kanban for another platform, so anyone with "kanban" gets it; Clipping
    // feeds the video editor, so anyone with "capcut" gets it. The sidebar still hides both
    // unless the client has YouTube switched on.
    if (base.includes("kanban") && !base.includes("ytkanban")) base.push("ytkanban");
    if (base.includes("capcut") && !base.includes("ytclipping")) base.push("ytclipping");
    // Client settings is owner-only — never expose it to a member login.
    return base.filter((p) => p !== "clientsettings" || session?.type === "owner");
  })();

  // Pages this member may VIEW but not edit (view-only). Empty for the owner.
  const viewOnlyPages: Page[] = (() => {
    const list = activeProfile?.viewOnlyPages ? (activeProfile.viewOnlyPages.split(",").filter(Boolean) as Page[]) : [];
    // Mirror the grandfathering above: view-only on DM Pipeline means view-only on the inbox too.
    if (list.includes("dms") && !list.includes("iginbox")) list.push("iginbox");
    if (list.includes("kanban") && !list.includes("capcut")) list.push("capcut");
    if (list.includes("kanban") && !list.includes("ytkanban")) list.push("ytkanban");
    if (list.includes("capcut") && !list.includes("ytclipping")) list.push("ytclipping");
    return list;
  })();
  const pageReadOnly = viewOnlyPages.includes(page);

  // Arc-style collapsible sidebar (persisted). When collapsed, content goes full-width
  // and the sidebar peeks out as an overlay when you hover the left edge.
  // Title-bar colour (<meta name="theme-color">) follows the data-theme attribute, including
  // an unsaved preview from Settings.
  useEffect(() => startThemeColorSync(), []);

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  useEffect(() => { try { setSidebarCollapsed(localStorage.getItem("cf_sidebar_collapsed") === "1"); } catch { /* ignore */ } }, []);
  const toggleSidebar = () => setSidebarCollapsed((v) => {
    const n = !v;
    try { localStorage.setItem("cf_sidebar_collapsed", n ? "1" : "0"); } catch { /* ignore */ }
    return n;
  });

  const unreadCount = notifications.filter((n) => !n.read).length;

  // When installed as an app (PWA), show the unread count as a badge on the dock/home icon.
  useEffect(() => {
    const nav = navigator as unknown as { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (!nav.setAppBadge) return;
    const total = unreadCount + (badges.chat || 0);
    if (total > 0) nav.setAppBadge(total).catch(() => {});
    else nav.clearAppBadge?.().catch(() => {});
  }, [unreadCount, badges.chat]);

  // Platforms the selected client has switched on (Instagram defaults on, YouTube defaults off).
  // Cross-platform pages like Content Scheduling merge these; single-platform pages use `platform`.
  const enabledPlatforms: Platform[] = (() => {
    const c = clients.find((cl) => cl.id === selectedClientId) as { instagramEnabled?: boolean; youtubeEnabled?: boolean } | undefined;
    const list: Platform[] = [];
    if (!c || c.instagramEnabled !== false) list.push("instagram");
    if (c?.youtubeEnabled) list.push("youtube");
    return list;
  })();

  // `inPane`: rendered inside a split-view pane (the pane is the positioning context). Distinct
  // from `embedded` (the whole app inside the Cenks Dashboard iframe, which has no sidebar).
  function renderPage(which: Page = page, inPane = false) {
    // Redirect to first allowed page if current page isn't allowed
    if (!allowedPages.includes(which)) {
      if (which === page) {
        const first = allowedPages[0];
        if (first) setTimeout(() => setPage(first), 0);
      }
      return <div className="flex items-center justify-center h-full text-ink-400 text-sm">This page isn&apos;t available here.</div>;
    }
    const props = { clients, selectedClientId, refreshClients: fetchClients };
    switch (which) {
      case "pipeline": return <Pipeline {...props} enabledPlatforms={enabledPlatforms} refreshNotifications={fetchNotifications} isClient={session?.type === "member"} readOnly={pageReadOnly} onOpenInKanban={(session?.type === "member" && activeProfile?.isClientAccount) ? (id) => { setKanbanHighlightId(id); setPage("kanban"); } : undefined} />;
      case "concepts": return <Concepts {...props} platform={platform} onAttachReels={(c) => { setAttachConcept(c); setPage("instagram"); }} />;
      case "analytics": return <Analytics {...props} />;
      case "team": return <TeamPage clients={clients} selectedClientId={selectedClientId} />;
      case "chat": return <ChatPage clients={clients} selectedClientId={selectedClientId} isOwnerSession={session?.type === "owner"} ownerName={ownerName} clientName={session?.type === "member" ? session.name : undefined} reelContext={chatContext} onContextUsed={() => setChatContext(null)} team={team} initialChannel={chatContext?.channel} activeProfile={activeProfile} />;
      case "settings": return <SettingsPage clients={clients} refreshClients={fetchClients} onNavigateToPipeline={(id) => { setSelectedClientId(id); setPage("pipeline"); }} defaultWorkspaceId={activeWorkspaceId} isOwner={session?.type === "owner"} />;
      case "kanban": return <Kanban clients={clients} platform={platform} selectedClientId={selectedClientId} onSelectClient={setSelectedClientId} activeProfileId={activeProfileId} activeProfile={activeProfile} team={team} ownerName={ownerName} isClient={session?.type === "member"} onOpenChat={(context) => { setChatContext(context); setPage("chat"); }} onBadgesChanged={() => refreshBadges(selectedClientId)} highlightDraftId={kanbanHighlightId} onHighlightConsumed={() => setKanbanHighlightId(null)} />;
      case "tasks": return <ScriptTasksPage clients={clients} selectedClientId={selectedClientId} canSubmit={session?.type === "member"} />;
      case "dms":      return <DmsPage clients={clients} selectedClientId={selectedClientId} onGoToSettings={() => setPage("settings")} view="pipeline" />;
      case "iginbox":  return <DmsPage clients={clients} selectedClientId={selectedClientId} onGoToSettings={() => setPage("settings")} view="inbox" />;
      case "instagram": return <InstagramPage clients={clients} selectedClientId={selectedClientId} attachConcept={attachConcept} onExitAttach={() => setAttachConcept(null)} embedded={inPane} />;
      // No sidebar to offset from when the app is embedded in the dashboard: the board must start at x=0.
      case "board": return <BoardPage clients={clients} selectedClientId={selectedClientId} sidebarCollapsed={sidebarCollapsed || embedded} embedded={inPane} />;
      case "context": return <ContextPage clients={clients} selectedClientId={selectedClientId} />;
      case "transcribe": return <TranscribePage />;
      case "capcut": return <CapCutPage clients={clients} selectedClientId={selectedClientId} />;
      // YouTube pages are wired in later stages; the ids, access and folder are live already.
      case "ytkanban": return <YouTubeStub title="YouTube Kanban" blurb="The stage-based board for this client's YouTube scripts is being wired up." />;
      case "ytclipping": return <YouTubeStub title="Clipping" blurb="Cut short clips out of a long-form YouTube video and hand them to the editor. Being wired up." />;
      case "clientsettings": return <ClientSettingsPage client={clients.find((c) => c.id === selectedClientId) ?? null} refreshClients={fetchClients} onManageAll={() => setPage("settings")} />;
    }
  }

  // ── Split view helpers ──────────────────────────────────────────────────────
  const splitRef = useRef<HTMLDivElement | null>(null);
  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    const el = splitRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    function onMove(ev: MouseEvent) {
      const r = Math.min(0.8, Math.max(0.2, (ev.clientX - rect.left) / rect.width));
      setSplitRatio(r);
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
    }
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }
  // One page inside a split pane. The Strategy Board fills the pane itself; other pages get a
  // scroll container with padding.
  function paneEl(p: Page) {
    if (p === "board") return renderPage(p, true);
    // The Instagram Inbox is a chat UI: it fills the pane and scrolls internally, never as a page.
    if (p === "iginbox") return <div className="absolute inset-0 overflow-hidden flex flex-col">{renderPage(p, true)}</div>;
    return <div className="absolute inset-0 overflow-y-auto p-6">{renderPage(p, true)}</div>;
  }

  if (!appReady) return (
    <div className="flex h-screen w-screen items-center justify-center bg-canvas-2">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-4 border-accent-600 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-ink-400 font-medium">Loading...</span>
      </div>
    </div>
  );

  const sidebarWidth = embedded || sidebarCollapsed ? 0 : 280;

  return (
    <div className="flex h-full min-h-screen bg-canvas-2">
      {!embedded && <Sidebar
        currentPage={page}
        onNavigate={(p) => setPage(p as Page)}
        splitPage={session?.type === "owner" ? splitPage : null}
        onOpenSplit={session?.type === "owner" ? ((p) => setSplitPage((cur) => cur === p ? null : (p as Page))) : undefined}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        onSelectWorkspace={selectWorkspace}
        onCreateWorkspace={createWorkspace}
        onDeleteWorkspace={deleteWorkspace}
        instagramEnabled={(clients.find((c) => c.id === selectedClientId) as { instagramEnabled?: boolean } | undefined)?.instagramEnabled !== false}
        youtubeEnabled={!!clients.find((c) => c.id === selectedClientId)?.youtubeEnabled}
        platform={platform}
        onSelectPlatform={setPlatform}
        onMoveClient={async (clientId, workspaceId) => {
          await fetch(`/api/clients/${clientId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId }) }).catch(() => {});
          fetchClients();
        }}
        clients={clients}
        selectedClientId={selectedClientId}
        onSelectClient={setSelectedClientId}
        unreadCount={unreadCount}
        notifications={notifications}
        badges={badges}
        allowedPages={allowedPages}
        activeProfile={activeProfile}
        session={session}
        onSignOut={signOut}
        ownerEmail={ownerEmail}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={toggleSidebar}
        onMarkRead={async (id) => {
          await fetch("/api/notifications", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id }),
          });
          fetchNotifications();
        }}
        onMarkAllRead={async () => {
          await fetch("/api/notifications", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ markAllRead: true }),
          });
          fetchNotifications();
        }}
      />}
      {splitPage && session?.type === "owner" ? (
        <div ref={splitRef} className="fixed top-0 bottom-0 right-0 flex h-screen transition-[left] duration-200" style={{ left: sidebarWidth }}>
          <div className="relative h-screen overflow-hidden bg-canvas-2" style={{ width: `${splitRatio * 100}%` }}>
            {paneEl(page)}
          </div>
          <div onMouseDown={startResize} title="Drag to resize"
            className="w-1.5 h-screen flex-shrink-0 bg-surface-4 hover:bg-accent-400 cursor-col-resize transition-colors" />
          <div className="flex flex-col flex-1 h-screen overflow-hidden bg-canvas-2">
            <div className="flex items-center justify-between px-3 h-8 flex-shrink-0 border-b border-line bg-surface">
              <span className="text-[11px] font-semibold text-faint">◨ {PAGE_LABELS[splitPage]}</span>
              <button onClick={() => setSplitPage(null)} title="Close split view"
                className="w-6 h-6 rounded-full text-faint hover:text-ink hover:bg-shade/[0.06] flex items-center justify-center">✕</button>
            </div>
            <div className="relative flex-1 overflow-hidden">
              {paneEl(splitPage)}
            </div>
          </div>
        </div>
      ) : page === "board"
        ? <>{transitioning ? null : renderPage()}</>
        : <main className={`flex-1 ${page === "iginbox" ? "p-0 overflow-hidden" : `${embedded ? "p-6" : "p-8"} overflow-y-auto`} min-w-0 flex flex-col h-screen transition-[margin] duration-200`} style={{ marginLeft: sidebarWidth }}>
            {transitioning
              ? <div className="flex items-center justify-center" style={{height: "calc(100vh - 4rem)"}}><div className="w-7 h-7 border-4 border-accent-600 border-t-transparent rounded-full animate-spin" /></div>
              : renderPage()
            }
          </main>
      }
    </div>
  );
}

// Placeholder for a YouTube page whose implementation lands in a later stage.
function YouTubeStub({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="flex items-center justify-center h-[60vh]">
      <div className="o-card p-6 max-w-sm text-center">
        <p className="text-2xl mb-2">▶️</p>
        <h1 className="text-base font-semibold text-ink">{title}</h1>
        <p className="text-sm text-muted mt-1">{blurb}</p>
      </div>
    </div>
  );
}
