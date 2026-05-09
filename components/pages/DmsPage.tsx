"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, useSensor, useSensors, useDroppable, useDraggable,
} from "@dnd-kit/core";
import { Client, DmLead, DM_STATUSES } from "@/lib/types";

type Props = { clients: Client[]; selectedClientId: number | null };
type Period = "week" | "2weeks" | "month" | "all";
type View = "pipeline" | "inbox";

// ── Date helpers ──────────────────────────────────────────────────────────────
function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function getMonday(date: Date): Date {
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d;
}
function addDays(date: Date, n: number): Date {
  const d = new Date(date); d.setDate(d.getDate() + n); return d;
}
function periodDays(p: Period): number {
  return p === "week" ? 7 : p === "2weeks" ? 14 : p === "month" ? 28 : Infinity;
}
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function rangeLabel(start: Date, count: number): string {
  if (!isFinite(count)) return "All time";
  const end = addDays(start, count - 1);
  const sm = MONTHS[start.getMonth()], em = MONTHS[end.getMonth()];
  return start.getMonth() === end.getMonth()
    ? `${sm} ${start.getDate()}–${end.getDate()}, ${end.getFullYear()}`
    : `${sm} ${start.getDate()} – ${em} ${end.getDate()}, ${end.getFullYear()}`;
}
function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const dy = Math.floor(h / 24);
  if (dy < 7) return `${dy}d`;
  return new Date(dateStr).toLocaleDateString("en", { month: "short", day: "numeric" });
}

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS_MAP = Object.fromEntries(DM_STATUSES.map((s) => [s.value, s]));
function statusMeta(status: string) { return STATUS_MAP[status] ?? STATUS_MAP["messaged"]; }
const PIPELINE_COLS = DM_STATUSES.map((s) => s.value);
const NEXT: Record<string, string> = { follows: "messaged", messaged: "messaged_np", messaged_np: "booked", booked: "closed" };

// ── Inbox types ───────────────────────────────────────────────────────────────
type Conversation = {
  id: string; name: string; handle: string | null; igId: string | null;
  updatedTime: string; snippet: string | null; unreadCount: number | null;
};
type Message = {
  id: string; text: string; fromId: string; fromName: string;
  isOwn: boolean; createdTime: string;
};

