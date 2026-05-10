"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Sidebar from "@/components/Sidebar";
import Pipeline from "@/components/pages/Pipeline";
import Concepts from "@/components/pages/Concepts";
import Analytics from "@/components/pages/Analytics";
import TeamPage from "@/components/pages/TeamPage";
import ChatPage from "@/components/pages/ChatPage";
import SettingsPage from "@/components/pages/SettingsPage";
import Kanban from "@/components/pages/Kanban";
import InstagramPage from "@/components/pages/InstagramPage";
import BoardPage from "@/components/pages/BoardPage";
import DmsPage from "@/components/pages/DmsPage";
import ContextPage from "@/components/pages/ContextPage";
import { Client, Notification, TeamMember } from "@/lib/types";
import type { SessionPayload } from "@/lib/session";

export type Page =
  | "pipeline"
  | "kanban"
  | "concepts"
  | "analytics"
  | "dms"
  | "instagram"
  | "board"
  | "team"
  | "chat"
  | "settings"
  | "context";

export default function App() {
  const [page, setPage] = useState<Page>("pipeline");
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [chatContext, setChatContext] = useState<{ id?: number; title: string; hook?: string | null; script: string; caption?: string | null } | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<number | null>(null);
  const [activeProfile, setActiveProfile] = useState<TeamMember | null>(null);
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [ownerName, setOwnerName] = useState("Cenk");
  const [appReady, setAppReady] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchClients = useCallback(async () => {
    const data: Client[] = await fetch("/api/clients").then((r) => r.json());
    setClients(data);
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
  }, []);

  const fetchNotifications = useCallback(async () => {
    const data = await fetch("/api/notifications").then((r) => r.json());
    setNotifications(data);
  }, []);

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
      // Fetch session first to know if we're a member login
      const sessData = await fetch("/api/auth/me").then((r) => r.json());
      const sess: SessionPayload | null = sessData;
      setSession(sess);
      if (sessData?.ownerName) setOwnerName(sessData.ownerName);

      if (sess?.type === "member" && sess.memberId !== null) {
        setActiveProfileId(sess.memberId);
        // Fetch this member directly (unfiltered) so page access check is always correct
        const memberData: TeamMember = await fetch(`/api/team/${sess.memberId}`).then((r) => r.json());
        setActiveProfile(memberData);
      }

      const clientList: Client[] = await fetch("/api/clients").then((r) => r.json());
      const saved = localStorage.getItem("cf_active_client");
      const initClientId = saved ? parseInt(saved) : clientList[0]?.id ?? null;
      await Promise.all([fetchClients(), fetchNotifications(), fetchTeam(initClientId)]);
      setAppReady(true);
    }
    init();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [fetchClients, fetchNotifications, fetchTeam]);

  // Persist selected client and refresh team when client switches
  useEffect(() => {
    if (selectedClientId !== null) {
      localStorage.setItem("cf_active_client", String(selectedClientId));
      fetchTeam(selectedClientId);
    }
  }, [selectedClientId, fetchTeam]);

  // Brief loading flash when switching client or page
  useEffect(() => {
    if (!appReady) return;
    setTransitioning(true);
    if (transitionTimer.current) clearTimeout(transitionTimer.current);
    transitionTimer.current = setTimeout(() => setTransitioning(false), 500);
  }, [selectedClientId, page]); // eslint-disable-line react-hooks/exhaustive-deps

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  // Compute which pages the active profile can see
  const allowedPages: Page[] = (() => {
    if (!activeProfile) return ["pipeline","kanban","concepts","analytics","dms","instagram","board","team","chat","settings","context"];
    if (activeProfile.pageAccess === "all") return ["pipeline","kanban","concepts","analytics","dms","instagram","board","team","chat","settings","context"];
    const pages = activeProfile.pageAccess.split(",").filter(Boolean) as Page[];
    // Always give client logins access to chat
    if (session?.type === "member" && !pages.includes("chat")) pages.push("chat");
    return pages;
  })();

  const unreadCount = notifications.filter((n) => !n.read).length;

  function renderPage() {
    // Redirect to first allowed page if current page isn't allowed
    if (!allowedPages.includes(page)) {
      const first = allowedPages[0];
      if (first) setTimeout(() => setPage(first), 0);
      return null;
    }
    const props = { clients, selectedClientId, refreshClients: fetchClients };
    switch (page) {
      case "pipeline": return <Pipeline {...props} refreshNotifications={fetchNotifications} isClient={session?.type === "member"} />;
      case "concepts": return <Concepts {...props} />;
      case "analytics": return <Analytics {...props} />;
      case "team": return <TeamPage clients={clients} selectedClientId={selectedClientId} />;
      case "chat": return <ChatPage clients={clients} selectedClientId={selectedClientId} isOwnerSession={session?.type === "owner"} ownerName={ownerName} clientName={session?.type === "member" ? session.name : undefined} reelContext={chatContext} onContextUsed={() => setChatContext(null)} />;
      case "settings": return <SettingsPage clients={clients} refreshClients={fetchClients} onNavigateToPipeline={(id) => { setSelectedClientId(id); setPage("pipeline"); }} />;
      case "kanban": return <Kanban clients={clients} selectedClientId={selectedClientId} onSelectClient={setSelectedClientId} activeProfileId={activeProfileId} team={team} ownerName={ownerName} isClient={session?.type === "member"} onOpenChat={(context) => { setChatContext(context); setPage("chat"); }} />;
      case "dms":      return <DmsPage clients={clients} selectedClientId={selectedClientId} />;
      case "instagram": return <InstagramPage clients={clients} selectedClientId={selectedClientId} />;
      case "board": return <BoardPage clients={clients} selectedClientId={selectedClientId} />;
      case "context": return <ContextPage clients={clients} selectedClientId={selectedClientId} />;
    }
  }

  if (!appReady) return (
    <div className="flex h-screen w-screen items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-slate-400 font-medium">Loading...</span>
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-screen bg-slate-50">
      <Sidebar
        currentPage={page}
        onNavigate={(p) => setPage(p as Page)}
        clients={clients}
        selectedClientId={selectedClientId}
        onSelectClient={setSelectedClientId}
        unreadCount={unreadCount}
        notifications={notifications}
        allowedPages={allowedPages}
        activeProfile={activeProfile}
        session={session}
        onSignOut={signOut}
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
      />
      {page === "board"
        ? <>{transitioning ? null : renderPage()}</>
        : <main className="flex-1 ml-64 p-8 min-w-0 flex flex-col min-h-0 h-screen overflow-hidden">
            {transitioning
              ? <div className="flex items-center justify-center" style={{height: "calc(100vh - 4rem)"}}><div className="w-7 h-7 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" /></div>
              : renderPage()
            }
          </main>
      }
    </div>
  );
}
