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
  // Meta did not resolve the sender (story replies / reactions): participantName is missing or
  // the placeholder "Instagram User". Keyed on the NAME only — a real person without a profile
  // picture is still identified.
  unidentified: boolean;
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
  const [failedSrc, setFailedSrc] = useState<string | null>(null); // a new src resets the fallback by comparison
  const failed = !!src && failedSrc === src;
  const initial = name?.trim()?.[0]?.toUpperCase() ?? "?";
  if (!src || failed) {
    return <div className={`${className} rounded-full bg-accent-tint text-accent-strong flex items-center justify-center font-bold select-none`}>{initial}</div>;
  }
  return (
    <img src={imgSrc(src)} alt={name} className={`${className} rounded-full object-cover bg-surface-3`}
      onError={() => { console.warn("[inbox] avatar failed to load:", src); setFailedSrc(src); }} />
  );
}

// ── Chat helpers ──────────────────────────────────────────────────────────────
function dayLabel(dateStr: string): string {
  const d = new Date(dateStr), today = new Date();
  if (isSameDay(d, today)) return "Today";
  if (isSameDay(d, addDays(today, -1))) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
}
function hhmm(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
const URL_RE = /(https?:\/\/[^\s<>"']+)/g;
function hostOf(u: string): string { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } }

// Message text with URLs linkified, and a compact link card for each distinct URL.
function MessageText({ text, own }: { text: string; own: boolean }) {
  const parts = text.split(URL_RE);
  const urls = Array.from(new Set(text.match(URL_RE) ?? []));
  return (
    <>
      <p className="whitespace-pre-wrap break-words">
        {parts.map((p, i) => URL_RE.test(p) && p.startsWith("http")
          ? <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 break-all">{p}</a>
          : <span key={i}>{p}</span>)}
      </p>
      {urls.map((u) => (
        <a key={u} href={u} target="_blank" rel="noopener noreferrer"
          className={`mt-1.5 flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs ${own ? "bg-on-accent/10 hover:bg-on-accent/20" : "bg-surface-2 hover:bg-surface-4"}`}>
          <span className="w-6 h-6 rounded-md flex items-center justify-center text-[11px] flex-shrink-0 bg-surface/60">🔗</span>
          <span className="min-w-0">
            <span className="block font-semibold truncate">{hostOf(u)}</span>
            <span className={`block truncate ${own ? "opacity-70" : "text-muted"}`}>{u.replace(/^https?:\/\/(www\.)?/, "")}</span>
          </span>
        </a>
      ))}
    </>
  );
}

// One attachment. Instagram media urls are signed and expire; on a load error we ask our
// refresh route (→ Zernio re-mints it) once, then render through /api/img or /api/vid.
function AttachmentView({ a, msg, convId, clientId, own }: { a: Attachment; msg: Message; convId: string; clientId: number; own: boolean }) {
  const base = a.url ?? a.previewUrl ?? null;
  // Refresh state is keyed on the base url so a re-rendered attachment with a new url starts clean.
  const [st, setSt] = useState<{ for: string | null; url: string | null; tried: boolean; dead: boolean }>({ for: base, url: base, tried: false, dead: false });
  const cur = st.for === base ? st : { for: base, url: base, tried: false, dead: false };
  const url = cur.url, dead = cur.dead;
  async function refresh() {
    if (cur.tried) { setSt({ ...cur, dead: true }); return; }
    setSt({ ...cur, tried: true });
    try {
      const d = await fetch(`/api/zernio/conversations/${convId}/attachments?clientId=${clientId}&messageId=${encodeURIComponent(msg.id)}&index=${a.index}`).then((r) => r.json());
      if (typeof d?.url === "string") setSt({ for: base, url: d.url, tried: true, dead: false }); else setSt({ ...cur, tried: true, dead: true });
    } catch { setSt({ ...cur, tried: true, dead: true }); }
  }
  const kind = a.originalType ?? a.type;
  const shareLabel = kind === "story_mention" || kind === "ig_story" || kind === "story" ? "Mentioned you in a story"
    : kind === "ig_reel" || kind === "reel" ? "Shared a reel"
    : kind === "ig_post" || kind === "post" ? "Shared a post" : "Shared";
  const payload = (a.payload ?? {}) as Record<string, unknown>;
  const linkOut = typeof payload.url === "string" ? payload.url : typeof payload.permalink === "string" ? payload.permalink : null;
  const tile = own ? "bg-on-accent/10" : "bg-surface-2";

  if (dead || !url) {
    return <div className={`mt-1 rounded-lg px-2.5 py-2 text-[11px] ${tile} ${own ? "opacity-80" : "text-muted"}`}>{a.type === "share" ? shareLabel : `${a.type} unavailable`}{a.filename ? ` · ${a.filename}` : ""}</div>;
  }
  if (a.type === "image" || a.type === "sticker") {
    return <img src={imgSrc(url)} alt={a.filename ?? "image"} onError={refresh}
      className={`mt-1 rounded-xl object-cover bg-surface-3 ${a.type === "sticker" ? "w-24 h-24" : "max-w-[260px] max-h-[320px]"}`} />;
  }
  if (a.type === "video") {
    return <video src={videoSrc(url)} poster={a.previewUrl ? imgSrc(a.previewUrl) : undefined} controls preload="metadata" onError={refresh}
      className="mt-1 rounded-xl max-w-[260px] max-h-[320px] bg-surface-3" />;
  }
  if (a.type === "audio") {
    return (
      <div className={`mt-1 flex items-center gap-2 rounded-xl px-2.5 py-2 ${tile}`}>
        <span className="text-sm">🎙️</span>
        <audio src={videoSrc(url)} controls preload="metadata" onError={refresh} className="h-8 max-w-[220px]" />
      </div>
    );
  }
  if (a.type === "share") {
    return (
      <a href={linkOut ?? url} target="_blank" rel="noopener noreferrer" className={`mt-1 flex items-center gap-2.5 rounded-xl p-2 ${tile} hover:opacity-90`}>
        {(a.previewUrl || a.url) && <img src={imgSrc(a.previewUrl || a.url!)} alt="" onError={refresh} className="w-14 h-14 rounded-lg object-cover bg-surface-3 flex-shrink-0" />}
        <span className="min-w-0 text-xs">
          <span className="block font-semibold">{shareLabel}</span>
          <span className={`block truncate ${own ? "opacity-70" : "text-muted"}`}>{hostOf(linkOut ?? url)}</span>
        </span>
      </a>
    );
  }
  if (a.type === "template") {
    const title = typeof payload.title === "string" ? payload.title : "Message";
    const subtitle = typeof payload.subtitle === "string" ? payload.subtitle : null;
    return <div className={`mt-1 rounded-xl px-2.5 py-2 text-xs ${tile}`}><span className="block font-semibold">{title}</span>{subtitle && <span className="block opacity-80">{subtitle}</span>}</div>;
  }
  return <a href={url} target="_blank" rel="noopener noreferrer" className={`mt-1 flex items-center gap-2 rounded-xl px-2.5 py-2 text-xs ${tile}`}>📎 <span className="truncate">{a.filename ?? "file"}</span></a>;
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
  const [showUnidentified, setShowUnidentified] = useState(false); // inbox list only; the pipeline still tracks them
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const refreshTimer   = useRef<ReturnType<typeof setInterval> | null>(null);
  const listRef        = useRef<HTMLDivElement>(null);
  const scrollToBottomRef = useRef<"instant" | "smooth" | null>(null);
  const [olderCursor, setOlderCursor]     = useState<string | null>(null);
  const [hasOlder, setHasOlder]           = useState(false);
  const [loadingOlder, setLoadingOlder]   = useState(false);
  const [inboxTruncated, setInboxTruncated] = useState(false);
  const [attaching, setAttaching]         = useState(false);
  const attachRef      = useRef<HTMLInputElement>(null);

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
          name: c.participantName ?? "Instagram User",
          unidentified: !c.participantName || String(c.participantName).trim() === "Instagram User",
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

  // Attach an image/video: upload to R2 through the existing presign route, then send the
  // public URL via Zernio's attachmentUrl/attachmentType (both live on the send route).
  async function sendAttachment(file: File) {
    if (!selectedConv || !selectedClientId) return;
    const type: "image" | "video" | null = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : null;
    if (!type) { alert("Only images and videos can be sent here."); return; }
    setAttaching(true);
    try {
      const pre = await fetch("/api/r2/presign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: file.name, contentType: file.type }) }).then((r) => r.json());
      if (!pre?.uploadUrl) throw new Error(pre?.error || "Could not start upload");
      const put = await fetch(pre.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      const res = await fetch(`/api/zernio/conversations/${selectedConv.id}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: selectedClientId, message: replyText.trim() || undefined, attachmentUrl: pre.publicUrl, attachmentType: type, recipientName: selectedConv.name, recipientHandle: selectedConv.handle || null }),
      });
      const data = await res.json();
      if (!res.ok || data?.error) throw new Error(data?.error || data?.message || "Send failed");
      setReplyText("");
      scrollToBottomRef.current = "smooth";
      setTimeout(() => pollMessages(selectedConv), 1500);
    } catch (e) {
      alert(String(e instanceof Error ? e.message : e));
    } finally {
      setAttaching(false);
    }
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

  const unidentifiedCount = conversations.filter((c) => c.unidentified).length;
  const unidentifiedWithId = conversations.filter((c) => c.unidentified && !!c.igId).length;
  const filteredConvs = conversations.filter((c) =>
    (showUnidentified || !c.unidentified) &&
    (!search || c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.handle && c.handle.toLowerCase().includes(search.toLowerCase())))
  );

  if (!selectedClientId) {
    return <div className={`flex items-center justify-center text-faint text-sm ${view === "inbox" ? "h-full" : "h-64"}`}>Select a client</div>;
  }

  return (
    <div className={view === "inbox" ? "flex flex-col flex-1 min-h-0 h-full" : "flex flex-col flex-1 min-h-0 gap-4"}>
      {/* Header — pipeline only. The inbox is full-bleed: the sidebar already names the page and
          the client, so the chat gets that space. */}
      {view === "pipeline" && (
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-ink">DM Pipeline</h1>
            <p className="text-muted mt-0.5 text-sm">{client?.name}</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => { setEditLead(null); setShowAdd(true); }}
              className="bg-accent text-on-accent px-4 py-2 rounded-lg text-sm font-medium hover:bg-accent-strong">
              + Add Lead
            </button>
          </div>
        </div>
      )}

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

      {/* ── INBOX VIEW (Beeper-style) ─────────────────────────────────────── */}
      {view === "inbox" && (
        <div className="bg-surface overflow-hidden flex-1 min-h-0 h-full">
          <div className="flex h-full">
            {/* Left: conversation list */}
            <div className="w-80 flex-shrink-0 border-r border-line flex flex-col bg-surface">
              <div className="px-3 pt-3 pb-2 flex items-center gap-2">
                <div className="flex-1 flex items-center gap-2 bg-surface-2 border border-line rounded-lg px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-accent/40">
                  <span className="text-faint text-xs">⌕</span>
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search"
                    className="flex-1 min-w-0 bg-transparent text-sm text-ink placeholder:text-faint focus:outline-none" />
                </div>
                <button onClick={loadInbox} disabled={inboxLoading} title="Refresh"
                  className="w-8 h-8 rounded-lg text-faint hover:text-ink hover:bg-surface-2 transition-colors disabled:opacity-40 text-sm">{inboxLoading ? "…" : "↻"}</button>
              </div>
              {unidentifiedCount > 0 && (
                <div className="px-3 pb-1.5 flex items-center justify-between gap-2">
                  <span className="text-[10px] text-faint truncate"
                    title={`Threads where Meta did not resolve the sender (story replies, reactions). ${unidentifiedWithId} of them carry a participantId. The DM Pipeline still tracks them.`}>
                    {showUnidentified ? `${unidentifiedCount} unidentified shown` : `${unidentifiedCount} unidentified hidden`}
                  </span>
                  <button onClick={() => setShowUnidentified((v) => !v)}
                    className="text-[10px] font-semibold text-accent hover:text-accent-strong flex-shrink-0">{showUnidentified ? "Hide" : "Show"}</button>
                </div>
              )}

              <div className="flex-1 overflow-y-auto px-1.5 pb-2">
                {inboxError ? (
                  <div className="p-6 text-center space-y-2">
                    {inboxError === "no_zernio_account" ? (
                      <>
                        <p className="text-3xl mb-2">🔌</p>
                        <p className="text-sm font-semibold text-ink-2">Instagram DMs not connected</p>
                        <p className="text-[11px] text-faint leading-relaxed max-w-[200px] mx-auto mt-1">Connect this client&apos;s Instagram account in Settings to enable the inbox.</p>
                        <button onClick={onGoToSettings} className="mt-3 px-4 py-2 text-xs font-semibold bg-accent text-on-accent rounded-lg hover:bg-accent-strong">Go to Settings →</button>
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
                  <div className="p-8 text-center text-faint text-xs">{search ? "No matches" : unidentifiedCount > 0 ? "Only unidentified conversations — use Show above" : "No conversations yet"}</div>
                ) : (
                  <>
                    {filteredConvs.map((conv) => {
                      const active = selectedConv?.id === conv.id;
                      const unread = (conv.unreadCount ?? 0) > 0;
                      return (
                        <button key={conv.id} onClick={() => setSelectedConv(conv)}
                          className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left transition-colors ${active ? "bg-surface-2 shadow-soft" : "hover:bg-surface-2/60"}`}>
                          <Avatar src={conv.avatar} name={conv.name} className="w-9 h-9 text-[13px] flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline justify-between gap-2">
                              <p className={`text-[13px] truncate ${unread ? "font-semibold text-ink" : "font-medium text-ink"}`}>{conv.name}</p>
                              <span className={`text-[10px] flex-shrink-0 ${unread ? "text-accent font-semibold" : "text-faint"}`}>{timeAgo(conv.updatedTime)}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <p className={`text-xs truncate ${unread ? "text-ink-2" : "text-muted"}`}>{conv.snippet || (conv.handle ? `@${conv.handle}` : "\u00a0")}</p>
                              {unread && <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-on-accent text-[10px] font-bold flex items-center justify-center flex-shrink-0">{conv.unreadCount}</span>}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                    {inboxTruncated && <p className="px-3 py-2 text-[10px] text-faint text-center">Showing the first 2,000 conversations.</p>}
                  </>
                )}
              </div>
            </div>

            {/* Right: thread */}
            {!selectedConv ? (
              <div className="flex-1 flex items-center justify-center text-faint text-sm bg-canvas-2">
                <div className="text-center space-y-1.5">
                  <div className="text-3xl">💬</div>
                  <p className="font-medium text-ink-2">Select a conversation</p>
                  <p className="text-xs text-faint">{conversations.length ? `${conversations.length} conversations` : ""}</p>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col min-w-0 bg-canvas-2">
                {/* Header */}
                <div className="px-4 py-2.5 border-b border-line flex items-center justify-between flex-shrink-0 bg-surface">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar src={selectedConv.avatar} name={selectedConv.name} className="w-8 h-8 text-xs" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink truncate">{selectedConv.name}</p>
                      {selectedConv.handle && <p className="text-[11px] text-faint truncate">@{selectedConv.handle}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedConv.url && (
                      <a href={selectedConv.url} target="_blank" rel="noopener noreferrer" className="px-2.5 py-1.5 text-xs font-medium text-muted hover:text-ink hover:bg-surface-2 rounded-lg">Open on Instagram ↗</a>
                    )}
                    <button onClick={() => addToPipeline(selectedConv)}
                      className="px-3 py-1.5 bg-accent-tint text-accent-strong text-xs font-semibold rounded-lg hover:bg-accent-tint/80">+ Add to Pipeline</button>
                  </div>
                </div>

                {/* Messages */}
                <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3"
                  onScroll={(e) => { if (e.currentTarget.scrollTop < 40 && selectedConv) loadOlder(selectedConv); }}>
                  <div className="flex flex-col min-h-full justify-end">
                    {loadingOlder && <div className="text-center text-faint text-[11px] py-1">Loading older…</div>}
                    {!loadingOlder && !hasOlder && messages.length > 0 && <div className="text-center text-faint text-[10px] py-1">Beginning of conversation</div>}
                    {messagesLoading && messages.length === 0 ? (
                      <div className="text-center text-faint text-xs">Loading messages…</div>
                    ) : messages.length === 0 ? (
                      <div className="text-center text-faint text-xs">No messages yet</div>
                    ) : (
                      messages.map((msg, i) => {
                        const prev = messages[i - 1], next = messages[i + 1];
                        const newDay = !prev || !isSameDay(new Date(prev.createdTime), new Date(msg.createdTime));
                        const GAP = 5 * 60 * 1000;
                        const startsRun = newDay || !prev || prev.isOwn !== msg.isOwn || new Date(msg.createdTime).getTime() - new Date(prev.createdTime).getTime() > GAP;
                        const endsRun = !next || next.isOwn !== msg.isOwn || !isSameDay(new Date(next.createdTime), new Date(msg.createdTime)) || new Date(next.createdTime).getTime() - new Date(msg.createdTime).getTime() > GAP;
                        const own = msg.isOwn;
                        const radius = own
                          ? `rounded-2xl ${startsRun ? "" : "rounded-tr-md"} ${endsRun ? "" : "rounded-br-md"}`
                          : `rounded-2xl ${startsRun ? "" : "rounded-tl-md"} ${endsRun ? "" : "rounded-bl-md"}`;
                        return (
                          <div key={msg.id}>
                            {newDay && (
                              <div className="flex justify-center my-3">
                                <span className="text-[10px] font-medium text-faint bg-surface-2 border border-line-soft rounded-full px-2.5 py-0.5">{dayLabel(msg.createdTime)}</span>
                              </div>
                            )}
                            <div className={`flex ${own ? "justify-end" : "justify-start"} ${startsRun ? "mt-2" : "mt-0.5"}`}>
                              <div className={`max-w-[68%] px-3 py-2 text-sm leading-snug ${radius} ${own ? "bg-accent text-on-accent" : "bg-surface-3 text-ink"} ${msg.id.startsWith("opt-") ? "opacity-70" : ""}`}>
                                {(msg.storyReply || msg.isStoryMention) && <p className={`text-[10px] mb-0.5 ${own ? "opacity-70" : "text-muted"}`}>{msg.isStoryMention ? "Mentioned you in a story" : "Replied to a story"}</p>}
                                {msg.isDeleted ? (
                                  <p className="italic opacity-70 text-xs">Message deleted</p>
                                ) : (
                                  <>
                                    {msg.attachments.map((a) => <AttachmentView key={`${msg.id}-${a.index}`} a={a} msg={msg} convId={selectedConv.id} clientId={selectedClientId} own={own} />)}
                                    {msg.text && <MessageText text={msg.text} own={own} />}
                                  </>
                                )}
                                <span className={`inline-block float-right ml-2 mt-1 text-[10px] leading-none ${own ? "opacity-70" : "text-faint"}`}>{hhmm(msg.createdTime)}{own && msg.deliveryStatus === "read" ? " · read" : ""}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                </div>

                {/* Composer */}
                <div className="px-3 py-2.5 border-t border-line flex-shrink-0 bg-surface">
                  <div className="flex items-end gap-2">
                    <input ref={attachRef} type="file" accept="image/*,video/*" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) sendAttachment(f); e.currentTarget.value = ""; }} />
                    <button onClick={() => attachRef.current?.click()} disabled={attaching || sending} title="Send a photo or video"
                      className="w-9 h-9 rounded-full flex items-center justify-center text-faint hover:text-ink hover:bg-surface-2 disabled:opacity-40 flex-shrink-0 text-lg leading-none">{attaching ? "…" : "＋"}</button>
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
                      placeholder={`Message ${selectedConv.name}`}
                      rows={1}
                      className="flex-1 bg-surface-2 border border-line rounded-2xl px-4 py-2 text-sm text-ink placeholder:text-faint resize-none max-h-32 focus:outline-none focus:ring-2 focus:ring-accent/40"
                      style={{ minHeight: 38 }}
                    />
                    <button onClick={sendReply} disabled={!replyText.trim() || sending} title="Send (Enter)"
                      className="w-9 h-9 rounded-full bg-accent text-on-accent flex items-center justify-center hover:bg-accent-strong disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0 text-base leading-none">{sending ? "…" : "↑"}</button>
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
