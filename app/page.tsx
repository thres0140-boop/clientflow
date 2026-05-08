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
import { Client, Notification, TeamMember } from "@/lib/types";

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
  | "settings";

export default function App() {
  const [page, setPage] = useState<Page>("pipeline");
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<number | null>(null);
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

  const fetchTeam = useCallback(async () => {
    const data = await fetch("/api/team").then((r) => r.json());
    setTeam(data);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("cf_active_profile");
    if (saved) setActiveProfileId(parseInt(saved));
    Promise.all([fetchClients(), fetchNotifications(), fetchTeam()]).finally(() => setAppReady(true));
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [fetchClients, fetchNotifications, fetchTeam]);

  // Persist selected client
  useEffect(() => {
    if (selectedClientId !== null) {
      localStorage.setItem("cf_active_client", String(selectedClientId));
    }
  }, [selectedClientId]);

  // Brief loading flash when switching client or page
  useEffect(() => {
    if (!appReady) return;
    setTransitioning(true);
    if (transitionTimer.current) clearTimeout(transitionTimer.current);
    transitionTimer.current = setTimeout(() => setTransitioning(false), 500);
  }, [selectedClientId, page]); // eslint-disable-line react-hooks/exhaustive-deps

  function switchProfile(id: number | null) {
    setActiveProfileId(id);
    if (id === null) {
      localStorage.removeItem("cf_active_profile");
    } else {
      localStorage.setItem("cf_active_profile", String(id));
    }
    setPage("pipeline" as Page);
  }

  // Compute which pages the active profile can see
  const activeProfile = team.find((m) => m.id === activeProfileId) ?? null;
  const allowedPages: Page[] = (() => {
    if (!activeProfile) return ["pipeline","kanban","concepts","analytics","dms","instagram","board","team","chat","settings"];
    if (activeProfile.pageAccess === "all") return ["pipeline","kanban","concepts","analytics","dms","instagram","board","team","chat","settings"];
    return activeProfile.pageAccess.split(",").filter(Boolean) as Page[];
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
      case "pipeline": return <Pipeline {...props} refreshNotifications={fetchNotifications} />;
      case "concepts": return <Concepts {...props} />;
      case "analytics": return <Analytics {...props} />;
      case "team": return <TeamPage clients={clients} selectedClientId={selectedClientId} />;
      case "chat": return <ChatPage clients={clients} selectedClientId={selectedClientId} />;
      case "settings": return <SettingsPage clients={clients} refreshClients={fetchClients} onNavigateToPipeline={(id) => { setSelectedClientId(id); setPage("pipeline"); }} />;
      case "kanban": return <Kanban clients={clients} selectedClientId={selectedClientId} onSelectClient={setSelectedClientId} activeProfileId={activeProfileId} team={team} />;
      case "dms":      return <DmsPage clients={clients} selectedClientId={selectedClientId} />;
      case "instagram": return <InstagramPage clients={clients} selectedClientId={selectedClientId} />;
      case "board": return <BoardPage clients={clients} selectedClientId={selectedClientId} />;
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
        team={team}
        onSwitchProfile={switchProfile}
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
        : <main className="flex-1 ml-64 p-8 min-w-0">
            {transitioning
              ? <div className="flex items-center justify-center" style={{height: "calc(100vh - 4rem)"}}><div className="w-7 h-7 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" /></div>
              : renderPage()
            }
          </main>
      }
    </div>
  );
}