// ── Main component ────────────────────────────────────────────────────────────
export default function DmsPage({ clients, selectedClientId }: Props) {
  const [view, setView] = useState<View>("pipeline");

  // Pipeline state
  const [leads, setLeads]           = useState<DmLead[]>([]);
  const [showAdd, setShowAdd]       = useState(false);
  const [editLead, setEditLead]     = useState<DmLead | null>(null);
  const [period, setPeriod]         = useState<Period>("week");
  const [startDate, setStartDate]   = useState<Date>(() => getMonday(new Date()));
  const [activeDragId, setActiveDragId] = useState<number | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Inbox state
  const [conversations, setConversations]   = useState<Conversation[]>([]);
  const [inboxLoading, setInboxLoading]     = useState(false);
  const [inboxError, setInboxError]         = useState<string | null>(null);
  const [selectedConv, setSelectedConv]     = useState<Conversation | null>(null);
  const [messages, setMessages]             = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [replyText, setReplyText]           = useState("");
  const [sending, setSending]               = useState(false);
  const [search, setSearch]                 = useState("");
  const [connecting, setConnecting]         = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const refreshTimer   = useRef<ReturnType<typeof setInterval> | null>(null);

  const client = clients.find((c) => c.id === selectedClientId) ?? null;

  // Load leads
  useEffect(() => { loadLeads(); }, [selectedClientId]);
  async function loadLeads() {
    if (!selectedClientId) return;
    const data = await fetch(`/api/dm-leads?clientId=${selectedClientId}`).then((r) => r.json());
    setLeads(Array.isArray(data) ? data : []);
  }

  // Load inbox conversations via Unipile
  const loadInbox = useCallback(async () => {
    if (!selectedClientId) return;
    setInboxLoading(true);
    setInboxError(null);
    try {
      const data = await fetch(`/api/unipile/conversations?clientId=${selectedClientId}`).then((r) => r.json());
      if (data.error === "no_unipile_account") { setInboxError("no_unipile_account"); }
      else if (data.error) { setInboxError(data.error); }
      else {
        // Normalise Unipile chat objects to the Conversation shape
        const convs = (data.conversations ?? []).map((c: any) => ({
          id: c.id,
          igId: c.attendees?.[0]?.id ?? c.id,
          name: c.attendees?.[0]?.name ?? c.name ?? "Unknown",
          handle: c.attendees?.[0]?.username ?? c.attendees?.[0]?.handle ?? "",
          snippet: c.last_message?.text ?? c.snippet ?? "",
          updatedTime: c.last_message?.created_at ?? c.updated_at ?? new Date().toISOString(),
          unreadCount: c.unread_count ?? 0,
        }));
        setConversations(convs);
      }
    } catch (e) { setInboxError(String(e)); }
    setInboxLoading(false);
  }, [selectedClientId]);

  useEffect(() => {
    if (view === "inbox") loadInbox();
  }, [view, selectedClientId, loadInbox]);

  // Load messages for selected conversation
  const loadMessages = useCallback(async (conv: Conversation) => {
    if (!selectedClientId) return;
    setMessagesLoading(true);
    try {
      const data = await fetch(`/api/unipile/conversations/${conv.id}`).then((r) => r.json());
      if (data.error) { console.error("loadMessages error:", data.error); }
      if (!data.error) {
        const msgs = (data.messages ?? []).map((m: any) => ({
          id: m.id,
          text: m.text ?? m.body ?? "",
          fromId: m.sender_id ?? m.from_id ?? "",
          fromName: m.sender_name ?? m.from_name ?? "",
          isOwn: Boolean(m.is_sender),
          createdTime: m.created_at ?? m.timestamp ?? "",
        }));
        // Sort oldest-first so chat reads top-to-bottom naturally
        msgs.sort((a, b) => new Date(a.createdTime).getTime() - new Date(b.createdTime).getTime());
        // Keep optimistic messages that haven't synced yet
        setMessages((prev) => {
          const optimistics = prev.filter((m) => m.id.startsWith("opt-"));
          const merged = [...msgs];
          for (const opt of optimistics) {
            if (!merged.some((m) => m.text === opt.text && m.isOwn)) merged.push(opt);
          }
          return merged;
        });
      }
    } finally {
      setMessagesLoading(false);
    }
  }, [selectedClientId]);

  useEffect(() => {
    if (!selectedConv) return;
    setMessages([]);
    loadMessages(selectedConv);
    refreshTimer.current = setInterval(() => loadMessages(selectedConv), 10000);
    return () => { if (refreshTimer.current) clearInterval(refreshTimer.current); };
  }, [selectedConv, loadMessages]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendReply() {
    if (!replyText.trim() || !selectedConv || !selectedClientId) return;
    setSending(true);
    const text = replyText.trim();
    setReplyText("");
    // Optimistic update
    const optimistic: Message = {
      id: `opt-${Date.now()}`, text, fromId: "me", fromName: "You",
      isOwn: true, createdTime: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    try {
      const res = await fetch("/api/unipile/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: selectedClientId, chatId: selectedConv.id, text }),
      });
      const data = await res.json();
      if (data.error) {
        alert(`Send failed: ${data.error}`);
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        setReplyText(text);
      } else {
        // Refresh after short delay to get the real message
        setTimeout(() => loadMessages(selectedConv), 1500);
      }
    } finally {
      setSending(false);
    }
  }

  async function addToPipeline(conv: Conversation) {
    if (!selectedClientId) return;
    await fetch("/api/dm-leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: selectedClientId,
        name: conv.name,
        handle: conv.handle,
        status: "follows",
        date: toYMD(new Date()),
      }),
    });
    loadLeads();
    alert(`${conv.name} added to pipeline as Follows.`);
  }

  // Pipeline helpers
  function moveStatus(lead: DmLead, status: string) {
    // Optimistic update — move card immediately, save in background
    setLeads((prev) => prev.map((l) => l.id === lead.id ? { ...l, status } : l));
    fetch(`/api/dm-leads/${lead.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
  }
  async function deleteLead(id: number) {
    if (!confirm("Remove this lead?")) return;
    await fetch(`/api/dm-leads/${id}`, { method: "DELETE" });
    loadLeads();
  }

  const days     = periodDays(period);
  const from     = period !== "all" ? toYMD(startDate) : null;
  const to       = period !== "all" ? toYMD(addDays(startDate, days - 1)) : null;
  const filtered = leads.filter((l) => period === "all" || (l.date && from && to && l.date >= from && l.date <= to));

  const total      = filtered.length;
  const pct = (a: number, b: number) => b > 0 ? `${Math.round((a / b) * 100)}%` : "0%";
  const countOf = (statuses: string[]) => filtered.filter((l) => statuses.includes(l.status)).length;
  const leadsBy = (s: string) => filtered.filter((l) => l.status === s);

  const filteredConvs = conversations.filter((c) =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.handle && c.handle.toLowerCase().includes(search.toLowerCase()))
  );

  if (!selectedClientId) {
    return <div className="flex items-center justify-center h-64 text-slate-400 text-sm">Select a client</div>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">DM Pipeline</h1>
          <p className="text-slate-500 mt-0.5 text-sm">{client?.name}</p>
        </div>
        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="flex gap-0.5 bg-slate-100 rounded-xl p-1">
            <button onClick={() => setView("pipeline")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${view === "pipeline" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
              📊 Pipeline
            </button>
            <button onClick={() => setView("inbox")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${view === "inbox" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
              💬 Instagram Inbox
            </button>
          </div>
          {view === "pipeline" && (
            <button onClick={() => { setEditLead(null); setShowAdd(true); }}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
              + Add Lead
            </button>
          )}
        </div>
      </div>

      {/* ── PIPELINE VIEW ──────────────────────────────────────────────── */}
      {view === "pipeline" && (
        <div className="space-y-4">
          {/* Date controls */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-0.5 bg-slate-100 rounded-lg p-0.5">
              {(["week","2weeks","month","all"] as Period[]).map((p) => (
                <button key={p} onClick={() => { setPeriod(p); if (p !== "all") setStartDate(getMonday(new Date())); }}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${period === p ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                  {p === "week" ? "1 Week" : p === "2weeks" ? "2 Weeks" : p === "month" ? "Month" : "All time"}
                </button>
              ))}
            </div>
            {period !== "all" && (
              <>
                <div className="flex items-center bg-white border border-slate-200 rounded-lg overflow-hidden">
                  <button onClick={() => setStartDate((d) => addDays(d, -days))} className="px-3 py-2 hover:bg-slate-50 text-slate-500 border-r border-slate-200">‹</button>
                  <span className="px-4 text-sm font-medium text-slate-700 whitespace-nowrap">{rangeLabel(startDate, days)}</span>
                  <button onClick={() => setStartDate((d) => addDays(d, days))}  className="px-3 py-2 hover:bg-slate-50 text-slate-500 border-l border-slate-200">›</button>
                </div>
                <button onClick={() => setStartDate(getMonday(new Date()))}
                  className="px-3 py-2 text-xs border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50 bg-white">Now</button>
              </>
            )}
            <span className="text-xs text-slate-400">{filtered.length} lead{filtered.length !== 1 ? "s" : ""}</span>
          </div>

          {/* Stats + Kanban — single shared scroll container */}
          <div className="overflow-x-auto">
            <div style={{ minWidth: `${DM_STATUSES.length * 160}px` }} className="flex gap-2 pb-1">
              {DM_STATUSES.map((s) => {
                const count = leadsBy(s.value).length;
                const percentage = pct(count, total);
                return (
                  <div key={s.value} className={`flex-1 rounded-xl border px-3 py-3 ${s.bg} ${s.border}`}>
                    <p className={`text-[11px] font-semibold truncate ${s.text}`}>{s.label}</p>
                    <p className={`text-2xl font-bold mt-0.5 ${s.text}`}>{percentage}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">{count} lead{count !== 1 ? "s" : ""}</p>
                  </div>
                );
              })}
            </div>

          {/* Kanban — drag & drop */}
          <DndContext
            sensors={sensors}
            onDragStart={(e: DragStartEvent) => setActiveDragId(Number(e.active.id))}
            onDragEnd={(e: DragEndEvent) => {
              setActiveDragId(null);
              const lead = leads.find((l) => l.id === Number(e.active.id));
              const toStatus = e.over?.id as string | undefined;
              if (lead && toStatus && toStatus !== lead.status) moveStatus(lead, toStatus);
            }}
            onDragCancel={() => setActiveDragId(null)}
          >
            <div style={{ minWidth: `${DM_STATUSES.length * 160}px` }} className="flex gap-3 mt-4 pb-2">
              {PIPELINE_COLS.map((statusVal) => {
                const meta = statusMeta(statusVal);
                const col  = leadsBy(statusVal);
                return (
                  <KanbanCol key={statusVal} statusVal={statusVal} meta={meta} col={col}
                    activeDragId={activeDragId}
                    onEdit={(lead) => { setEditLead(lead); setShowAdd(true); }}
                    onDelete={(id) => deleteLead(id)}
                  />
                );
              })}
            </div>
            <DragOverlay>
              {activeDragId ? (() => {
                const lead = leads.find((l) => l.id === activeDragId);
                return lead ? <LeadCardInner lead={lead} /> : null;
              })() : null}
            </DragOverlay>
          </DndContext>
          </div>{/* end overflow-x-auto */}
        </div>
      )}

      {/* ── INBOX VIEW ─────────────────────────────────────────────────── */}
      {view === "inbox" && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden" style={{ height: "calc(100vh - 200px)" }}>
          <div className="flex h-full">
            {/* Left: conversation list */}
            <div className="w-80 flex-shrink-0 border-r border-slate-200 flex flex-col">
              {/* Search + refresh */}
              <div className="px-3 py-3 border-b border-slate-100 flex items-center gap-2">
                <input
                  value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search conversations…"
                  className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <button onClick={loadInbox} disabled={inboxLoading}
                  className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors disabled:opacity-40 text-sm">
                  {inboxLoading ? "…" : "↻"}
                </button>
              </div>

              {/* Conversation list */}
              <div className="flex-1 overflow-y-auto">
                {inboxError ? (
                  <div className="p-6 text-center space-y-2">
                    {inboxError === "no_unipile_account" ? (
                      <>
                        <p className="text-3xl mb-1">📱</p>
                        <p className="text-sm font-semibold text-slate-700">Connect Instagram DMs</p>
                        <p className="text-[11px] text-slate-400 leading-relaxed max-w-[200px] mx-auto">
                          Link this client's Instagram so you can read and reply to DMs right here.
                        </p>
                        <button
                          disabled={connecting}
                          onClick={async () => {
                            setConnecting(true);
                            try {
                              const res = await fetch("/api/unipile/auth-link", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ clientId: selectedClientId }),
                              });
                              const text = await res.text();
                              let data: any;
                              try { data = JSON.parse(text); } catch { alert(`Bad response: ${text.slice(0, 200)}`); return; }
                              if (data.url) window.location.href = data.url;
                              else alert(`Connect failed: ${JSON.stringify(data)}`);
                            } catch (e) {
                              alert(`Error: ${e}`);
                            } finally {
                              setConnecting(false);
                            }
                          }}
                          className="mt-3 px-4 py-2 text-xs font-semibold bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
                        >
                          {connecting ? "Opening…" : "🔗 Connect Instagram"}
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="text-xs font-semibold text-red-500">Could not load inbox</p>
                        <p className="text-[11px] text-slate-400 leading-relaxed">{inboxError}</p>
                      </>
                    )}
                    <button onClick={loadInbox} className="mt-2 px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">Retry</button>
                  </div>
                ) : inboxLoading && conversations.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 text-xs">Loading conversations…</div>
                ) : filteredConvs.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 text-xs">
                    {search ? "No matches" : "No conversations yet"}
                  </div>
                ) : (
                  filteredConvs.map((conv) => (
                    <button key={conv.id} onClick={() => setSelectedConv(conv)}
                      className={`w-full flex items-start gap-3 px-4 py-3.5 text-left border-b border-slate-50 hover:bg-slate-50 transition-colors ${selectedConv?.id === conv.id ? "bg-indigo-50 border-l-2 border-l-indigo-500" : ""}`}>
                      {/* Avatar */}
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                        {conv.name?.[0]?.toUpperCase() ?? "?"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <p className="text-sm font-semibold text-slate-800 truncate">{conv.name}</p>
                          <span className="text-[10px] text-slate-400 flex-shrink-0">{timeAgo(conv.updatedTime)}</span>
                        </div>
                        {conv.handle && <p className="text-[11px] text-slate-400">@{conv.handle}</p>}
                        {conv.snippet && <p className="text-xs text-slate-400 mt-0.5 truncate">{conv.snippet}</p>}
                      </div>
                      {conv.unreadCount != null && conv.unreadCount > 0 && (
                        <div className="w-5 h-5 bg-indigo-600 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 mt-1">
                          {conv.unreadCount}
                        </div>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Right: message thread */}
            {!selectedConv ? (
              <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
                <div className="text-center space-y-2">
                  <div className="text-4xl">💬</div>
                  <p className="font-medium text-slate-600">Select a conversation</p>
                  <p className="text-xs text-slate-400">Click any conversation on the left to open it</p>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col min-w-0">
                {/* Thread header */}
                <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between flex-shrink-0 bg-white">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-sm font-bold">
                      {selectedConv.name?.[0]?.toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{selectedConv.name}</p>
                      {selectedConv.handle && <p className="text-xs text-slate-400">@{selectedConv.handle}</p>}
                    </div>
                  </div>
                  <button onClick={() => addToPipeline(selectedConv)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-600 text-xs font-semibold rounded-lg hover:bg-indigo-100 border border-indigo-200">
                    + Add to Pipeline
                  </button>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                  {messagesLoading && messages.length === 0 ? (
                    <div className="text-center text-slate-400 text-xs pt-8">Loading messages…</div>
                  ) : messages.length === 0 ? (
                    <div className="text-center text-slate-400 text-xs pt-8">No messages yet</div>
                  ) : (
                    messages.map((msg) => (
                      <div key={msg.id} className={`flex ${msg.isOwn ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[70%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                          msg.isOwn
                            ? "bg-indigo-600 text-white rounded-br-sm"
                            : "bg-slate-100 text-slate-800 rounded-bl-sm"
                        }`}>
                          <p>{msg.text}</p>
                          <p className={`text-[10px] mt-1 ${msg.isOwn ? "text-indigo-200" : "text-slate-400"}`}>
                            {timeAgo(msg.createdTime)}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Reply input */}
                <div className="px-4 py-3 border-t border-slate-200 flex-shrink-0 bg-white">
                  <div className="flex items-end gap-2">
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
                      placeholder="Type a message… (Enter to send)"
                      rows={2}
                      className="flex-1 border border-slate-200 rounded-xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                    <button
                      onClick={sendReply}
                      disabled={!replyText.trim() || sending}
                      className="px-4 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                    >
                      {sending ? "…" : "Send"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showAdd && (
        <LeadModal selectedClientId={selectedClientId} lead={editLead}
          onClose={() => { setShowAdd(false); setEditLead(null); }}
          onSaved={() => { setShowAdd(false); setEditLead(null); loadLeads(); }}
        />
      )}
    </div>
  );
}

// ── Droppable column ──────────────────────────────────────────────────────────
function KanbanCol({ statusVal, meta, col, activeDragId, onEdit, onDelete }: {
  statusVal: string;
  meta: { label: string; bg: string; text: string; border: string };
  col: DmLead[];
  activeDragId: number | null;
  onEdit: (lead: DmLead) => void;
  onDelete: (id: number) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: statusVal });
  return (
    <div className="flex flex-col gap-2 flex-1">
      <div className={`flex items-center justify-between px-3 py-2 rounded-lg border ${meta.bg} ${meta.border}`}>
        <span className={`text-xs font-semibold ${meta.text} truncate`}>{meta.label}</span>
        <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full bg-white/70 ${meta.text} ml-1 flex-shrink-0`}>{col.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className={`flex flex-col gap-2 min-h-[120px] rounded-xl transition-colors ${isOver && activeDragId ? "bg-indigo-50/60 ring-2 ring-inset ring-indigo-300" : ""}`}
      >
        {col.map((lead) => (
          <DraggableLeadCard key={lead.id} lead={lead}
            onEdit={() => onEdit(lead)}
            onDelete={() => onDelete(lead.id)}
          />
        ))}
        {col.length === 0 && (
          <div className={`border-2 border-dashed rounded-xl h-16 flex items-center justify-center text-xs transition-colors ${isOver && activeDragId ? "border-indigo-300 text-indigo-300" : "border-slate-100 text-slate-300"}`}>
            drop here
          </div>
        )}
      </div>
    </div>
  );
}

// ── Draggable card wrapper ────────────────────────────────────────────────────
function DraggableLeadCard({ lead, onEdit, onDelete }: {
  lead: DmLead; onEdit: () => void; onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: String(lead.id) });
  const style = transform
    ? { transform: `translate(${transform.x}px,${transform.y}px)`, opacity: isDragging ? 0.3 : 1 }
    : {};
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="touch-none cursor-grab active:cursor-grabbing">
      <LeadCardInner lead={lead} onEdit={onEdit} onDelete={onDelete} />
    </div>
  );
}

