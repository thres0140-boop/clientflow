"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Client, Message, Concept, TrackedVideo } from "@/lib/types";

type ReelContext = {
  title: string;
  hook?: string | null;
  script: string;
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
};

type MentionItem = {
  type: "concept" | "video";
  id: number;
  label: string;
  sub?: string;
};

export default function ChatPage({ clients, selectedClientId, isOwnerSession = false, ownerName = "Cenk", clientName, reelContext, onContextUsed }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [videos, setVideos] = useState<TrackedVideo[]>([]);
  const [mention, setMention] = useState<{ query: string; pos: number } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [activeReel, setActiveReel] = useState<ReelContext | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const client = clients.find((c) => c.id === selectedClientId) ?? null;

  useEffect(() => {
    if (reelContext) {
      setActiveReel(reelContext);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [reelContext]);

  const fetchMessages = useCallback(async () => {
    if (!selectedClientId) return;
    const data = await fetch(`/api/messages?clientId=${selectedClientId}`).then((r) => r.json());
    setMessages(data);
  }, [selectedClientId]);

  useEffect(() => {
    if (!selectedClientId) return;
    fetchMessages();
    fetch(`/api/concepts?clientId=${selectedClientId}`).then((r) => r.json()).then(setConcepts);
    fetch(`/api/videos?clientId=${selectedClientId}`).then((r) => r.json()).then(setVideos);
  }, [selectedClientId, fetchMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
    setDraft("");
    setMention(null);
    await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: selectedClientId, content, author: isOwnerSession ? "owner" : (clientName ?? "client") }),
    });
    fetchMessages();
  }

  async function deleteMessage(id: number) {
    await fetch(`/api/messages?id=${id}`, { method: "DELETE" });
    fetchMessages();
  }

  function renderContent(content: string) {
    const parts = content.split(/(@\[([^\]]+)\]\([^)]+\))/g);
    return parts.map((part, i) => {
      const match = part.match(/^@\[([^\]]+)\]\(([^)]+)\)$/);
      if (match) {
        const [, label, ref] = match;
        const isVideo = ref.startsWith("video:");
        return (
          <span key={i} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${isVideo ? "bg-amber-100 text-amber-700" : "bg-indigo-100 text-indigo-700"}`}>
            {isVideo ? "🎬" : "💡"} {label}
          </span>
        );
      }
      return <span key={i}>{part}</span>;
    });
  }

  if (!client) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
        Select a client to view chat
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] max-h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6 flex-shrink-0">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-sm font-bold"
          style={{ backgroundColor: client.color }}>
          {client.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-800">{client.name}</h1>
          <p className="text-xs text-slate-400">Client Chat · use @ to tag concepts or videos</p>
        </div>
      </div>

      {/* Reel context card */}
      {activeReel && (
        <div className="flex-shrink-0 mb-3 bg-indigo-50 border border-indigo-200 rounded-2xl p-3.5 relative">
          <button
            onClick={() => { setActiveReel(null); onContextUsed?.(); }}
            className="absolute top-2.5 right-2.5 text-indigo-300 hover:text-indigo-500 transition-colors"
            title="Dismiss"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
          <div className="flex items-start gap-2.5 pr-6">
            <span className="text-lg mt-0.5">🎬</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-0.5">Discussing reel</p>
              <p className="text-sm font-bold text-slate-800 truncate">{activeReel.title}</p>
              {activeReel.hook && (
                <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                  <span className="font-medium text-slate-600">Hook:</span> {activeReel.hook}
                </p>
              )}
              <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{activeReel.script}</p>
              {activeReel.caption && (
                <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">
                  <span className="font-medium">Caption:</span> {activeReel.caption}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto bg-white rounded-2xl border border-slate-200 p-4 space-y-3 min-h-0">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="text-3xl mb-2">💬</div>
            <p className="text-sm text-slate-400">No messages yet. Start the conversation.</p>
            <p className="text-xs text-slate-300 mt-1">Type @ to tag a concept or video</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isOwnerMsg = msg.author === "owner";
            const isMe = isOwnerSession ? isOwnerMsg : !isOwnerMsg;
            const displayName = isOwnerMsg ? ownerName : (msg.author === "client" ? (clientName ?? "Client") : msg.author);
            const initial = displayName[0]?.toUpperCase() ?? "?";
            return (
              <div key={msg.id} className={`flex gap-2 group ${isMe ? "justify-start" : "justify-end"}`}>
                {isMe && (
                  <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-600 flex-shrink-0 mt-0.5">
                    {isOwnerSession ? ownerName[0]?.toUpperCase() : (clientName?.[0]?.toUpperCase() ?? "C")}
                  </div>
                )}
                <div className={`max-w-[72%] ${isMe ? "items-start" : "items-end"} flex flex-col gap-0.5`}>
                  {!isMe && (
                    <span className="text-[10px] text-slate-400 px-1">{displayName}</span>
                  )}
                  <div className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${isMe ? "bg-indigo-600 text-white rounded-bl-sm" : "bg-slate-100 text-slate-800 rounded-br-sm"}`}>
                    {renderContent(msg.content)}
                  </div>
                  <div className={`flex items-center gap-2 px-1 ${!isMe ? "flex-row-reverse" : ""}`}>
                    <span className="text-[10px] text-slate-300">
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <button
                      onClick={() => deleteMessage(msg.id)}
                      className="text-[10px] text-slate-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      delete
                    </button>
                  </div>
                </div>
                {!isMe && (
                  <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-500 flex-shrink-0 mt-0.5">
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
          <div className="absolute bottom-full left-0 right-0 mb-1 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden z-50 max-h-52 overflow-y-auto">
            <div className="px-3 py-1.5 border-b border-slate-100">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Tag a concept or video</p>
            </div>
            {filteredMentions.map((item, i) => (
              <button
                key={`${item.type}-${item.id}`}
                onMouseDown={(e) => { e.preventDefault(); applyMention(item); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-slate-50 transition-colors ${i === mentionIndex ? "bg-indigo-50" : ""}`}
              >
                <span className="text-base">{item.type === "video" ? "🎬" : "💡"}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-700 font-medium truncate">{item.label}</p>
                  <p className="text-[10px] text-slate-400 capitalize">{item.sub}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-2xl flex items-end gap-2 px-3 py-2.5 focus-within:ring-2 focus-within:ring-indigo-400 focus-within:border-transparent">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Message… (@ to tag, Enter to send)"
            rows={1}
            className="flex-1 text-sm text-slate-800 placeholder-slate-400 resize-none focus:outline-none bg-transparent leading-relaxed"
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
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-30 disabled:cursor-not-allowed transition-opacity flex-shrink-0"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
