"use client";
import { videoSrc, imgSrc } from "@/shared/media/videoSrc";

import { useEffect, useState } from "react";
import { Client, Concept, HOOK_TYPE_SUGGESTIONS, VIDEO_TYPE_SUGGESTIONS } from "@/shared/types";
import Modal from "@/shared/ui/Modal";
import { splitExamples } from "@/features/scripts/server/exampleScripts";
import type { PlatformId } from "@/shared/agencyPlatforms";

type Props = { clients: Client[]; selectedClientId: number | null; refreshClients: () => void; platform?: PlatformId };
type Tab = "ideas" | "concepts";

// Distinct color per concept category (falls back to a stable hashed palette).
const CATEGORY_COLORS: Record<string, string> = {
  Viral:        "bg-hue-pink-100 text-hue-pink-700",
  Value:        "bg-hue-emerald-100 text-hue-emerald-700",
  Authentic:    "bg-warn-100 text-warn-700",
  Authority:    "bg-accent-tint text-accent-strong",
  Trust:        "bg-info-100 text-info-700",
  Uncategorised:"bg-surface-3 text-muted",
};
const CATEGORY_PALETTE = [
  "bg-hue-pink-100 text-hue-pink-700", "bg-hue-emerald-100 text-hue-emerald-700", "bg-warn-100 text-warn-700",
  "bg-accent-tint text-accent-strong", "bg-info-100 text-info-700", "bg-hue-cyan-100 text-hue-cyan-700",
  "bg-hue-rose-100 text-hue-rose-700", "bg-accent-tint text-accent-strong",
];
function categoryColor(cat: string): string {
  if (CATEGORY_COLORS[cat]) return CATEGORY_COLORS[cat];
  let h = 0;
  for (let i = 0; i < cat.length; i++) h = (h * 31 + cat.charCodeAt(i)) >>> 0;
  return CATEGORY_PALETTE[h % CATEGORY_PALETTE.length];
}

