"use client";

import { useEffect, useState, useCallback } from "react";
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
import { Client, Notification, TeamMember } from "@/lib/types";

export type Page =
  | "pipeline"
  | "kanban"
  | "concepts"
  | "analytics"
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
  const [activeProfileId, setActiveProfileId] = useState<number | null>(null); // null = owner/all-access

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
    fetchClients();
    fetchNotifications();
    fetchTeam();
    const saved = localStorage.getItem("cf_active_profile");
    if (saved) setActiveProfileId(parseInt(saved));
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [fetchClients, fetchNotifications, fetchTeam]);

  // Persist selected client
  useEffect(() => {
    if (selectedClientId !== null) {
      localStorage.setItem("cf_active_client", String(selectedClientId));
    }
  }, [selectedClientId]);

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
    if (!activeProfile) return ["pipeline","kanban","concepts","analytics","instagram","board","team","chat","settings"];
    if (activeProfile.pageAccess === "all") return ["pipeline","kanban","concepts","analytics","instagram","board","team","chat","settings"];
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
      case "kanban": return <Kanban clients={clients} selectedClientId={selectedClientId} onSelectClient={setSelectedClientId} />;
      case "instagram": return <InstagramPage clients={clients} selectedClientId={selectedClientId} />;
      case "board": return <BoardPage clients={clients} selectedClientId={selectedClientId} />;
    }
  }

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
        ? <>{renderPage()}</>
        : <main className="flex-1 ml-64 p-8 min-w-0">{renderPage()}</main>
      }
    </div>
  );
}
