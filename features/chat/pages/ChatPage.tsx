"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Client, Message, Concept, TrackedVideo, TeamMember } from "@/shared/types";
import PushToggle from "@/shared/ui/PushToggle";

type ReelContext = {
  id?: number;
  title: string;
  hook?: string | null;
  script: string;
  caption?: string | null;
  channel?: string;
};

type ReelRef = {
  id?: number;
  title: string;
  hook?: string | null;
  script?: string | null;
  caption?: string | null;
};

type Props = {
  clients: Client[];
  selectedClientId: number | null;
  isOwnerSession?: boolean;
  ownerName?: string;
  clientName?: string;
  reelContext?: ReelContext | null;
  onContextUsed?: () => void;
  team?: TeamMember[];
  initialChannel?: string;
  activeProfile?: TeamMember | null; // set when a team member (not client, not owner) is logged in
};

type MentionItem = {
  type: "concept" | "video";
  id: number;
  label: string;
  sub?: string;
};

export default function ChatPage({ clients, selectedClientId, isOwnerSession = false, ownerName = "Cenk", clientName, reelContext, onContextUsed, team = [], initialChannel, activeProfile }: Props) {
  // Any logged-in member is locked to their OWN thread with the owner: a client
  // to the "client" channel, an editor/teammate to their member channel. Only the
  // owner (no activeProfile) sees every conversation.
  const memberChannel = activeProfile
    ? (activeProfile.isClientAccount ? "client" : `member:${activeProfile.id}`)
    : null;
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [videos, setVideos] = useState<TrackedVideo[]>([]);
  const [mention, setMention] = useState<{ query: string; pos: number } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [activeReel, setActiveReel] = useState<ReelContext | null>(null);
  const [reelModal, setReelModal] = useState<ReelRef | null>(null);
  const [reelModalFull, setReelModalFull] = useState<ReelRef | null>(null);
  const [rawExpanded, setRawExpanded] = useState(false);
  const [activeChannel, setActiveChannel] = useState<string>(memberChannel ?? initialChannel ?? "client");
  // Per-channel latest message (for unread badges + WhatsApp-style ordering)
  const [summary, setSummary] = useState<Record<string, { lastAt: string; lastAuthor: string; lastContent: string }>>({});
  const [lastRead, setLastRead] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Author strings that count as "me" (so my own latest message isn't unread).
  const myAuthors = isOwnerSession ? ["owner", ownerName] : [clientName ?? "client"];
  function isUnread(channel: string): boolean {
    const s = summary[channel];
    if (!s || channel === activeChannel) return false;
    if (myAuthors.includes(s.lastAuthor)) return false;
    const read = lastRead[channel];
    return !read || new Date(s.lastAt).getTime() > new Date(read).getTime();
  }

  const client = clients.find((c) => c.id === selectedClientId) ?? null;

  // Sidebar conversation list
  // "client" = client chat, "member:{id}" = team member chat
  const conversations: { channel: string; label: string; color: string; initial: string; isClient?: boolean }[] = [
    {
      channel: "client",
      label: client ? `${client.name} (client)` : "Client",
      color: client?.color ?? "#6366f1",
      initial: client ? client.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase() : "C",
      isClient: true,
    },
    ...team
      .filter((m) => !m.isClientAccount)
      .map((m) => ({
        channel: `member:${m.id}`,
        label: m.name + (m.role ? ` (${m.role})` : ""),
        color: m.color,
        initial: m.name[0]?.toUpperCase() ?? "?",
      })),
  ];

  useEffect(() => {
    // Team members are always locked to their own channel — never override
    if (memberChannel) return;
    if (initialChannel) setActiveChannel(initialChannel);
  }, [initialChannel, memberChannel]);

  useEffect(() => {
    if (reelContext) {
      setActiveReel(reelContext);
      if (reelContext.channel) setActiveChannel(reelContext.channel);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [reelContext]);

  useEffect(() => {
    setRawExpanded(false);
    if (!reelModal) { setReelModalFull(null); return; }
    if (reelModal.id) {
      fetch(`/api/script-drafts?id=${reelModal.id}`)
        .then((r) => r.json())
        .then((d) => d && setReelModalFull(d));
    } else {
      setReelModalFull(reelModal);
    }
  }, [reelModal]);

  const fetchMessages = useCallback(async () => {
    if (!selectedClientId) return;
    const data = await fetch(`/api/messages?clientId=${selectedClientId}&channel=${encodeURIComponent(activeChannel)}`).then((r) => r.json());
    setMessages(data);
  }, [selectedClientId, activeChannel]);

  useEffect(() => {
    if (!selectedClientId) return;
    fetchMessages();
    fetch(`/api/concepts?clientId=${selectedClientId}`).then((r) => r.json()).then(setConcepts);
    fetch(`/api/videos?clientId=${selectedClientId}`).then((r) => r.json()).then(setVideos);
  }, [selectedClientId, fetchMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Load last-read marks for this client (per-channel), and refresh on client switch.
  useEffect(() => {
    if (!selectedClientId) return;
    try { setLastRead(JSON.parse(localStorage.getItem(`cf_chat_read_${selectedClientId}`) || "{}")); }
    catch { setLastRead({}); }
  }, [selectedClientId]);

  const fetchSummary = useCallback(async () => {
    if (!selectedClientId) return;
    const data = await fetch(`/api/messages?clientId=${selectedClientId}&summary=1`).then((r) => r.json()).catch(() => []);
    const map: Record<string, { lastAt: string; lastAuthor: string; lastContent: string }> = {};
    for (const s of (Array.isArray(data) ? data : [])) map[s.channel] = { lastAt: s.lastAt, lastAuthor: s.lastAuthor, lastContent: s.lastContent };
    setSummary(map);
  }, [selectedClientId]);

  // Poll the summary (and the open conversation) so unread badges update live.
  useEffect(() => {
    fetchSummary();
    const i = setInterval(() => { fetchSummary(); fetchMessages(); }, 15000);
    return () => clearInterval(i);
  }, [fetchSummary, fetchMessages]);

  // Opening a conversation (or new messages arriving while it's open) marks it read.
  useEffect(() => {
    if (!activeChannel || !selectedClientId) return;
    setLastRead((prev) => {
      const next = { ...prev, [activeChannel]: new Date().toISOString() };
      localStorage.setItem(`cf_chat_read_${selectedClientId}`, JSON.stringify(next));
      return next;
    });
  }, [activeChannel, messages, selectedClientId]);

  const mentionItems: MentionItem[] = [
    ...concepts.filter((c) => !c.isIdea).map((c) => ({ type: "concept" as const, id: c.id, label: c.name, sub: "Concept" })),
    ...videos.map((v) => ({ type: "video" as const, id: v.id, label: v.title, sub: "Video" })),
  ];

  const filteredMentions = mention
    ? mentionItems.filter((m) => m.label.toLowerCase().includes(mention.query.toLowerCase()))
    : [];

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setDraft(val);
    const cursor = e.target.selectionStart ?? val.length;
    const before = val.slice(0, cursor);
    const atMatch = before.match(/@(\w*)$/);
    if (atMatch) {
      setMention({ query: atMatch[1], pos: cursor - atMatch[0].length });
      setMentionIndex(0);
    } else {
      setMention(null);
    }
  }

  function applyMention(item: MentionItem) {
    if (!mention) return;
    const tag = `@[${item.label}](${item.type}:${item.id})`;
    const before = draft.slice(0, mention.pos);
    const cursor = inputRef.current?.selectionStart ?? draft.length;
    const after = draft.slice(cursor);
    const newDraft = before + tag + " " + after;
    setDraft(newDraft);
    setMention(null);
    setTimeout(() => {
      inputRef.current?.focus();
      const pos = (before + tag + " ").length;
      inputRef.current?.setSelectionRange(pos, pos);
    }, 0);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mention && filteredMentions.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex((i) => Math.min(i + 1, filteredMentions.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMentionIndex((i) => Math.max(i - 1, 0)); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); applyMention(filteredMentions[mentionIndex]); return; }
      if (e.key === "Escape") { setMention(null); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  async function sendMessage() {
    const content = draft.trim();
    if (!content || !selectedClientId) return;
    const reel = activeReel;
    setDraft("");
    setMention(null);
    setActiveReel(null);
    onContextUsed?.();
    const fullContent = reel
      ? `__REEL__${JSON.stringify({ id: reel.id, title: reel.title, hook: reel.hook, script: reel.script, caption: reel.caption })}__END__${content}`
      : content;

    // Determine author name for this channel
    let author = "owner";
    if (!isOwnerSession) {
      author = clientName ?? "client";
    } else if (activeChannel.startsWith("member:")) {
      author = ownerName;
    }

    await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: selectedClientId, content: fullContent, author, channel: activeChannel }),
    });
    fetchMessages();
  }

  async function deleteMessage(id: number) {
    await fetch(`/api/messages?id=${id}`, { method: "DELETE" });
    fetchMessages();
  }

  function renderContent(content: string, isOwnerBubble: boolean) {
    let reelRef: ReelRef | null = null;
    let text = content;
    const reelMatch = content.match(/^__REEL__(.+?)__END__([\s\S]*)$/);
    if (reelMatch) {
      try { reelRef = JSON.parse(reelMatch[1]); } catch {}
      text = reelMatch[2];
    }

    const parts = text.split(/(@\[([^\]]+)\]\([^)]+\))/g).map((part, i) => {
      const match = part.match(/^@\[([^\]]+)\]\(([^)]+)\)$/);
      if (match) {
        const [, label, ref] = match;
        const isVideo = ref.startsWith("video:");
        return (
          <span key={i} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${isVideo ? "bg-amber-100 text-amber-700" : "bg-accent-tint text-accent-strong"}`}>
            {isVideo ? "🎬" : "💡"} {label}
          </span>
        );
      }
      return <span key={i}>{part}</span>;
    });

    return (
      <>
        {reelRef && (
          <button
            onClick={() => setReelModal(reelRef)}
            className={`w-full text-left rounded-xl mb-2 p-2.5 flex items-start gap-2 transition-opacity hover:opacity-80 ${isOwnerBubble ? "bg-accent-strong/60" : "bg-accent-tint border border-accent-tint"}`}
          >
            <span className="text-base flex-shrink-0">🎬</span>
            <div className="min-w-0">
              <p className={`text-[10px] font-bold uppercase tracking-wide leading-none mb-1 ${isOwnerBubble ? "text-accent-tint" : "text-accent"}`}>Reel</p>
              <p className={`text-xs font-semibold truncate ${isOwnerBubble ? "text-white" : "text-ink-2"}`}>{reelRef.title}</p>
              {reelRef.hook && <p className={`text-[11px] truncate mt-0.5 ${isOwnerBubble ? "text-accent-tint" : "text-accent"}`}>{reelRef.hook}</p>}
            </div>
          </button>
        )}
        {parts}
      </>
    );
  }

  const activeConv = conversations.find((c) => c.channel === activeChannel) ?? conversations[0];

  function renderChatArea() {
    return (
      <>
        {/* Messages */}
        <div className="flex-1 overflow-y-auto bg-white rounded-2xl border border-line p-4 space-y-3 min-h-0">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="text-3xl mb-2">💬</div>
              <p className="text-sm text-faint">No messages yet. Start the conversation.</p>
              <p className="text-xs text-faint mt-1">Type @ to tag a concept or video</p>
            </div>
          ) : (
            messages.map((msg) => {
              const isOwnerMsg = msg.author === "owner" || msg.author === ownerName;
              const isMe = isOwnerSession ? isOwnerMsg : !isOwnerMsg;
              const displayName = isOwnerMsg
                ? ownerName
                : activeChannel === "client"
                  ? (clientName ?? client!.name)
                  : msg.author;
              const initial = displayName[0]?.toUpperCase() ?? "?";
              return (
                <div key={msg.id} className={`flex gap-2 group ${isMe ? "justify-start" : "justify-end"}`}>
                  {isMe && (
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 mt-0.5"
                      style={{ backgroundColor: isOwnerSession ? "#6366f1" : (activeConv?.color ?? "#6366f1") }}
                    >
                      {isOwnerSession ? ownerName[0]?.toUpperCase() : (clientName?.[0]?.toUpperCase() ?? "C")}
                    </div>
                  )}
                  <div className={`max-w-[72%] ${isMe ? "items-start" : "items-end"} flex flex-col gap-0.5`}>
                    {!isMe && (
                      <span className="text-[10px] text-faint px-1">{displayName}</span>
                    )}
                    <div className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${isMe ? "text-white rounded-bl-sm" : "bg-slate-100 text-ink rounded-br-sm"}`}
                      style={isMe ? { backgroundColor: "#6366f1" } : {}}>
                      {renderContent(msg.content, isOwnerMsg)}
                    </div>
                    <div className={`flex items-center gap-2 px-1 ${!isMe ? "flex-row-reverse" : ""}`}>
                      <span className="text-[10px] text-faint">
                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <button
                        onClick={() => deleteMessage(msg.id)}
                        className="text-[10px] text-faint hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        delete
                      </button>
                    </div>
                  </div>
                  {!isMe && (
                    <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-muted flex-shrink-0 mt-0.5">
                      {initial}
                    </div>
                  )}
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="mt-3 flex-shrink-0 relative">
          {mention && filteredMentions.length > 0 && (
            <div className="absolute bottom-full left-0 right-0 mb-1 bg-white border border-line rounded-xl o-elev-lift overflow-hidden z-50 max-h-52 overflow-y-auto">
              <div className="px-3 py-1.5 border-b border-line">
                <p className="text-[10px] font-semibold text-faint uppercase tracking-wide">Tag a concept or video</p>
              </div>
              {filteredMentions.map((item, i) => (
                <button
                  key={`${item.type}-${item.id}`}
                  onMouseDown={(e) => { e.preventDefault(); applyMention(item); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-slate-50 transition-colors ${i === mentionIndex ? "bg-accent-tint" : ""}`}
                >
                  <span className="text-base">{item.type === "video" ? "🎬" : "💡"}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-ink-2 font-medium truncate">{item.label}</p>
                    <p className="text-[10px] text-faint capitalize">{item.sub}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
          <div className="bg-white border border-line rounded-2xl focus-within:ring-2 focus-within:ring-accent focus-within:border-transparent overflow-hidden">
            {activeReel && (
              <div className="flex items-center gap-2 px-3 pt-2.5 pb-2 border-b border-line">
                <div className="w-0.5 h-8 bg-accent rounded-full flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-semibold text-accent uppercase tracking-wide leading-none mb-0.5">Replying to reel</p>
                  <p className="text-xs text-ink-2 font-medium truncate">{activeReel.title}</p>
                  {activeReel.hook && <p className="text-[11px] text-faint truncate">{activeReel.hook}</p>}
                </div>
                <button
                  onMouseDown={(e) => { e.preventDefault(); setActiveReel(null); onContextUsed?.(); }}
                  className="text-faint hover:text-muted transition-colors flex-shrink-0 p-0.5"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}
            <div className="flex items-end gap-2 px-3 py-2.5">
              <textarea
                ref={inputRef}
                value={draft}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                placeholder={memberChannel ? `Message ${ownerName}…` : `Message ${activeConv?.label ?? ""}… (@ to tag, Enter to send)`}
                rows={1}
                className="flex-1 text-sm text-ink placeholder-slate-400 resize-none focus:outline-none bg-transparent leading-relaxed"
                style={{ maxHeight: "120px" }}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = Math.min(el.scrollHeight, 120) + "px";
                }}
              />
              <button
                onClick={sendMessage}
                disabled={!draft.trim()}
                className="w-8 h-8 flex items-center justify-center rounded-xl bg-accent text-white hover:bg-accent-strong disabled:opacity-30 disabled:cursor-not-allowed transition-opacity flex-shrink-0"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (!client) {
    return (
      <div className="flex items-center justify-center h-64 text-faint text-sm">
        Select a client to view chat
      </div>
    );
  }

  // Reel detail modal — shared by the owner view AND the client/editor view so a
  // tagged reel opens for everyone (it previously only existed in the owner return).
  function renderReelModal() {
    if (!reelModal) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setReelModal(null)}>
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
        <div className="relative bg-white rounded-2xl o-elev-pop w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
          <div className="px-5 py-4 border-b border-line flex-shrink-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold text-accent uppercase tracking-wide mb-0.5">
                  {(reelModalFull as any)?.concept ? ((reelModalFull as any).concept.conceptType ? `${(reelModalFull as any).concept.conceptType} · ${(reelModalFull as any).concept.name}` : (reelModalFull as any).concept.name) : "Reel"}
                </p>
                <p className="text-base font-bold text-ink">{reelModal.title}</p>
                {(reelModalFull as any)?.weekLabel && (
                  <p className="text-xs text-faint mt-0.5">{(reelModalFull as any).weekLabel}</p>
                )}
              </div>
              <button onClick={() => setReelModal(null)} className="text-faint hover:text-ink-2 transition-colors flex-shrink-0 mt-0.5">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          {!reelModalFull ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="overflow-y-auto p-5 space-y-5">
              {(() => {
                const f = reelModalFull as any;
                let raws: string[] = [];
                try { raws = JSON.parse(f.rawContentUrls || "[]"); } catch { raws = []; }
                if (f.rawContentUrl && !raws.includes(f.rawContentUrl)) raws = [f.rawContentUrl, ...raws];
                raws = raws.filter(Boolean);
                return (
                  <>
                    {f.editedVideoUrl && (
                      <div>
                        <p className="text-[10px] font-semibold text-faint uppercase tracking-widest mb-2">Finished Video</p>
                        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                        <video src={f.editedVideoUrl} controls playsInline className="w-full max-h-[55vh] rounded-xl bg-black object-contain" />
                        <a href={f.editedVideoUrl} target="_blank" rel="noopener noreferrer" className="inline-block text-[11px] text-accent hover:text-accent-strong mt-1.5">Open / download ↗</a>
                      </div>
                    )}
                    {f.exampleVideoUrl && (
                      <div>
                        <p className="text-[10px] font-semibold text-faint uppercase tracking-widest mb-2">Example Video</p>
                        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                        <video src={f.exampleVideoUrl} controls playsInline className="w-full max-h-[45vh] rounded-xl bg-black object-contain" />
                      </div>
                    )}
                    {raws.length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold text-faint uppercase tracking-widest mb-2">Raw Content</p>
                        <button onClick={() => setRawExpanded((v) => !v)}
                          className="w-full flex items-center justify-between gap-2 border border-line rounded-xl px-3.5 py-3 text-sm font-semibold text-ink-2 bg-slate-50 hover:bg-slate-100 transition-colors">
                          <span>📎 {raws.length} file{raws.length > 1 ? "s" : ""} uploaded</span>
                          <span className="text-accent text-xs font-semibold">{rawExpanded ? "▲ Collapse" : "▼ Expand"}</span>
                        </button>
                        {rawExpanded && (
                          <div className="space-y-2 mt-2">
                            {raws.map((u, i) => (
                              // eslint-disable-next-line jsx-a11y/media-has-caption
                              <video key={i} src={u} controls playsInline preload="metadata" className="w-full max-h-[45vh] rounded-xl bg-black object-contain" />
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                );
              })()}
              {reelModalFull.hook && (
                <div>
                  <p className="text-[10px] font-semibold text-faint uppercase tracking-widest mb-2">Text Hook</p>
                  <div className="border border-line rounded-xl px-3.5 py-3 text-sm text-ink-2 leading-relaxed bg-slate-50">
                    {reelModalFull.hook}
                  </div>
                </div>
              )}
              {reelModalFull.script && (
                <div>
                  <p className="text-[10px] font-semibold text-faint uppercase tracking-widest mb-2">Script</p>
                  <div className="border border-line rounded-xl px-3.5 py-3 text-sm text-ink-2 leading-relaxed whitespace-pre-wrap bg-slate-50 font-mono">
                    {reelModalFull.script}
                  </div>
                  <p className="text-[10px] text-faint mt-1.5">
                    {reelModalFull.script.split(/\s+/).filter(Boolean).length} words
                  </p>
                </div>
              )}
              {reelModalFull.caption && (
                <div>
                  <p className="text-[10px] font-semibold text-faint uppercase tracking-widest mb-2">Caption</p>
                  <div className="border border-line rounded-xl px-3.5 py-3 text-sm text-muted leading-relaxed bg-slate-50">
                    {reelModalFull.caption}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Editor/team member view: no sidebar, locked to their own channel with owner
  if (memberChannel) {
    return (
      <div className="flex flex-col h-[calc(100vh-4rem)] max-h-[calc(100vh-4rem)]">
        <div className="flex items-center gap-3 mb-4 flex-shrink-0">
          <div className="w-8 h-8 rounded-xl bg-accent flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
            {ownerName[0]?.toUpperCase()}
          </div>
          <div>
            <h1 className="text-lg font-bold text-ink">{ownerName}</h1>
            <p className="text-xs text-faint">use @ to tag concepts or videos</p>
          </div>
          <div className="ml-auto"><PushToggle /></div>
        </div>
        {renderChatArea()}
        {renderReelModal()}
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] max-h-[calc(100vh-4rem)] gap-0 -mx-8 px-0">
      {/* Sidebar */}
      <div className="w-56 flex-shrink-0 border-r border-line flex flex-col bg-slate-50 rounded-l-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-line">
          <p className="text-[10px] font-semibold text-faint uppercase tracking-widest">Conversations</p>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {[...conversations]
            // Members only ever see their own thread; the owner sees all.
            .filter((c) => !memberChannel || c.channel === memberChannel)
            .sort((a, b) => (summary[b.channel]?.lastAt ?? "").localeCompare(summary[a.channel]?.lastAt ?? ""))
            .map((conv) => {
            const isActive = conv.channel === activeChannel;
            const unread = isUnread(conv.channel);
            return (
              <button
                key={conv.channel}
                onClick={() => setActiveChannel(conv.channel)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${isActive ? "bg-accent-tint border-r-2 border-accent" : "hover:bg-slate-100"}`}
              >
                <div
                  className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-[11px] font-bold text-white"
                  style={{ backgroundColor: conv.color }}
                >
                  {conv.initial}
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-xs truncate ${unread ? "font-bold text-ink" : isActive ? "font-medium text-accent-strong" : "font-medium text-ink-2"}`}>
                    {conv.label}
                  </p>
                  {conv.isClient && !unread && (
                    <p className="text-[10px] text-faint">Client</p>
                  )}
                  {unread && (
                    <p className="text-[10px] text-muted truncate">{summary[conv.channel]?.lastContent?.replace(/^__REEL__.*__END__/, "🎬 ") || "New message"}</p>
                  )}
                </div>
                {unread && <span className="w-2.5 h-2.5 rounded-full bg-accent flex-shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0 pl-6 pr-0">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4 flex-shrink-0">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
            style={{ backgroundColor: activeConv?.color }}
          >
            {activeConv?.initial}
          </div>
          <div>
            <h1 className="text-lg font-bold text-ink">{activeConv?.label}</h1>
            <p className="text-xs text-faint">use @ to tag concepts or videos</p>
          </div>
          <div className="ml-auto"><PushToggle /></div>
        </div>

        {renderChatArea()}
      </div>

      {/* Reel detail modal */}
      {renderReelModal()}
    </div>
  );
}