// ── Reel picker: browse the client's reels and click to attach ──────────────────
function reelUrlOf(r: any): string {
  return r.permalink || `https://instagram.com/reel/${r.id}`;
}
export function ReelPickerModal({ clientId, attached, onClose, onConfirm }: {
  clientId: number; attached: string[]; onClose: () => void; onConfirm: (urls: string[]) => void;
}) {
  const [reels, setReels] = useState<any[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(attached));
  const [preview, setPreview] = useState<any | null>(null);
  const [sort, setSort] = useState<"recent" | "top">("recent");

  // Instagram's cursor pagination overlaps pages, so the same reel can come back more than
  // once. Dedupe by a stable key (the reel's permalink, which is also the selection key) so
  // each reel appears exactly once and selecting one doesn't tick its duplicates.
  function dedupe(arr: any[]): any[] {
    const seen = new Set<string>();
    return arr.filter((r) => {
      const k = String(reelUrlOf(r) || r.id || r.shortcode || "");
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  async function loadPage(c: string | null): Promise<string | null> {
    const url = `/api/instagram/media?clientId=${clientId}${c ? `&cursor=${encodeURIComponent(c)}` : ""}`;
    const d = await fetch(url).then((r) => r.json()).catch(() => ({}));
    const page = Array.isArray(d?.reels) ? d.reels : Array.isArray(d) ? d : [];
    setReels((prev) => dedupe(c ? [...prev, ...page] : page));
    const next = d?.nextCursor ?? null;
    setCursor(next);
    return next;
  }

  // "Top" ranks by views across ALL reels, so pull every remaining page before sorting.
  async function loadAllRemaining() {
    let c = cursor;
    if (!c) return;
    setLoadingMore(true);
    try { while (c) c = await loadPage(c); } finally { setLoadingMore(false); }
  }

  // Reels sorted for display — newest-first (as loaded) or by view count (best performers).
  const displayReels = sort === "top"
    ? [...reels].sort((a, b) => (b.plays ?? 0) - (a.plays ?? 0))
    : reels;

  useEffect(() => {
    setLoading(true);
    loadPage(null).finally(() => setLoading(false));
  }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (cursor && !loadingMore && el.scrollHeight - el.scrollTop - el.clientHeight < 300) {
      setLoadingMore(true);
      loadPage(cursor).finally(() => setLoadingMore(false));
    }
  }

  function toggle(url: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(url) ? n.delete(url) : n.add(url); return n; });
  }

  return (
    <Modal title="Attach reels" onClose={onClose} wide>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted">Click a reel to select · tap ▶ to play it. {selected.size} selected.</p>
          <div className="flex items-center gap-1 bg-surface-3 rounded-lg p-0.5 flex-shrink-0">
            <button type="button" onClick={() => setSort("recent")}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${sort === "recent" ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink-2"}`}>Recent</button>
            <button type="button" onClick={() => { setSort("top"); loadAllRemaining(); }}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${sort === "top" ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink-2"}`}>🏆 Top performers</button>
          </div>
        </div>
        {loading ? (
          <div className="py-16 text-center text-sm text-faint">Loading reels…</div>
        ) : reels.length === 0 ? (
          <div className="py-16 text-center text-sm text-faint">No reels found for this client.</div>
        ) : (
          <div className="grid grid-cols-4 gap-2 max-h-[55vh] overflow-y-auto" onScroll={onScroll}>
            {displayReels.map((r) => {
              const url = reelUrlOf(r);
              const isSel = selected.has(url);
              return (
                <button key={r.id} type="button" onClick={() => toggle(url)}
                  className={`relative aspect-[9/16] rounded-lg overflow-hidden border-2 transition-all ${isSel ? "border-accent ring-2 ring-accent" : "border-transparent hover:border-line-2"}`}>
                  {r.thumbnail_url
                    ? <img src={imgSrc(r.thumbnail_url)} alt="" className="w-full h-full object-cover" />
                    : <div className="w-full h-full bg-slate-800 flex items-center justify-center text-muted">▶</div>}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                  {r.timestamp && <span className="absolute top-1 left-1 text-[8px] text-white bg-black/50 px-1 rounded">{new Date(r.timestamp).toLocaleDateString("en-GB",{day:"numeric",month:"short"})}</span>}
                  {r.plays != null && <span className="absolute bottom-1 left-1 text-[9px] font-bold text-white">▶ {r.plays >= 1000 ? (r.plays/1000).toFixed(1)+"K" : r.plays}</span>}
                  {/* View — plays the reel inline without toggling selection */}
                  <span role="button" tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); setPreview(r); }}
                    className="absolute bottom-1 right-1 w-5 h-5 rounded-full bg-black/55 hover:bg-black/80 text-white text-[10px] flex items-center justify-center backdrop-blur-sm cursor-pointer">▶</span>
                  {isSel && <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-accent text-on-accent text-[9px] flex items-center justify-center">✓</span>}
                </button>
              );
            })}
            {loadingMore && <div className="col-span-4 py-3 text-center text-xs text-faint">Loading more…</div>}
          </div>
        )}

        {/* Inline reel preview */}
        {preview && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={() => setPreview(null)}>
            <div className="relative" onClick={(e) => e.stopPropagation()}>
              {preview.media_url ? (
                <video src={videoSrc(preview.media_url)} poster={imgSrc(preview.thumbnail_url)} controls autoPlay
                  className="max-h-[80vh] w-auto rounded-xl o-elev-pop" />
              ) : (
                <div className="bg-surface rounded-xl p-8 text-center text-sm text-muted">No playable video for this reel.</div>
              )}
              <button onClick={() => setPreview(null)}
                className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-surface text-ink-2 o-elev-lift flex items-center justify-center text-lg">×</button>
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-ink-2 hover:bg-surface-3 rounded-lg">Cancel</button>
          <button type="button" onClick={() => { onConfirm(Array.from(selected)); onClose(); }}
            className="px-4 py-2 text-sm bg-accent text-on-accent rounded-lg hover:bg-accent-strong">Attach {selected.size} reel{selected.size !== 1 ? "s" : ""}</button>
        </div>
      </div>
    </Modal>
  );
}

export default function Concepts({ clients, selectedClientId, platform = "instagram", onAttachReels }: Props & { onAttachReels?: (c: { id: number; name: string }) => void }) {
  const [tab, setTab] = useState<Tab>(platform === "tiktok" ? "concepts" : "ideas");
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showAddIdea, setShowAddIdea] = useState(false);
  const [selected, setSelected] = useState<Concept | null>(null);
  const [promotingIdea, setPromotingIdea] = useState<Concept | null>(null);

  useEffect(() => { reload(); }, [selectedClientId, platform]); // eslint-disable-line react-hooks/exhaustive-deps
  // TikTok has no Ideas — always stay on Concepts.
  useEffect(() => { if (platform === "tiktok") setTab("concepts"); }, [platform]);

  async function reload() {
    const qs = selectedClientId ? `?clientId=${selectedClientId}&platform=${platform}` : `?platform=${platform}`;
    const data = await fetch(`/api/concepts${qs}`).then((r) => r.json());
    setConcepts(Array.isArray(data) ? data : []);
  }

  async function deleteConcept(id: number) {
    if (!confirm("Delete this concept?")) return;
    await fetch(`/api/concepts/${id}`, { method: "DELETE" });
    setSelected(null);
    setPromotingIdea(null);
    reload();
  }

  const ideas = concepts.filter((c) => c.isIdea);
  const realConcepts = concepts.filter((c) => !c.isIdea);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Concept Library</h1>
          <p className="text-muted mt-1">The viral playbook — your winning content DNA</p>
        </div>
        {tab === "ideas" && (
          <button onClick={() => setShowAddIdea(true)} className="bg-accent text-on-accent px-4 py-2 rounded-lg text-sm font-medium hover:bg-accent-strong">
            + New Idea
          </button>
        )}
        {tab === "concepts" && (
          <button onClick={() => setShowAdd(true)} className="bg-accent text-on-accent px-4 py-2 rounded-lg text-sm font-medium hover:bg-accent-strong">
            + New Concept
          </button>
        )}
      </div>

      {platform !== "tiktok" && (
        <div className="flex gap-1 bg-surface border border-line rounded-xl p-1 w-fit">
          {([
            ["ideas", `💡 Ideas${ideas.length > 0 ? ` (${ideas.length})` : ""}`],
            ["concepts", `🧠 Concepts${realConcepts.length > 0 ? ` (${realConcepts.length})` : ""}`],
          ] as [Tab, string][]).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                tab === id ? "bg-accent text-on-accent" : "text-muted hover:text-ink-2"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {tab === "ideas" && (
        <>
          {ideas.length === 0 ? (
            <div className="bg-surface rounded-xl border border-line p-12 text-center">
              <div className="text-4xl mb-3">💡</div>
              <p className="text-muted font-medium">No concept ideas yet.</p>
              <p className="text-xs text-faint mt-1">
                Click "+ New Idea" or go to Instagram → open a reel → click "Save as Concept Idea"
              </p>
            </div>
          ) : (
            <div className="bg-surface rounded-2xl border border-line divide-y divide-line overflow-hidden">
              {ideas.map((idea) => (
                <IdeaCard key={idea.id} idea={idea} onClick={() => setPromotingIdea(idea)} />
              ))}
            </div>
          )}
        </>
      )}

      {tab === "concepts" && (
        <>
          {realConcepts.length === 0 ? (
            <div className="bg-surface rounded-xl border border-line p-12 text-center">
              <div className="text-4xl mb-3">🧠</div>
              <p className="text-muted">No concepts yet. Promote an idea or create one manually.</p>
            </div>
          ) : (
            <div className="space-y-5">
              {(() => {
                // Group concepts by category (conceptType); uncategorised last
                const groups = new Map<string, Concept[]>();
                for (const c of realConcepts) {
                  const cat = ((c as any).conceptType || "Uncategorised") as string;
                  if (!groups.has(cat)) groups.set(cat, []);
                  groups.get(cat)!.push(c);
                }
                const ordered = Array.from(groups.entries()).sort((a, b) => {
                  if (a[0] === "Uncategorised") return 1;
                  if (b[0] === "Uncategorised") return -1;
                  return a[0].localeCompare(b[0]);
                });
                return ordered.map(([cat, list]) => (
                  <div key={cat}>
                    <div className="flex items-center gap-2 mb-2 px-1">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${categoryColor(cat)}`}>{cat}</span>
                      <span className="text-xs text-faint">{list.length} concept{list.length !== 1 ? "s" : ""}</span>
                    </div>
                    <div className="bg-surface rounded-2xl border border-line divide-y divide-line overflow-hidden">
                      {list.map((concept) => (
                        <button key={concept.id} onClick={() => setSelected(concept)}
                          className="w-full flex items-center gap-4 px-5 py-3.5 text-left hover:bg-surface-2 transition-colors group">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-white text-xs font-bold"
                            style={{ backgroundColor: concept.client?.color || "#6366f1" }}>
                            {concept.name[0]}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-ink truncate">{concept.name}</p>
                            {concept.textHook && <p className="text-xs text-faint italic truncate mt-0.5">"{concept.textHook}"</p>}
                          </div>
                          <div className="hidden md:flex items-center gap-1.5 flex-shrink-0">
                            {(() => { try { const r = JSON.parse((concept as any).reelUrls || "[]"); return r.length ? <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-surface-3 text-muted">📎 {r.length}</span> : null; } catch { return null; } })()}
                            {concept.hookType && <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-accent-tint text-accent">{concept.hookType}</span>}
                            {concept.videoType && <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-accent-tint text-accent">{concept.videoType}</span>}
                          </div>
                          <span className="text-xs text-faint flex-shrink-0 ml-2">×{concept.timesUsed}</span>
                          <svg className="w-3.5 h-3.5 text-faint group-hover:text-faint flex-shrink-0" viewBox="0 0 16 16" fill="none">
                            <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </button>
                      ))}
                    </div>
                  </div>
                ));
              })()}
            </div>
          )}
        </>
      )}

      {showAddIdea && (
        <IdeaModal
          clients={clients}
          selectedClientId={selectedClientId}
          platform={platform}
          onClose={() => setShowAddIdea(false)}
          onSaved={() => { setShowAddIdea(false); reload(); }}
        />
      )}

      {showAdd && (
        <ConceptModal
          clients={clients}
          selectedClientId={selectedClientId}
          platform={platform}
          existingConcepts={concepts.map((c) => ({ conceptType: (c as any).conceptType, name: c.name }))}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); reload(); }}
          onAttachReels={onAttachReels}
        />
      )}

      {selected && (
        <ConceptDetailModal
          concept={selected}
          clients={clients}
          onClose={() => setSelected(null)}
          onDelete={() => deleteConcept(selected.id)}
          onUpdated={(patch) => { setSelected((s) => s ? { ...s, ...patch } as Concept : s); reload(); }}
        />
      )}

      {promotingIdea && (
        <IdeaDetailPanel
          idea={promotingIdea}
          clients={clients}
          onClose={() => setPromotingIdea(null)}
          onDelete={() => deleteConcept(promotingIdea.id)}
          onPromoted={() => { setPromotingIdea(null); reload(); setTab("concepts"); }}
        />
      )}
    </div>
  );
}

function IdeaCard({ idea, onClick }: { idea: Concept; onClick: () => void }) {
  const hasTranscript = !!(idea.scriptExamples?.trim());
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-4 px-5 py-3.5 text-left hover:bg-surface-2 transition-colors group"
    >
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-white text-xs font-bold"
        style={{ backgroundColor: idea.client?.color || "#8b5cf6" }}
      >
        {idea.name[0]}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-ink truncate">{idea.name}</p>
        {idea.notes && (
          <p className="text-xs text-faint truncate mt-0.5">{idea.notes}</p>
        )}
      </div>

      <div className="hidden md:flex items-center gap-1.5 flex-shrink-0">
        {idea.client && (
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full text-white"
            style={{ backgroundColor: idea.client.color }}>
            {idea.client.name}
          </span>
        )}
        {hasTranscript && (
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-accent-tint text-accent">transcript</span>
        )}
      </div>

      <svg className="w-3.5 h-3.5 text-faint group-hover:text-faint flex-shrink-0" viewBox="0 0 16 16" fill="none">
        <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  );
}

function IdeaDetailPanel({ idea, clients, onClose, onDelete, onPromoted }: {
  idea: Concept;
  clients: Client[];
  onClose: () => void;
  onDelete: () => void;
  onPromoted: () => void;
}) {
  const [form, setForm] = useState({
    name: idea.name || "",
    conceptType: "",
    hookType: "",
    textHook: "",
    audioHook: "",
    videoType: "",
    angle: "",
    structure: "",
    guidelines: "",
  });
  const [promoting, setPromoting] = useState(false);
  const [generatingGuidelines, setGeneratingGuidelines] = useState(false);
  const [generatingStructure, setGeneratingStructure] = useState(false);
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const [playPermalink, setPlayPermalink] = useState<string | null>(null);
  const [playLoading, setPlayLoading] = useState(true);

  // The saved reel link's last segment is either a stored reel's numeric id (the client's own
  // feed reels live in the CompetitorReel table, each with a permanent R2 copy) or a shortcode.
  // Resolve through the reel-media endpoint — it serves the cached R2 mp4 instantly and returns
  // the real permalink. Auto-runs on open so the reel just plays, no click-out to Instagram.
  const reelSeg = (() => {
    const m = String(idea.exampleUrl || "").match(/\/(?:reel|reels|p|tv)\/([^/?#]+)/);
    return m ? m[1] : null;
  })();
  useEffect(() => {
    let cancelled = false;
    if (!reelSeg) { setPlayLoading(false); return; }
    (async () => {
      const numeric = /^\d+$/.test(reelSeg);
      let d: any = {};
      if (numeric) {
        d = await fetch(`/api/competitors/reel-media?id=${encodeURIComponent(reelSeg)}`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
        // Not a stored reel? Try the client's own Graph connection by media id.
        if (!d?.url) d = await fetch(`/api/instagram/media-url?clientId=${idea.clientId}&mediaId=${encodeURIComponent(reelSeg)}`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
      } else {
        d = await fetch(`/api/competitors/reel-media?shortcode=${encodeURIComponent(reelSeg)}`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
      }
      if (!cancelled) { setPlayUrl(d?.url || null); setPlayPermalink(d?.permalink || null); setPlayLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [reelSeg, idea.clientId]);

  function set(k: string, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  async function generateGuidelines() {
    if (!idea.scriptExamples?.trim()) return;
    setGeneratingGuidelines(true);
    try {
      const data = await fetch("/api/ai/generate-guidelines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: idea.scriptExamples, conceptName: form.name }),
      }).then((r) => r.json());
      if (data.guidelines) set("guidelines", data.guidelines);
    } finally {
      setGeneratingGuidelines(false);
    }
  }

  async function generateStructure() {
    if (!idea.scriptExamples?.trim()) return;
    setGeneratingStructure(true);
    try {
      const data = await fetch("/api/ai/generate-structure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: idea.scriptExamples, conceptName: form.name }),
      }).then((r) => r.json());
      if (data.structure) set("structure", data.structure);
    } finally {
      setGeneratingStructure(false);
    }
  }

  async function promote(e: React.FormEvent) {
    e.preventDefault();
    setPromoting(true);
    await fetch(`/api/concepts/${idea.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        clientId: idea.clientId,
        exampleUrl: idea.exampleUrl,
        scriptExamples: idea.scriptExamples,
        notes: idea.notes,
        isIdea: false,
      }),
    });
    setPromoting(false);
    onPromoted();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/40" onClick={onClose}>
      <div className="w-[560px] h-full bg-surface flex flex-col o-elev-pop overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-line flex-shrink-0">
          <div>
            <p className="text-sm font-bold text-ink">Concept Idea</p>
            <p className="text-[11px] text-faint">Fill in the details to promote to a full concept</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface-3 text-faint">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Source info */}
          <div className="px-5 pt-4 pb-3 bg-surface-2 border-b border-line">
            <p className="text-[10px] font-semibold text-faint uppercase tracking-wide mb-2">From Instagram</p>
            <p className="text-sm text-ink-2 font-medium line-clamp-2 mb-1">{idea.name}</p>
            {idea.notes && <p className="text-xs text-faint">{idea.notes}</p>}
            {idea.exampleUrl && (
              <div className="mt-2 space-y-2">
                {playLoading ? (
                  <div className="w-full aspect-[9/16] max-h-[46vh] rounded-lg bg-slate-900 flex items-center justify-center">
                    <div className="w-6 h-6 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : playUrl ? (
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <video key={playUrl} src={`/api/vid?u=${encodeURIComponent(playUrl)}`} controls autoPlay playsInline
                    className="w-full max-h-[46vh] rounded-lg bg-black object-contain" />
                ) : (
                  <p className="text-[11px] text-faint">Couldn&apos;t load the reel in-app — open it on Instagram below.</p>
                )}
                <a href={playPermalink || idea.exampleUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-accent hover:underline inline-block">
                  View reel ↗
                </a>
              </div>
            )}
          </div>

          {idea.scriptExamples && (
            <div className="px-5 py-4 border-b border-line">
              <p className="text-[10px] font-semibold text-faint uppercase tracking-wide mb-2">Transcript</p>
              <div className="bg-accent-tint border border-accent-tint rounded-xl p-3 text-sm text-ink-2 leading-relaxed max-h-36 overflow-y-auto">
                {idea.scriptExamples}
              </div>
            </div>
          )}

          <form id="promoteForm" onSubmit={promote} className="px-5 py-4 space-y-4">
            <p className="text-[10px] font-semibold text-faint uppercase tracking-wide">Concept Details</p>

            <div>
              <label className="block text-xs font-medium text-ink-2 mb-1">Concept Name *</label>
              <input required value={form.name} onChange={(e) => set("name", e.target.value)}
                className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
            </div>

            <div>
              <label className="block text-xs font-medium text-ink-2 mb-2">Concept Type</label>
              <div className="flex gap-2 flex-wrap">
                {["Viral", "Trust", "Authentic", "Value"].map((t) => (
                  <button key={t} type="button" onClick={() => set("conceptType", form.conceptType === t ? "" : t)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                      form.conceptType === t
                        ? t === "Viral" ? "bg-hue-pink-500 text-on-status border-hue-pink-500"
                          : t === "Trust" ? "bg-info-500 text-on-status border-info-500"
                          : t === "Authentic" ? "bg-warn-500 text-on-status border-warn-500"
                          : "bg-ok-500 text-on-status border-ok-500"
                        : "bg-surface text-muted border-line hover:border-line-2"
                    }`}>
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-ink-2 mb-1">Hook Type</label>
                <input list="hookTypeListIdea" value={form.hookType} onChange={(e) => set("hookType", e.target.value)}
                  placeholder="e.g. curiosity_gap"
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
                <datalist id="hookTypeListIdea">
                  {HOOK_TYPE_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
                </datalist>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-2 mb-1">Video Type</label>
                <input list="videoTypeListIdea" value={form.videoType} onChange={(e) => set("videoType", e.target.value)}
                  placeholder="e.g. talking_head"
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
                <datalist id="videoTypeListIdea">
                  {VIDEO_TYPE_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
                </datalist>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-ink-2 mb-1">Text Hook Template</label>
              <input value={form.textHook} onChange={(e) => set("textHook", e.target.value)}
                placeholder='e.g. "Did you know that [fact]..."'
                className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-ink-2 mb-1">Audio Hook</label>
                <input value={form.audioHook} onChange={(e) => set("audioHook", e.target.value)}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-2 mb-1">Angle</label>
                <input value={form.angle} onChange={(e) => set("angle", e.target.value)}
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-ink-2">Structure</label>
                {idea.scriptExamples?.trim() && (
                  <button type="button" onClick={generateStructure} disabled={generatingStructure}
                    className="text-[11px] px-2 py-0.5 bg-accent-tint text-accent rounded-full hover:bg-accent-tint disabled:opacity-50 transition-colors font-medium">
                    {generatingStructure ? "Generating…" : "✨ AI Generate"}
                  </button>
                )}
              </div>
              <textarea rows={2} value={form.structure} onChange={(e) => set("structure", e.target.value)}
                placeholder='e.g. "Hook (3s) → Problem (5s) → Solution (10s) → CTA (3s)"'
                className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent font-mono" />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-ink-2">Guidelines</label>
                {idea.scriptExamples?.trim() && (
                  <button type="button" onClick={generateGuidelines} disabled={generatingGuidelines}
                    className="text-[11px] px-2 py-0.5 bg-accent-tint text-accent rounded-full hover:bg-accent-tint disabled:opacity-50 transition-colors font-medium">
                    {generatingGuidelines ? "Generating…" : "✨ AI Generate"}
                  </button>
                )}
              </div>
              <textarea rows={2} value={form.guidelines} onChange={(e) => set("guidelines", e.target.value)}
                placeholder="Pacing, energy, what to include/avoid..."
                className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
            </div>
          </form>
        </div>

        <div className="px-5 py-4 border-t border-line flex-shrink-0 flex gap-2.5">
          <button onClick={onDelete} className="px-3 py-2.5 text-sm text-danger-500 hover:bg-danger-50 rounded-xl transition-colors">Delete</button>
          <button type="submit" form="promoteForm" disabled={promoting}
            className="flex-1 py-2.5 bg-accent text-on-accent text-sm font-semibold rounded-xl hover:bg-accent-strong disabled:opacity-60 transition-colors">
            {promoting ? "Saving…" : "🚀 Save as Concept"}
          </button>
        </div>
      </div>
    </div>
  );
}

function IdeaModal({ clients, selectedClientId, platform = "instagram", onClose, onSaved }: {
  clients: Client[];
  selectedClientId: number | null;
  platform?: PlatformId;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({ name: "", notes: "", exampleUrl: "" });
  const [scriptBoxes, setScriptBoxes] = useState<string[]>([""]);
  function set(k: string, v: string) { setForm((f) => ({ ...f, [k]: v })); }
  function setBox(i: number, v: string) { setScriptBoxes((p) => p.map((b, idx) => idx === i ? v : b)); }
  function setBoxCount(n: number) {
    const count = Math.max(1, Math.min(10, n));
    setScriptBoxes((p) => Array.from({ length: count }, (_, i) => p[i] ?? ""));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const scriptExamples = scriptBoxes.filter(Boolean).join("\n\n");
    await fetch("/api/concepts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, scriptExamples, clientId: selectedClientId, platform, isIdea: true }),
    });
    onSaved();
  }

  return (
    <Modal title="New Idea" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-ink-2 mb-1">Idea Name *</label>
          <input required value={form.name} onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. Before/After transformation hook"
            className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-2 mb-1">Notes</label>
          <textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)}
            placeholder="What makes this idea work..."
            className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-xs font-medium text-ink-2">Script / Transcript Examples</label>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-faint">How many?</span>
              <input type="number" min={1} max={10} value={scriptBoxes.length}
                onChange={(e) => setBoxCount(parseInt(e.target.value) || 1)}
                className="w-14 border border-line rounded-lg px-2 py-1 text-xs text-center focus:outline-none focus:ring-2 focus:ring-accent" />
            </div>
          </div>
          <div className="space-y-2">
            {scriptBoxes.map((val, i) => (
              <div key={i}>
                <p className="text-[10px] font-semibold text-faint uppercase tracking-wide mb-1">Example {i + 1}</p>
                <textarea rows={4} value={val} onChange={(e) => setBox(i, e.target.value)}
                  placeholder="Paste a script or transcript..."
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent font-mono" />
              </div>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-2 mb-1">Example URL (optional)</label>
          <input type="url" value={form.exampleUrl} onChange={(e) => set("exampleUrl", e.target.value)}
            className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-ink-2 hover:bg-surface-3 rounded-lg">Cancel</button>
          <button type="submit" className="px-4 py-2 text-sm bg-accent text-on-accent rounded-lg hover:bg-accent-strong">Save Idea</button>
        </div>
      </form>
    </Modal>
  );
}

const DEFAULT_CATEGORIES = ["Viral", "Value", "Authentic", "Authority"];

export function ConceptModal({
  clients, selectedClientId, platform = "instagram", onClose, onSaved, initial, existingConcepts, onAttachReels,
}: {
  clients: Client[];
  selectedClientId: number | null;
  platform?: PlatformId;
  onClose: () => void;
  onSaved: () => void;
  initial?: { name?: string; exampleUrl?: string; notes?: string; scriptExamples?: string; reelUrls?: string[]; textOverlay?: boolean };
  existingConcepts?: { conceptType?: string | null; name?: string | null }[];
  onAttachReels?: (c: { id: number; name: string }) => void;
}) {
  const activeClient = clients.find((c) => c.id === selectedClientId) ?? null;
  const existing = existingConcepts ?? [];
  const catOptions = Array.from(new Set([...DEFAULT_CATEGORIES, ...existing.map((c) => c.conceptType).filter(Boolean) as string[]]));

  const [form, setForm] = useState({
    name: initial?.name ?? "", clientId: selectedClientId?.toString() || "",
    conceptType: "",
    hookType: "", textHook: "", audioHook: "", videoType: "",
    angle: "", structure: "", guidelines: "",
    exampleUrl: initial?.exampleUrl ?? "", notes: initial?.notes ?? "",
  });
  const [reelUrls, setReelUrls] = useState<string[]>(initial?.reelUrls ?? []);
  const [newReel, setNewReel] = useState("");
  const [showReelPicker, setShowReelPicker] = useState(false);
  // Text-overlay flag — explicitly passed when the reel had no speech (vision-read its on-screen text)
  const [textOverlay, setTextOverlay] = useState<boolean>(initial?.textOverlay ?? false);
  // Client-owned: the client writes the scripts themselves on a recurring cadence
  const [clientOwned, setClientOwned] = useState(false);
  const [clientQuota, setClientQuota] = useState("3");
  const [clientIntervalDays, setClientIntervalDays] = useState("7");
  // Default the first-due-date to today (current month/year pre-filled) so the
  // owner only picks the day; editing keeps the saved value.
  const [clientAnchor, setClientAnchor] = useState<string>(() => {
    const saved = (initial as any)?.clientAnchor;
    if (saved) return String(saved).slice(0, 10);
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  // Concept Types saved under the selected category
  const typeOptions = Array.from(new Set(
    existing.filter((c) => c.conceptType === form.conceptType).map((c) => c.name).filter(Boolean) as string[]
  ));
  const [scriptBoxes, setScriptBoxesC] = useState<string[]>([initial?.scriptExamples || ""]);
  const [analyzing, setAnalyzing] = useState(false);
  function set(k: string, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  // Analyze the script/on-screen text and auto-fill the whole blueprint
  // (detects talking-head vs B-roll text-hook format).
  async function aiAnalyze() {
    const source = scriptBoxes.filter(Boolean).join("\n\n").trim();
    if (!source) { alert("Add a script example (or on-screen text) first so the AI has something to analyze."); return; }
    setAnalyzing(true);
    try {
      const d = await fetch("/api/ai/analyze-concept", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scriptExamples: source, conceptName: form.name, textOverlay }),
      }).then((r) => r.json());
      if (d.error) { alert(d.error); return; }
      setForm((f) => ({
        ...f,
        hookType:   d.hookType   || f.hookType,
        videoType:  d.videoType  || f.videoType,
        textHook:   d.textHook   || f.textHook,
        audioHook:  d.audioHook  || f.audioHook,
        angle:      d.angle      || f.angle,
        structure:  d.structure  || f.structure,
        guidelines: d.guidelines || f.guidelines,
      }));
      if (typeof d.isTextOverlay === "boolean") setTextOverlay(d.isTextOverlay);
    } catch {
      alert("AI analysis failed. Try again.");
    } finally {
      setAnalyzing(false);
    }
  }
  function setBox(i: number, v: string) { setScriptBoxesC((p) => p.map((b, idx) => idx === i ? v : b)); }
  function setBoxCount(n: number) {
    const count = Math.max(1, Math.min(10, n));
    setScriptBoxesC((p) => Array.from({ length: count }, (_, i) => p[i] ?? ""));
  }

  async function save(): Promise<any> {
    const scriptExamples = scriptBoxes.filter(Boolean).join("\n\n");
    const created = await fetch("/api/concepts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form, scriptExamples, reelUrls, textOverlay, isIdea: false, platform,
        clientOwned,
        clientQuota: clientOwned ? clientQuota : null,
        clientIntervalDays: clientOwned ? clientIntervalDays : null,
        clientAnchor: clientOwned ? clientAnchor : null,
      }),
    }).then((r) => r.json());
    // Auto-pull on-screen text from all attached reels as example scripts (background).
    if (created?.id && reelUrls.length) {
      fetch(`/api/concepts/${created.id}/extract-examples`, { method: "POST" }).catch(() => {});
    }
    return created;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await save();
    onSaved();
  }

  // Save the concept, then jump into the reels view to add reels to it
  async function saveAndAttach() {
    if (!form.conceptType || !form.name) { alert("Fill in Concept + Concept Type first."); return; }
    const created = await save();
    onClose();
    if (created?.id && onAttachReels) onAttachReels({ id: created.id, name: form.name });
    else onSaved();
  }

  return (
    <>
    <Modal title="New Concept" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        {activeClient ? (
          <div
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
            style={{ backgroundColor: activeClient.color + "15", border: `1.5px solid ${activeClient.color}30` }}
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
              style={{ backgroundColor: activeClient.color }}
            >
              {activeClient.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-ink">{activeClient.name}</p>
              <p className="text-xs text-muted capitalize">{activeClient.platform}</p>
            </div>
            <span className="text-[10px] text-faint">concept for this client</span>
          </div>
        ) : (
          <div>
            <label className="block text-xs font-medium text-ink-2 mb-1">Client (optional — blank = global)</label>
            <select value={form.clientId} onChange={(e) => set("clientId", e.target.value)}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent">
              <option value="">Global (all clients)</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-ink-2 mb-1">Concept *</label>
            <input list="conceptCatList" required value={form.conceptType} onChange={(e) => set("conceptType", e.target.value)}
              placeholder="Viral, Value, Authentic…"
              className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
            <datalist id="conceptCatList">
              {catOptions.map((c) => <option key={c} value={c} />)}
            </datalist>
            <p className="text-[10px] text-faint mt-0.5">Pick one or type a new category</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-2 mb-1">Concept Type *</label>
            <input list="conceptTypeList" required value={form.name} onChange={(e) => set("name", e.target.value)}
              placeholder={form.conceptType ? `type under ${form.conceptType}…` : "pick a concept first"}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
            <datalist id="conceptTypeList">
              {typeOptions.map((t) => <option key={t} value={t} />)}
            </datalist>
            <p className="text-[10px] text-faint mt-0.5">Pick an existing type or make a new one</p>
          </div>
        </div>

        {/* Attached reels — editable */}
        <div className="bg-surface-2 border border-line rounded-lg px-3 py-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] font-semibold text-muted">📎 {reelUrls.length} {platform === "tiktok" ? "video" : "reel"}{reelUrls.length !== 1 ? "s" : ""} attached</p>
            {form.clientId && (
              <button type="button" onClick={() => setShowReelPicker(true)}
                className="text-[10px] font-semibold text-accent hover:text-accent-800">🎬 Pick from {platform === "tiktok" ? "videos" : "reels"}</button>
            )}
          </div>
          <div className="space-y-1 mb-1.5">
            {reelUrls.map((u, i) => (
              <div key={i} className="flex items-center gap-2">
                <a href={u} target="_blank" rel="noopener noreferrer" className="flex-1 text-[11px] text-accent hover:underline truncate">{u}</a>
                <button type="button" onClick={() => setReelUrls(reelUrls.filter((_, idx) => idx !== i))} className="text-faint hover:text-danger-500 text-xs flex-shrink-0">✕</button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input value={newReel} onChange={(e) => setNewReel(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (newReel.trim()) { setReelUrls([...reelUrls, newReel.trim()]); setNewReel(""); } } }}
              placeholder={`Paste another ${platform === "tiktok" ? "video" : "reel"} link…`}
              className="flex-1 border border-line rounded-lg px-2.5 py-1 text-[11px] focus:outline-none focus:ring-2 focus:ring-accent" />
            <button type="button" onClick={() => { if (newReel.trim()) { setReelUrls([...reelUrls, newReel.trim()]); setNewReel(""); } }}
              className="px-2.5 py-1 text-[11px] font-semibold bg-accent text-on-accent rounded-lg hover:bg-accent-strong">Add</button>
          </div>
        </div>

        {/* B-roll / text-overlay format */}
        <label className={`flex items-start gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer border ${textOverlay ? "bg-warn-50 border-warn-200" : "bg-surface-2 border-line"}`}>
          <input type="checkbox" checked={textOverlay} onChange={(e) => setTextOverlay(e.target.checked)} className="mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-ink-2">📝 B-roll + text overlay (no voiceover)</p>
            <p className="text-[10px] text-faint">For viral text-on-screen reels. The AI writes on-screen <strong>text hooks/overlays</strong> in this style instead of a spoken script. Paste the on-screen text into Script Examples below.</p>
          </div>
        </label>

        {/* Client-owned: the client writes the scripts themselves */}
        <div className={`rounded-lg border ${clientOwned ? "bg-info-50 border-info-200" : "bg-surface-2 border-line"}`}>
          <label className="flex items-start gap-2.5 px-3 py-2.5 cursor-pointer">
            <input type="checkbox" checked={clientOwned} onChange={(e) => setClientOwned(e.target.checked)} className="mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-ink-2">🧑‍💻 Client writes the scripts</p>
              <p className="text-[10px] text-faint">No AI generation. The client gets a recurring task to write the scripts themselves; their submissions land as drafts for your review.</p>
            </div>
          </label>
          {clientOwned && (
            <div className="px-3 pb-3 grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] font-medium text-muted mb-1">How many scripts</label>
                <input type="number" min={1} max={50} value={clientQuota} onChange={(e) => setClientQuota(e.target.value)}
                  className="w-full border border-line rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-info-400" />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-muted mb-1">How often</label>
                <select value={clientIntervalDays} onChange={(e) => setClientIntervalDays(e.target.value)}
                  className="w-full border border-line rounded-lg px-2.5 py-1.5 text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-info-400">
                  <option value="7">Every week</option>
                  <option value="14">Every 2 weeks</option>
                  <option value="21">Every 3 weeks</option>
                  <option value="28">Every 4 weeks</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-medium text-muted mb-1">First due date</label>
                <input type="date" value={clientAnchor} onChange={(e) => setClientAnchor(e.target.value)}
                  className="w-full border border-line rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-info-400" />
              </div>
              <p className="col-span-3 text-[10px] text-info-500">
                e.g. {clientQuota || "?"} scripts {clientIntervalDays === "7" ? "every week" : `every ${parseInt(clientIntervalDays || "7") / 7} weeks`}{clientAnchor ? `, starting ${clientAnchor}` : " (pick a start date)"}.
              </p>
            </div>
          )}
        </div>

        {/* AI auto-fill — analyzes the script/on-screen text and fills the whole blueprint */}
        <button type="button" onClick={aiAnalyze} disabled={analyzing}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold bg-gradient-to-r from-accent to-accent text-on-accent hover:from-accent hover:to-accent disabled:opacity-60 transition-colors">
          {analyzing
            ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Analyzing reel…</>
            : <>✨ AI auto-fill from script — detects format, hook, structure & guidelines</>}
        </button>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-ink-2 mb-1">Hook Type</label>
            <input list="hookTypeList" value={form.hookType} onChange={(e) => set("hookType", e.target.value)}
              placeholder="e.g. question, curiosity_gap..."
              className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
            <datalist id="hookTypeList">
              {HOOK_TYPE_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
            </datalist>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-2 mb-1">Video Type</label>
            <input list="videoTypeList" value={form.videoType} onChange={(e) => set("videoType", e.target.value)}
              placeholder="e.g. talking_head, broll..."
              className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
            <datalist id="videoTypeList">
              {VIDEO_TYPE_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
            </datalist>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-ink-2 mb-1">Text Hook Template</label>
          <input value={form.textHook} onChange={(e) => set("textHook", e.target.value)}
            placeholder='e.g. "Did you know that [fact]..."'
            className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-ink-2 mb-1">Audio Hook</label>
            <input value={form.audioHook} onChange={(e) => set("audioHook", e.target.value)}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-2 mb-1">Angle</label>
            <input value={form.angle} onChange={(e) => set("angle", e.target.value)}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-2 mb-1">Structure</label>
          <textarea rows={2} value={form.structure} onChange={(e) => set("structure", e.target.value)}
            placeholder='e.g. "Hook (3s) → Problem (5s) → Solution (10s) → CTA (3s)"'
            className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent font-mono" />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-2 mb-1">Guidelines</label>
          <textarea rows={3} value={form.guidelines} onChange={(e) => set("guidelines", e.target.value)}
            placeholder="Pacing, cut changes, energy level, what to include/avoid..."
            className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-xs font-medium text-ink-2">
              Script Examples
              <span className="ml-1.5 text-[10px] font-normal text-faint">real scripts that worked well for this concept</span>
            </label>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-faint">How many?</span>
              <input type="number" min={1} max={10} value={scriptBoxes.length}
                onChange={(e) => setBoxCount(parseInt(e.target.value) || 1)}
                className="w-14 border border-line rounded-lg px-2 py-1 text-xs text-center focus:outline-none focus:ring-2 focus:ring-accent" />
            </div>
          </div>
          <div className="space-y-2">
            {scriptBoxes.map((val, i) => (
              <div key={i}>
                <p className="text-[10px] font-semibold text-faint uppercase tracking-wide mb-1">Example {i + 1}</p>
                <textarea rows={4} value={val} onChange={(e) => setBox(i, e.target.value)}
                  placeholder="Paste a script that performed well..."
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent font-mono" />
              </div>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-ink-2 mb-1">Example URL</label>
            <input type="url" value={form.exampleUrl} onChange={(e) => set("exampleUrl", e.target.value)}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-2 mb-1">Notes</label>
            <input value={form.notes} onChange={(e) => set("notes", e.target.value)}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-ink-2 hover:bg-surface-3 rounded-lg">Cancel</button>
          {onAttachReels && (
            <button type="button" onClick={saveAndAttach} className="px-4 py-2 text-sm bg-surface-3 text-ink-2 rounded-lg hover:bg-surface-4">
              🎬 Save & add reels
            </button>
          )}
          <button type="submit" className="px-4 py-2 text-sm bg-accent text-on-accent rounded-lg hover:bg-accent-strong">Save Concept</button>
        </div>
      </form>
    </Modal>
    {showReelPicker && form.clientId && (
      <ReelPickerModal
        clientId={parseInt(form.clientId)}
        attached={reelUrls}
        onClose={() => setShowReelPicker(false)}
        onConfirm={(urls) => setReelUrls(urls)}
      />
    )}
    </>
  );
}

function ConceptDetailModal({ concept, clients, onClose, onDelete, onUpdated }: { concept: Concept; clients: Client[]; onClose: () => void; onDelete: () => void; onUpdated?: (patch: Partial<Concept>) => void }) {
  const isTikTok = (concept as any).platform === "tiktok"; // eslint-disable-line @typescript-eslint/no-explicit-any
  const noun = isTikTok ? "video" : "reel";     // singular
  const nounU = isTikTok ? "VIDEOS" : "REELS";  // header
  const [taggedCount, setTaggedCount] = useState<number | null>(null); // videos tagged to this concept in Analytics
  useEffect(() => {
    if (!isTikTok) return;
    fetch(`/api/tiktok/video-concept?conceptId=${concept.id}`).then((r) => r.json())
      .then((d) => setTaggedCount(typeof d?.count === "number" ? d.count : 0)).catch(() => setTaggedCount(null));
  }, [concept.id, isTikTok]);
  const [reels, setReels] = useState<string[]>(() => {
    try { return JSON.parse((concept as any).reelUrls || "[]"); } catch { return []; }
  });
  const [showReelPicker, setShowReelPicker] = useState(false);
  const [newReel, setNewReel] = useState("");
  const [examples, setExamples] = useState<string | null | undefined>(concept.scriptExamples);
  const [pulling, setPulling] = useState(false);
  const [type, setType] = useState<string>((concept as any).conceptType || "");
  const [savingType, setSavingType] = useState(false);
  const [name, setName] = useState<string>(concept.name);
  const [editingName, setEditingName] = useState(false);

  // Client assignment + "client writes the script" settings — editable right here so you
  // never have to delete & recreate a concept just to hand it to a client.
  const [clientId, setClientId] = useState<string>(concept.clientId ? String(concept.clientId) : "");
  const [clientOwned, setClientOwned] = useState<boolean>(!!concept.clientOwned);
  const [clientQuota, setClientQuota] = useState<string>(concept.clientQuota != null ? String(concept.clientQuota) : "3");
  const [clientIntervalDays, setClientIntervalDays] = useState<string>(concept.clientIntervalDays != null ? String(concept.clientIntervalDays) : "7");
  const [clientAnchor, setClientAnchor] = useState<string>(concept.clientAnchor || "");
  const [savingAssign, setSavingAssign] = useState(false);
  const [savedAssign, setSavedAssign] = useState(false);

  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  async function saveAssignment(next: {
    clientId?: string; clientOwned?: boolean; clientQuota?: string; clientIntervalDays?: string; clientAnchor?: string;
  }) {
    const cId = next.clientId ?? clientId;
    const owned = (next.clientOwned ?? clientOwned) && !!cId;
    const quota = next.clientQuota ?? clientQuota;
    const interval = next.clientIntervalDays ?? clientIntervalDays;
    const anchor = next.clientAnchor ?? clientAnchor;
    setSavingAssign(true);
    setSavedAssign(false);
    await fetch(`/api/concepts/${concept.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: cId || null,
        clientOwned: owned,
        clientQuota: owned ? quota : null,
        clientIntervalDays: owned ? interval : null,
        clientAnchor: owned ? (anchor || todayStr()) : null,
      }),
    });
    setSavingAssign(false);
    setSavedAssign(true);
    const cl = clients.find((c) => String(c.id) === String(cId));
    onUpdated?.({
      clientId: cId ? parseInt(cId) : null,
      client: cl ? { name: cl.name, color: cl.color } : null,
      clientOwned: owned,
      clientQuota: owned ? parseInt(quota) || null : null,
      clientIntervalDays: owned ? parseInt(interval) || null : null,
      clientAnchor: owned ? (anchor || todayStr()) : null,
    } as Partial<Concept>);
  }

  async function saveName(next: string) {
    const v = next.trim();
    setEditingName(false);
    if (!v || v === name) return;
    setName(v);
    await fetch(`/api/concepts/${concept.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: v }),
    });
    onUpdated?.({ name: v });
  }

  async function saveType(next: string) {
    const v = next.trim();
    if (v === type) return;
    setType(v);
    setSavingType(true);
    await fetch(`/api/concepts/${concept.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conceptType: v || null }),
    });
    setSavingType(false);
    onUpdated?.({ conceptType: v } as Partial<Concept>);
  }

  async function saveReels(next: string[]) {
    setReels(next);
    await fetch(`/api/concepts/${concept.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reelUrls: next }),
    });
  }

  // Read each attached reel's text (transcript for talking-head, on-screen text
  // for text-overlay) and add them as script examples.
  async function pullFromReels() {
    const hasExamples = !!(examples?.trim());
    const replace = hasExamples
      ? confirm("Replace the existing example scripts with fresh ones pulled from the attached reels?\n\nOK = replace all · Cancel = just add new ones")
      : false;
    setPulling(true);
    try {
      const d = await fetch(`/api/concepts/${concept.id}/extract-examples`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replace }),
      }).then((r) => r.json());
      if (d.error) { alert(d.error); return; }
      const fresh = await fetch(`/api/concepts/${concept.id}`).then((r) => r.json());
      setExamples(fresh?.scriptExamples ?? "");
      alert(d.added > 0
        ? `Added ${d.added} example${d.added !== 1 ? "s" : ""} from your attached reels (matched ${d.matched}/${d.attached}).`
        : `No new text found (matched ${d.matched}/${d.attached} reels).`);
    } catch {
      alert("Couldn't pull from reels. Try again.");
    } finally {
      setPulling(false);
    }
  }
  function addReel() {
    const u = newReel.trim();
    if (!u) return;
    saveReels([...reels, u]);
    setNewReel("");
  }

  return (
    <>
    <Modal title={name} onClose={onClose} wide>
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2 items-center">
          {editingName ? (
            <input
              autoFocus
              defaultValue={name}
              onBlur={(e) => saveName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveName((e.target as HTMLInputElement).value); if (e.key === "Escape") setEditingName(false); }}
              placeholder="Concept name…"
              className="px-2 py-0.5 rounded text-sm font-bold text-ink border border-accent focus:outline-none focus:ring-2 focus:ring-accent-tint w-28"
            />
          ) : (
            <button
              onClick={() => setEditingName(true)}
              title="Click to rename this concept"
              className="inline-flex items-center gap-1 text-sm font-bold text-ink-2 hover:text-accent"
            >
              {name} <span className="opacity-50 text-[10px]">✎</span>
            </button>
          )}
          <span className="text-faint">·</span>
          {/* Concept type — a plain dropdown that always shows every type and saves on pick. */}
          <div className={`inline-flex items-center rounded-full text-xs font-bold ${type ? categoryColor(type) : "bg-surface-3 text-muted"}`}>
            <select
              value={DEFAULT_CATEGORIES.includes(type) ? type : (type ? "__custom__" : "")}
              onChange={(e) => { if (e.target.value !== "__custom__") saveType(e.target.value); }}
              disabled={savingType}
              title="Change concept type"
              className="bg-transparent px-2.5 py-0.5 pr-1 rounded-full font-bold focus:outline-none cursor-pointer appearance-none"
            >
              {!type && <option value="">Set type…</option>}
              {DEFAULT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              {type && !DEFAULT_CATEGORIES.includes(type) && <option value="__custom__">{type}</option>}
            </select>
            <span className="pr-2 opacity-60 text-[9px]">{savingType ? "…" : "▾"}</span>
          </div>
          {concept.hookType && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-accent-tint text-accent-strong">
              🎣 {concept.hookType}
            </span>
          )}
          {concept.videoType && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-accent-tint text-accent-strong">
              🎬 {concept.videoType}
            </span>
          )}
          {concept.angle && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-surface-3 text-ink-2">
              {concept.angle}
            </span>
          )}
          {/* Client assignment — pick a client right here (or set Global). */}
          <div className="inline-flex items-center rounded-full text-xs font-medium text-white"
            style={{ backgroundColor: clientId ? (clients.find((c) => String(c.id) === clientId)?.color || "#6366f1") : "#e2e8f0" }}>
            <select
              value={clientId}
              onChange={(e) => { setClientId(e.target.value); saveAssignment({ clientId: e.target.value, clientOwned: e.target.value ? clientOwned : false }); }}
              disabled={savingAssign}
              title="Assign this concept to a client"
              className={`bg-transparent px-2.5 py-0.5 pr-1 rounded-full font-medium focus:outline-none cursor-pointer appearance-none ${clientId ? "text-white" : "text-muted"}`}
            >
              <option value="">Global (no client)</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <span className={`pr-2 opacity-70 text-[9px] ${clientId ? "text-white" : "text-muted"}`}>{savingAssign ? "…" : "▾"}</span>
          </div>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-warn-100 text-warn-700">
            Used {concept.timesUsed}×
          </span>
          {isTikTok && taggedCount != null && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-accent-tint text-accent-strong" title="Videos tagged with this concept in the Analytics table">
              📊 {taggedCount} tagged
            </span>
          )}
        </div>

        {/* Hand it to the client to write — quota + cadence, same as on creation. */}
        {clientId && (
          <div className={`rounded-lg border ${clientOwned ? "bg-info-50 border-info-200" : "bg-surface-2 border-line"}`}>
            <label className="flex items-start gap-2 px-3 py-2.5 cursor-pointer">
              <input type="checkbox" checked={clientOwned}
                onChange={(e) => { setClientOwned(e.target.checked); saveAssignment({ clientOwned: e.target.checked }); }}
                className="mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-ink-2">✍️ {clients.find((c) => String(c.id) === clientId)?.name || "Client"} writes the scripts</p>
                <p className="text-[11px] text-muted">They get assigned a batch of scripts to write for this concept on a recurring cadence.</p>
              </div>
            </label>
            {clientOwned && (
              <div className="px-3 pb-3 space-y-2">
                <div className="flex items-center gap-2 flex-wrap text-xs text-ink-2">
                  <span>Assign</span>
                  <input type="number" min={1} max={50} value={clientQuota}
                    onChange={(e) => setClientQuota(e.target.value)}
                    onBlur={() => saveAssignment({})}
                    className="w-14 border border-line-2 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-info-400" />
                  <span>scripts</span>
                  <select value={clientIntervalDays}
                    onChange={(e) => { setClientIntervalDays(e.target.value); saveAssignment({ clientIntervalDays: e.target.value }); }}
                    className="border border-line-2 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-info-400">
                    <option value="7">every week</option>
                    <option value="14">every 2 weeks</option>
                    <option value="21">every 3 weeks</option>
                    <option value="28">every 4 weeks</option>
                  </select>
                  <span>starting</span>
                  <input type="date" value={clientAnchor || todayStr()}
                    onChange={(e) => { setClientAnchor(e.target.value); saveAssignment({ clientAnchor: e.target.value }); }}
                    className="border border-line-2 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-info-400" />
                </div>
                <p className="text-[11px] text-info-700">
                  {clients.find((c) => String(c.id) === clientId)?.name || "The client"} will see {clientQuota || "?"} script{clientQuota === "1" ? "" : "s"} to write {clientIntervalDays === "7" ? "every week" : `every ${parseInt(clientIntervalDays || "7") / 7} weeks`} on their Script Tasks page.
                </p>
                <div className="flex items-center justify-end gap-3 pt-1">
                  {savedAssign && !savingAssign && (
                    <span className="text-[11px] font-semibold text-hue-emerald-600">✓ Saved — it's on {clients.find((c) => String(c.id) === clientId)?.name || "the client"}'s Script Tasks now</span>
                  )}
                  <button onClick={() => saveAssignment({})} disabled={savingAssign}
                    className="px-4 py-1.5 text-xs font-semibold text-on-status bg-info-600 rounded-lg hover:bg-info-700 disabled:opacity-50">
                    {savingAssign ? "Saving…" : savedAssign ? "Saved ✓" : "Save & assign"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Attached reels */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs font-semibold text-muted">📎 ATTACHED {nounU} ({reels.length})</p>
            <div className="flex items-center gap-3">
              {reels.length > 0 && concept.clientId && (
                <button onClick={pullFromReels} disabled={pulling}
                  title={`Read each ${noun}'s text and add as Script Examples`}
                  className={`text-[11px] font-semibold ${pulling ? "text-faint cursor-wait" : "text-hue-pink-600 hover:text-hue-pink-800"}`}>
                  {pulling ? `Reading ${noun}s…` : `✨ Pull text from ${reels.length} ${noun}${reels.length !== 1 ? "s" : ""}`}
                </button>
              )}
              {concept.clientId && (
                <button onClick={() => setShowReelPicker(true)}
                  className="text-[11px] font-semibold text-accent hover:text-accent-800">🎬 Pick from {noun}s</button>
              )}
            </div>
          </div>
          <div className="space-y-1.5 mb-2">
            {reels.map((u, i) => (
              <div key={i} className="flex items-center gap-2 bg-surface-2 border border-line rounded-lg px-3 py-1.5">
                <a href={u} target="_blank" rel="noopener noreferrer" className="flex-1 text-xs text-accent hover:underline truncate">{u}</a>
                <button onClick={() => saveReels(reels.filter((_, idx) => idx !== i))}
                  className="text-faint hover:text-danger-500 text-xs flex-shrink-0">✕</button>
              </div>
            ))}
            {reels.length === 0 && <p className="text-xs text-faint">No {noun}s attached yet.</p>}
          </div>
          <div className="flex items-center gap-2">
            <input value={newReel} onChange={(e) => setNewReel(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addReel(); }}
              placeholder={`Paste a ${noun} link to attach…`}
              className="flex-1 border border-line rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-accent" />
            <button onClick={addReel} className="px-3 py-1.5 text-xs font-semibold bg-accent text-on-accent rounded-lg hover:bg-accent-strong">Add</button>
          </div>
        </div>

        {concept.textHook && (
          <div>
            <p className="text-xs font-semibold text-muted mb-1">TEXT HOOK</p>
            <div className="bg-accent-tint border border-accent-tint rounded-lg px-4 py-3 text-sm font-medium text-accent-800">
              {concept.textHook}
            </div>
          </div>
        )}
        {concept.audioHook && (
          <div>
            <p className="text-xs font-semibold text-muted mb-1">AUDIO HOOK</p>
            <p className="text-sm text-ink-2">{concept.audioHook}</p>
          </div>
        )}
        {concept.structure && (
          <div>
            <p className="text-xs font-semibold text-muted mb-1">STRUCTURE</p>
            <pre className="bg-surface-2 border border-line rounded-lg px-4 py-3 text-sm font-mono whitespace-pre-wrap text-ink-2">
              {concept.structure}
            </pre>
          </div>
        )}
        {concept.guidelines && (
          <div>
            <p className="text-xs font-semibold text-muted mb-1">GUIDELINES</p>
            <div className="bg-surface-2 border border-line rounded-lg px-4 py-3 text-sm text-ink-2">
              {concept.guidelines}
            </div>
          </div>
        )}
        {examples && (
          <div>
            <p className="text-xs font-semibold text-muted mb-2">SCRIPT EXAMPLES</p>
            <div className="space-y-2">
              {splitExamples(examples).map((ex, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] font-semibold text-warn-600 uppercase tracking-wide">Example {i + 1}</p>
                    <span className="text-[10px] text-faint">{ex.trim().split(/\s+/).filter(Boolean).length} words</span>
                  </div>
                  <pre className="bg-warn-50 border border-warn-200 rounded-lg px-4 py-3 text-sm font-mono whitespace-pre-wrap text-ink-2 max-h-48 overflow-y-auto">
                    {ex.trim()}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        )}
        {concept.exampleUrl && (
          <div>
            <p className="text-xs font-semibold text-muted mb-1">EXAMPLE</p>
            <a href={concept.exampleUrl} target="_blank" rel="noopener noreferrer"
              className="text-sm text-accent hover:underline break-all">{concept.exampleUrl}</a>
          </div>
        )}
        {concept.notes && (
          <div>
            <p className="text-xs font-semibold text-muted mb-1">NOTES</p>
            <p className="text-sm text-ink-2">{concept.notes}</p>
          </div>
        )}

        <div className="flex justify-between pt-2 border-t border-line">
          <button onClick={onDelete} className="text-sm text-danger-500 hover:text-danger-700">Delete</button>
          <button onClick={onClose} className="px-4 py-2 text-sm bg-surface-3 text-ink-2 rounded-lg hover:bg-surface-4">Close</button>
        </div>
      </div>
    </Modal>
    {showReelPicker && concept.clientId && (
      <ReelPickerModal
        clientId={concept.clientId}
        attached={reels}
        onClose={() => setShowReelPicker(false)}
        onConfirm={(urls) => saveReels(urls)}
      />
    )}
    </>
  );
}
