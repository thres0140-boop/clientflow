"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, useSensor, useSensors, useDroppable, useDraggable,
} from "@dnd-kit/core";
import { Client, DmLead, DM_STATUSES } from "@/shared/types";
import { imgSrc, videoSrc } from "@/shared/media/videoSrc";

// One component, two sidebar pages: the shell passes `view` ("dms" → pipeline, "iginbox" → inbox)
// so both share the fetch/state logic below.
type View = "pipeline" | "inbox";
type Props = { clients: Client[]; selectedClientId: number | null; onGoToSettings?: () => void; view: View };
type Period = "day" | "week" | "2weeks" | "month" | "all";

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
  return p === "day" ? 1 : p === "week" ? 7 : p === "2weeks" ? 14 : p === "month" ? 28 : Infinity;
}
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function rangeLabel(start: Date, count: number): string {
  if (!isFinite(count)) return "All time";
  // Single-day view → "Today" / "Yesterday" / the date
  if (count === 1) {
    const today = new Date();
    if (isSameDay(start, today)) return "Today";
    if (isSameDay(start, addDays(today, -1))) return "Yesterday";
    return `${MONTHS[start.getMonth()]} ${start.getDate()}, ${start.getFullYear()}`;
  }
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
const NEXT: Record<string, string> = { messaged: "answered", answered: "link_sent", link_sent: "booked", booked: "closed" };

// ── Inbox types (field names are Zernio's real ones — see the OpenAPI spec) ─────────────
type Conversation = {
  id: string; name: string; handle: string | null; igId: string | null;
  updatedTime: string; snippet: string | null; unreadCount: number | null;
  avatar?: string | null;
  url?: string | null; // link to the thread on Instagram, when Zernio has it
};
type Attachment = {
  index: number; id?: string;
  type: "image" | "video" | "audio" | "file" | "sticker" | "share" | "template" | string;
  originalType?: string | null;      // ig_reel | reel | ig_post | post | ig_story | story_mention …
  url?: string | null;               // signed Meta CDN link — EXPIRES; re-mint via /attachments route
  previewUrl?: string | null;
  filename?: string | null;
  payload?: Record<string, unknown> | null;
};
type Message = {
  id: string; text: string; fromId: string; fromName: string;
  isOwn: boolean; createdTime: string;
  attachments: Attachment[];
  storyReply?: boolean; isStoryMention?: boolean; isDeleted?: boolean;
  deliveryStatus?: string | null;
};

// Avatar that goes through /api/img (Instagram's CDN refuses cross-origin hotlinks) and falls
// back to the initial via STATE — a broken image is logged, not hidden.
function Avatar({ src, name, className }: { src?: string | null; name: string; className: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  const initial = name?.trim()?.[0]?.toUpperCase() ?? "?";
  if (!src || failed) {
    return <div className={`${className} rounded-full bg-accent-tint text-accent-strong flex items-center justify-center font-bold select-none`}>{initial}</div>;
  }
  return (
    <img src={imgSrc(src)} alt={name} className={`${className} rounded-full object-cover bg-surface-3`}
      onError={() => { console.warn("[inbox] avatar failed to load:", src); setFailed(true); }} />
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function DmsPage({ clients, selectedClientId, onGoToSettings, view }: Props) {

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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const refreshTimer   = useRef<ReturnType<typeof setInterval> | null>(null);
  const listRef        = useRef<HTMLDivElement>(null);
  const scrollToBottomRef = useRef<"instant" | "smooth" | null>(null);
  const [olderCursor, setOlderCursor]     = useState<string | null>(null);
  const [hasOlder, setHasOlder]           = useState(false);
  const [loadingOlder, setLoadingOlder]   = useState(false);
  const [inboxTruncated, setInboxTruncated] = useState(false);

  const client = clients.find((c) => c.id === selectedClientId) ?? null;

  // Load leads
  useEffect(() => { loadLeads(); }, [selectedClientId]);
  async function loadLeads() {
    if (!selectedClientId) return;
    const data = await fetch(`/api/dm-leads?clientId=${selectedClientId}`).then((r) => r.json());
    setLeads(Array.isArray(data) ? data : []);
  }

  // Load inbox conversations via Zernio — the API route follows Zernio's cursor and returns the
  // whole inbox. Auto-retries one transient failure.
  const loadInbox = useCallback(async () => {
    if (!selectedClientId) return;
    setInboxLoading(true);
    setInboxError(null);

    const attempt = async (): Promise<any> => {
      const res = await fetch(`/api/zernio/conversations?clientId=${selectedClientId}`);
      return res.json();
    };

    try {
      let data = await attempt();
      if (data?.error && data.error !== "no_zernio_account") {
        await new Promise((r) => setTimeout(r, 1500));
        data = await attempt();
      }
      if (data.error === "no_zernio_account") { setInboxError("no_zernio_account"); }
      else if (data.error) { setInboxError(data.error); }
      else {
        const raw: any[] = Array.isArray(data.data) ? data.data : [];
        // Zernio conversation object: id, participantId, participantName, participantPicture,
        // lastMessage (string), updatedTime, unreadCount, url. (participantUsername is only on
        // the search endpoint; keep it if present.)
        const convs: Conversation[] = raw.map((c: any) => ({
          id: String(c.id),
          igId: c.participantId ?? null,
          name: c.participantName ?? "Unknown",
          handle: c.participantUsername ?? null,
          avatar: c.participantPicture ?? null,
          snippet: typeof c.lastMessage === "string" ? c.lastMessage : (c.lastMessage?.text ?? null),
          updatedTime: c.updatedTime ?? new Date().toISOString(),
          unreadCount: c.unreadCount ?? 0,
          url: c.url ?? null,
        }));
        convs.sort((a, b) => new Date(b.updatedTime).getTime() - new Date(a.updatedTime).getTime());
        setConversations(convs);
        setInboxTruncated(!!data.pagination?.truncated);
      }
    } catch (e) { setInboxError(String(e)); }
    setInboxLoading(false);
  }, [selectedClientId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Server-side detection: scans Zernio convos + messages, updates leads + analytics.
  // Runs whenever the DM page opens for a client, then refreshes the cards.
  const runSync = useCallback(async () => {
    if (!selectedClientId) return;
    try {
      await fetch(`/api/zernio/sync-pipeline?clientId=${selectedClientId}`);
    } catch { /* ignore */ }
    loadLeads();
  }, [selectedClientId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedClientId) { loadInbox(); runSync(); }
  }, [selectedClientId, loadInbox, runSync]);

  // ── Messages: paged, newest first from the API, displayed oldest → newest ──────────────
  // Zernio message object: id, message, senderId, senderName, direction (incoming|outgoing),
  // createdAt, attachments[], storyReply, isStoryMention, isDeleted, deliveryStatus.
  function mapMessage(m: any): Message {
    return {
      id: String(m.id),
      text: m.message ?? "",
      fromId: m.senderId ?? "",
      fromName: m.senderName ?? "",
      isOwn: m.direction === "outgoing",
      createdTime: m.createdAt ?? m.sentAt ?? "",
      attachments: (Array.isArray(m.attachments) ? m.attachments : []).map((a: any, i: number) => ({
        index: i, id: a.id, type: a.type ?? "file", originalType: a.originalType ?? null,
        url: a.url ?? null, previewUrl: a.previewUrl ?? null, filename: a.filename ?? null, payload: a.payload ?? null,
      })),
      storyReply: !!m.storyReply, isStoryMention: !!m.isStoryMention, isDeleted: !!m.isDeleted,
      deliveryStatus: m.deliveryStatus ?? null,
    };
  }
  const byTime = (a: Message, b: Message) => new Date(a.createdTime).getTime() - new Date(b.createdTime).getTime();

  async function fetchPage(convId: string, cursor?: string | null): Promise<{ msgs: Message[]; nextCursor: string | null; hasMore: boolean } | null> {
    if (!selectedClientId) return null;
    const u = new URL(`/api/zernio/conversations/${convId}/messages`, window.location.origin);
    u.searchParams.set("clientId", String(selectedClientId));
    u.searchParams.set("limit", "50");
    u.searchParams.set("sortOrder", "desc");
    if (cursor) u.searchParams.set("cursor", cursor);
    const data = await fetch(u.toString()).then((r) => r.json());
    if (data.error) { console.error("loadMessages error:", data.error); return null; }
    return { msgs: (data.messages ?? []).map(mapMessage), nextCursor: data.pagination?.nextCursor ?? null, hasMore: !!data.pagination?.hasMore };
  }

  // Initial load for a conversation: newest 50, scroll to bottom.
  const loadMessages = useCallback(async (conv: Conversation) => {
    setMessagesLoading(true);
    try {
      const page = await fetchPage(conv.id);
      if (!page) return;
      setMessages(page.msgs.sort(byTime));
      setOlderCursor(page.nextCursor);
      setHasOlder(page.hasMore);
      scrollToBottomRef.current = "instant";

      // Auto-detect if booking link was already sent in this conversation
      const bookingLink = client?.bookingLink;
      if (bookingLink && page.msgs.some((m) => m.isOwn && m.text.includes(bookingLink))) promoteToStatus(conv, "link_sent");
    } finally {
      setMessagesLoading(false);
    }
  }, [selectedClientId, client?.bookingLink]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll: refetch the newest page and merge by id (keeps unsynced optimistic messages).
  const pollMessages = useCallback(async (conv: Conversation) => {
    const page = await fetchPage(conv.id);
    if (!page) return;
    setMessages((prev) => {
      const seen = new Set(page.msgs.map((m) => m.id));
      const kept = prev.filter((m) => !seen.has(m.id) && !(m.id.startsWith("opt-") && page.msgs.some((p) => p.isOwn && p.text === m.text)));
      const merged = [...kept, ...page.msgs].sort(byTime);
      if (merged.length > prev.length) scrollToBottomRef.current = "smooth";
      return merged;
    });
  }, [selectedClientId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Older: called when the list is scrolled to the top; prepends and preserves the viewport.
  const loadOlder = useCallback(async (conv: Conversation) => {
    if (!hasOlder || loadingOlder || !olderCursor) return;
    setLoadingOlder(true);
    const el = listRef.current;
    const before = el ? el.scrollHeight - el.scrollTop : 0;
    try {
      const page = await fetchPage(conv.id, olderCursor);
      if (!page) return;
      setMessages((prev) => { const ids = new Set(prev.map((m) => m.id)); return [...page.msgs.filter((m) => !ids.has(m.id)), ...prev].sort(byTime); });
      setOlderCursor(page.nextCursor);
      setHasOlder(page.hasMore);
      requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - before; });
    } finally {
      setLoadingOlder(false);
    }
  }, [hasOlder, loadingOlder, olderCursor, selectedClientId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedConv) return;
    setMessages([]); setOlderCursor(null); setHasOlder(false);
    loadMessages(selectedConv);
    refreshTimer.current = setInterval(() => pollMessages(selectedConv), 10000);
    return () => { if (refreshTimer.current) clearInterval(refreshTimer.current); };
  }, [selectedConv, loadMessages, pollMessages]);

  // Scroll to bottom only when asked (initial load / new message), never when older messages
  // are prepended — that would yank the reader away from what they scrolled up to read.
  useEffect(() => {
    const how = scrollToBottomRef.current;
    if (!how) return;
    scrollToBottomRef.current = null;
    messagesEndRef.current?.scrollIntoView({ behavior: how === "smooth" ? "smooth" : "auto" });
  }, [messages]);

  async function sendMessage(text: string) {
    if (!text.trim() || !selectedConv || !selectedClientId) return;
    setSending(true);
    const optimistic: Message = {
      id: `opt-${Date.now()}`, text, fromId: "me", fromName: "You",
      isOwn: true, createdTime: new Date().toISOString(), attachments: [],
    };
    scrollToBottomRef.current = "smooth";
    setMessages((prev) => [...prev, optimistic]);
    try {
      const res = await fetch(`/api/zernio/conversations/${selectedConv.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: selectedClientId,
          message: text,
          recipientName: selectedConv.name,
          recipientHandle: selectedConv.handle || null,
        }),
      });
      const data = await res.json();
      if (data.error) {
        alert(`Send failed: ${data.error}`);
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        return text; // return so caller can restore input
      } else {
        loadLeads();
        setTimeout(() => pollMessages(selectedConv), 1500);
      }
    } finally {
      setSending(false);
    }
  }

  async function sendReply() {
    if (!replyText.trim()) return;
    const text = replyText.trim();
    setReplyText("");
    const failed = await sendMessage(text);
    if (failed) setReplyText(failed);
  }

  // Strip @ from handle for consistent comparison
  function normalizeHandle(h: string | null | undefined) {
    return (h ?? "").replace(/^@/, "").toLowerCase().trim();
  }

  async function promoteToStatus(conv: Conversation, status: string) {
    if (!selectedClientId) return;

    // Always fetch fresh leads from DB — avoids stale-state duplicates when
    // the cron has created a lead since the page last loaded.
    const freshData = await fetch(`/api/dm-leads?clientId=${selectedClientId}`).then((r) => r.json());
    const freshLeads: DmLead[] = Array.isArray(freshData) ? freshData : [];
    setLeads(freshLeads);

    const convHandle = normalizeHandle(conv.handle);
    // Match by handle first; fall back to name if handle is blank
    const lead = freshLeads.find((l) => {
      if (convHandle) return normalizeHandle(l.handle) === convHandle;
      return l.name.toLowerCase().trim() === conv.name.toLowerCase().trim();
    });

    const statusOrder = ["messaged", "answered", "link_sent", "booked", "no_show", "unqualified", "no_close", "closed"];
    const currentIdx = statusOrder.indexOf(lead?.status ?? "");
    const newIdx = statusOrder.indexOf(status);

    if (lead) {
      // Only promote, never demote
      if (newIdx > currentIdx) moveStatus(lead, status);
    } else {
      // Not in pipeline yet — create at this status
      await fetch("/api/dm-leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: selectedClientId,
          name: conv.name,
          handle: conv.handle?.replace(/^@/, "") || null,
          status,
          date: toYMD(new Date()),
        }),
      });
      loadLeads();
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
        status: "messaged",
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
  // A lead belongs to the period if ANY of its activity (messaged, replied, link sent, booked)
  // falls within it — so a conversation that progresses this week shows even if messaged earlier.
  const inRange  = (d?: string | null) => { const x = d?.slice(0, 10); return !!x && !!from && !!to && x >= from && x <= to; };
  const filtered = leads.filter((l) =>
    period === "all" || inRange(l.date) || inRange((l as any).repliedAt) || inRange((l as any).linkSentAt) || inRange((l as any).bookedAt)
  );

  const total      = filtered.length;
  const countOf = (statuses: string[]) => filtered.filter((l) => statuses.includes(l.status)).length;
  const leadsBy = (s: string) => filtered.filter((l) => l.status === s);

  // Funnel (cumulative) counts for the summary cards — "how many reached this stage",
  // matching the Analytics totals. Columns below still show current state.
  const funnelCount = (s: string) => {
    if (s === "messaged")  return filtered.length;
    if (s === "answered")  return filtered.filter((l) => (l as any).repliedAt).length;
    if (s === "link_sent") return filtered.filter((l) => (l as any).linkSentAt).length;
    if (s === "booked")    return filtered.filter((l) => (l as any).bookedAt).length;
    return filtered.filter((l) => l.status === s).length; // terminal outcomes = current state
  };

  const filteredConvs = conversations.filter((c) =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.handle && c.handle.toLowerCase().includes(search.toLowerCase()))
  );

  if (!selectedClientId) {
    return <div className="flex items-center justify-center h-64 text-faint text-sm">Select a client</div>;
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">{view === "inbox" ? "Instagram Inbox" : "DM Pipeline"}</h1>
          <p className="text-muted mt-0.5 text-sm">{client?.name}</p>
        </div>
        <div className="flex items-center gap-3">
          {view === "pipeline" && (
            <button onClick={() => { setEditLead(null); setShowAdd(true); }}
              className="bg-accent text-on-accent px-4 py-2 rounded-lg text-sm font-medium hover:bg-accent-strong">
              + Add Lead
            </button>
          )}
        </div>
      </div>

      {/* ── PIPELINE VIEW ──────────────────────────────────────────────── */}
      {view === "pipeline" && (
        <div className="flex flex-col flex-1 min-h-0 gap-4">
          {/* Date controls */}
          <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
            <div className="flex gap-0.5 bg-surface-3 rounded-lg p-0.5">
              {(["day","week","2weeks","month","all"] as Period[]).map((p) => (
                <button key={p} onClick={() => {
                  setPeriod(p);
                  if (p === "day") { const t = new Date(); t.setHours(0,0,0,0); setStartDate(t); }
                  else if (p !== "all") setStartDate(getMonday(new Date()));
                }}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${period === p ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink-2"}`}>
                  {p === "day" ? "Day" : p === "week" ? "1 Week" : p === "2weeks" ? "2 Weeks" : p === "month" ? "Month" : "All time"}
                </button>
              ))}
            </div>
            {period !== "all" && (
              <>
                <div className="flex items-center bg-surface border border-line rounded-lg overflow-hidden">
                  <button onClick={() => setStartDate((d) => addDays(d, -days))} className="px-3 py-2 hover:bg-surface-2 text-muted border-r border-line">‹</button>
                  <span className="px-4 text-sm font-medium text-ink-2 whitespace-nowrap">{rangeLabel(startDate, days)}</span>
                  <button onClick={() => setStartDate((d) => addDays(d, days))}  className="px-3 py-2 hover:bg-surface-2 text-muted border-l border-line">›</button>
                </div>
                <button onClick={() => {
                  if (period === "day") { const t = new Date(); t.setHours(0,0,0,0); setStartDate(t); }
                  else setStartDate(getMonday(new Date()));
                }}
                  className="px-3 py-2 text-xs border border-line rounded-lg text-muted hover:bg-surface-2 bg-surface">Now</button>
              </>
            )}
            <span className="text-xs text-faint">{filtered.length} lead{filtered.length !== 1 ? "s" : ""}</span>
          </div>

          {/* Stats + Kanban — horizontal scroll wrapper, fills remaining height */}
          <div className="flex-1 min-h-0 overflow-x-auto">
            <div style={{ minWidth: `${DM_STATUSES.length * 160}px` }} className="flex flex-col h-full">
              {/* Stats row — pinned (doesn't scroll vertically) */}
              <div className="flex gap-2 pb-1 flex-shrink-0">
                {DM_STATUSES.map((s) => {
                  const count = funnelCount(s.value);
                  return (
                    <div key={s.value} className={`flex-1 rounded-xl border px-3 py-3 ${s.bg} ${s.border}`}>
                      <p className={`text-[11px] font-semibold truncate ${s.text}`}>{s.label}</p>
                      <p className={`text-2xl font-bold mt-0.5 ${s.text}`}>{count}</p>
                      <p className="text-[10px] text-faint mt-0.5">lead{count !== 1 ? "s" : ""}</p>
                    </div>
                  );
                })}
              </div>

              {/* Kanban — drag & drop; each column scrolls internally */}
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
                <div className="flex gap-3 mt-4 flex-1 min-h-0">
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
            </div>
          </div>{/* end overflow-x-auto */}
        </div>
      )}

      {/* ── INBOX VIEW ─────────────────────────────────────────────────── */}
      {view === "inbox" && (
        <div className="bg-surface rounded-2xl border border-line overflow-hidden flex-1 min-h-0">
          <div className="flex h-full">
            {/* Left: conversation list */}
            <div className="w-80 flex-shrink-0 border-r border-line flex flex-col">
              {/* Search + refresh */}
              <div className="px-3 py-3 border-b border-line flex items-center gap-2">
                <input
                  value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search conversations…"
                  className="flex-1 text-sm border border-line rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent"
                />
                <button onClick={loadInbox} disabled={inboxLoading}
                  className="p-1.5 text-faint hover:text-accent hover:bg-accent-tint rounded-lg transition-colors disabled:opacity-40 text-sm">
                  {inboxLoading ? "…" : "↻"}
                </button>
              </div>

              {/* Conversation list */}
              <div className="flex-1 overflow-y-auto">
                {inboxError ? (
                  <div className="p-6 text-center space-y-2">
                    {inboxError === "no_zernio_account" ? (
                      <>
                        <p className="text-3xl mb-2">🔌</p>
                        <p className="text-sm font-semibold text-ink-2">Instagram DMs not connected</p>
                        <p className="text-[11px] text-faint leading-relaxed max-w-[200px] mx-auto mt-1">
                          Connect this client's Instagram account in Settings to enable the DM inbox.
                        </p>
                        <button
                          onClick={onGoToSettings}
                          className="mt-3 px-4 py-2 text-xs font-semibold bg-accent text-on-accent rounded-lg hover:bg-accent-strong"
                        >
                          Go to Settings →
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="text-xs font-semibold text-danger-500">Could not load inbox</p>
                        <p className="text-[11px] text-faint leading-relaxed">{inboxError}</p>
                      </>
                    )}
                    <button onClick={loadInbox} className="mt-2 px-3 py-1.5 text-xs bg-accent text-on-accent rounded-lg hover:bg-accent-strong">Retry</button>
                  </div>
                ) : inboxLoading && conversations.length === 0 ? (
                  <div className="p-8 text-center text-faint text-xs">Loading conversations…</div>
                ) : filteredConvs.length === 0 ? (
                  <div className="p-8 text-center text-faint text-xs">
                    {search ? "No matches" : "No conversations yet"}
                  </div>
                ) : (
                  filteredConvs.map((conv) => (
                    <button key={conv.id} onClick={() => setSelectedConv(conv)}
                      className={`w-full flex items-start gap-3 px-4 py-3.5 text-left border-b border-line-softer hover:bg-surface-2 transition-colors ${selectedConv?.id === conv.id ? "bg-accent-tint border-l-2 border-l-accent" : ""}`}>
                      {/* Avatar */}
                      <Avatar src={conv.avatar} name={conv.name} className="w-10 h-10 text-sm flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <p className="text-sm font-semibold text-ink truncate">{conv.name}</p>
                          <span className="text-[10px] text-faint flex-shrink-0">{timeAgo(conv.updatedTime)}</span>
                        </div>
                        {conv.handle && <p className="text-[11px] text-faint">@{conv.handle}</p>}
                        {conv.snippet && <p className="text-xs text-faint mt-0.5 truncate">{conv.snippet}</p>}
                      </div>
                      {conv.unreadCount != null && conv.unreadCount > 0 && (
                        <div className="w-5 h-5 bg-accent rounded-full flex items-center justify-center text-on-accent text-[10px] font-bold flex-shrink-0 mt-1">
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
              <div className="flex-1 flex items-center justify-center text-faint text-sm">
                <div className="text-center space-y-2">
                  <div className="text-4xl">💬</div>
                  <p className="font-medium text-ink-2">Select a conversation</p>
                  <p className="text-xs text-faint">Click any conversation on the left to open it</p>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col min-w-0">
                {/* Thread header */}
                <div className="px-5 py-3.5 border-b border-line flex items-center justify-between flex-shrink-0 bg-surface">
                  <div className="flex items-center gap-3">
                    <Avatar src={selectedConv.avatar} name={selectedConv.name} className="w-9 h-9 text-sm" />
                    <div>
                      <p className="text-sm font-semibold text-ink">{selectedConv.name}</p>
                      {selectedConv.handle && <p className="text-xs text-faint">@{selectedConv.handle}</p>}
                    </div>
                  </div>
                  <button onClick={() => addToPipeline(selectedConv)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-tint text-accent text-xs font-semibold rounded-lg hover:bg-accent-tint border border-accent-tint">
                    + Add to Pipeline
                  </button>
                </div>

                {/* Messages */}
                <div ref={listRef} className="flex-1 overflow-y-auto px-5 py-4"
                  onScroll={(e) => { if (e.currentTarget.scrollTop < 40 && selectedConv) loadOlder(selectedConv); }}>
                  <div className="flex flex-col min-h-full justify-end gap-3">
                  {loadingOlder && <div className="text-center text-faint text-[11px]">Loading older…</div>}
                  {messagesLoading && messages.length === 0 ? (
                    <div className="text-center text-faint text-xs">Loading messages…</div>
                  ) : messages.length === 0 ? (
                    <div className="text-center text-faint text-xs">No messages yet</div>
                  ) : (
                    messages.map((msg) => (
                      <div key={msg.id} className={`flex ${msg.isOwn ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[70%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                          msg.isOwn
                            ? "bg-accent text-on-accent rounded-br-sm"
                            : "bg-surface-3 text-ink rounded-bl-sm"
                        }`}>
                          <p>{msg.text}</p>
                          <p className={`text-[10px] mt-1 ${msg.isOwn ? "text-accent-tint" : "text-faint"}`}>
                            {timeAgo(msg.createdTime)}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={messagesEndRef} />
                  </div>
                </div>

                {/* Reply input */}
                <div className="px-4 py-3 border-t border-line flex-shrink-0 bg-surface">
                  <div className="flex items-end gap-2">
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
                      placeholder="Type a message… (Enter to send)"
                      rows={2}
                      className="flex-1 border border-line rounded-xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-accent"
                    />
                    <button
                      onClick={sendReply}
                      disabled={!replyText.trim() || sending}
                      className="px-4 py-2.5 bg-accent text-on-accent text-sm font-semibold rounded-xl hover:bg-accent-strong disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
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
    <div className="flex flex-col gap-2 flex-1 min-w-0 min-h-0">
      <div className={`flex items-center justify-between px-3 py-2 rounded-lg border flex-shrink-0 ${meta.bg} ${meta.border}`}>
        <span className={`text-xs font-semibold ${meta.text} truncate`}>{meta.label}</span>
        <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full bg-surface/70 ${meta.text} ml-1 flex-shrink-0`}>{col.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className={`flex flex-col gap-2 flex-1 min-h-0 overflow-y-auto rounded-xl transition-colors pb-2 ${isOver && activeDragId ? "bg-accent-tint/60 ring-2 ring-inset ring-accent" : ""}`}
      >
        {col.map((lead) => (
          <DraggableLeadCard key={lead.id} lead={lead}
            onEdit={() => onEdit(lead)}
            onDelete={() => onDelete(lead.id)}
          />
        ))}
        {col.length === 0 && (
          <div className={`border-2 border-dashed rounded-xl h-16 flex items-center justify-center text-xs transition-colors ${isOver && activeDragId ? "border-accent text-accent" : "border-line text-faint"}`}>
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
function timeAgoShort(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function LeadCardInner({ lead, onEdit, onDelete }: {
  lead: DmLead; onEdit?: () => void; onDelete?: () => void;
}) {
  return (
    <div className="bg-surface border border-line rounded-xl p-3 shadow-sm select-none group">
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-ink truncate">{lead.name}</p>
          {lead.handle && <p className="text-[10px] text-faint truncate">@{lead.handle.replace(/^@/, "")}</p>}
          {lead.date && <p className="text-[10px] text-faint mt-0.5">{lead.date.slice(5).replace("-", "/")}</p>}
          {(lead as any).source === "cta" && (
            <p className="text-[10px] font-medium text-hue-orange-500 mt-1">⚡ CTA inbound</p>
          )}
          {lead.status === "link_sent" && (lead as any).linkSentAt && (
            <p className="text-[10px] font-medium text-accent mt-1">🔗 Link sent {timeAgoShort((lead as any).linkSentAt)}</p>
          )}
        </div>
        {(onEdit || onDelete) && (
          <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
            {onEdit   && <button onPointerDown={(e) => e.stopPropagation()} onClick={onEdit}   className="p-0.5 text-faint hover:text-ink-2 rounded text-xs">✏</button>}
            {onDelete && <button onPointerDown={(e) => e.stopPropagation()} onClick={onDelete} className="p-0.5 text-faint hover:text-danger-500 rounded text-xs">✕</button>}
          </div>
        )}
      </div>
      {lead.notes && <p className="text-[10px] text-faint mt-1.5 line-clamp-2">{lead.notes}</p>}
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
    status: lead?.status ?? "messaged", date: lead?.date ?? todayYMD(), notes: lead?.notes ?? "",
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
      <div className="bg-surface rounded-2xl o-elev-pop w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <h2 className="text-base font-semibold text-ink">{lead ? "Edit Lead" : "Add Lead"}</h2>
          <button onClick={onClose} className="text-faint hover:text-ink-2">✕</button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ink-2 mb-1">Name *</label>
              <input required value={form.name} onChange={(e) => set("name", e.target.value)}
                className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-2 mb-1">Instagram</label>
              <input value={form.handle} onChange={(e) => set("handle", e.target.value)} placeholder="@handle"
                className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-2 mb-1">Date messaged</label>
            <input type="date" value={form.date} onChange={(e) => set("date", e.target.value)}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-2 mb-2">Status</label>
            <div className="flex flex-wrap gap-1.5">
              {DM_STATUSES.map((s) => (
                <button key={s.value} type="button" onClick={() => set("status", s.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${form.status === s.value ? `${s.bg} ${s.text} ${s.border}` : "bg-surface text-faint border-line"}`}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-2 mb-1">Notes</label>
            <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent resize-none" />
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-ink-2 hover:bg-surface-3 rounded-lg">Cancel</button>
            <button type="submit" className="px-4 py-2 text-sm bg-accent text-on-accent rounded-lg hover:bg-accent-strong">{lead ? "Save" : "Add Lead"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