// ── Card content ──────────────────────────────────────────────────────────────
function LeadCardInner({ lead, onEdit, onDelete }: {
  lead: DmLead; onEdit?: () => void; onDelete?: () => void;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm select-none group">
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-slate-800 truncate">{lead.name}</p>
          {lead.handle && <p className="text-[10px] text-slate-400 truncate">@{lead.handle.replace(/^@/, "")}</p>}
          {lead.date && <p className="text-[10px] text-slate-300 mt-0.5">{lead.date.slice(5).replace("-", "/")}</p>}
        </div>
        {(onEdit || onDelete) && (
          <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
            {onEdit   && <button onPointerDown={(e) => e.stopPropagation()} onClick={onEdit}   className="p-0.5 text-slate-300 hover:text-slate-600 rounded text-xs">✏</button>}
            {onDelete && <button onPointerDown={(e) => e.stopPropagation()} onClick={onDelete} className="p-0.5 text-slate-300 hover:text-red-500 rounded text-xs">✕</button>}
          </div>
        )}
      </div>
      {lead.notes && <p className="text-[10px] text-slate-400 mt-1.5 line-clamp-2">{lead.notes}</p>}
    </div>
  );
}

// ── Add/Edit lead modal ────────────────────────────────────────────────────────
function LeadModal({ selectedClientId, lead, onClose, onSaved }: {
  selectedClientId: number | null; lead: DmLead | null; onClose: () => void; onSaved: () => void;
}) {
  function todayYMD(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }
  const [form, setForm] = useState({
    name: lead?.name ?? "", handle: lead?.handle ?? "",
    status: lead?.status ?? "follows", date: lead?.date ?? todayYMD(), notes: lead?.notes ?? "",
  });
  function set(k: string, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (lead) {
      await fetch(`/api/dm-leads/${lead.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    } else {
      await fetch("/api/dm-leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, clientId: selectedClientId }) });
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-800">{lead ? "Edit Lead" : "Add Lead"}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Name *</label>
              <input required value={form.name} onChange={(e) => set("name", e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Instagram</label>
              <input value={form.handle} onChange={(e) => set("handle", e.target.value)} placeholder="@handle"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Date messaged</label>
            <input type="date" value={form.date} onChange={(e) => set("date", e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2">Status</label>
            <div className="flex flex-wrap gap-1.5">
              {DM_STATUSES.map((s) => (
                <button key={s.value} type="button" onClick={() => set("status", s.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${form.status === s.value ? `${s.bg} ${s.text} ${s.border}` : "bg-white text-slate-400 border-slate-200"}`}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
            <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
            <button type="submit" className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">{lead ? "Save" : "Add Lead"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
