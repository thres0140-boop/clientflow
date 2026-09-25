"use client";

// Clipping: take one finished long-form YouTube video and cut short vertical clips out of it.
// Pick a source (a YouTube draft with a finished video or a raw upload), mark in/out on the
// player (I / O keys) with the word-timed transcript alongside, pick the target platform and
// concept, and the clip becomes a draft in that platform's Edit stage whose edit project is
// already trimmed to the window, with the transcript text of exactly that window as its script
// so the editor's caption aligner has ground truth. "Open in editor" goes to /edit/<draftId>.
//
// State is scoped by React keys rather than reset in effects: the client's workbench remounts
// when the client changes, and the video workbench remounts when the chosen video changes.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Client, Concept } from "@/shared/types";
import { videoSrc } from "@/shared/media/videoSrc";
import type { PlatformId } from "@/shared/agencyPlatforms";
import type { TranscriptWord } from "@/features/editor/model/document";
import { uploadToR2 } from "@/features/editor/pages/upload";
import { fmtMs, type ClipSource } from "@/features/youtube/model/clipping";

type Props = { clients: Client[]; selectedClientId: number | null; readOnly?: boolean };

const PLATFORM_LABEL: Record<PlatformId, string> = { instagram: "📸 Instagram", tiktok: "🎵 TikTok", youtube: "▶️ YouTube" };
const PLATFORM_BADGE: Record<string, string> = { instagram: "📸", tiktok: "🎵", youtube: "▶️" };
const CLIP_MAX_MS = 5 * 60 * 1000;

/** Where the player loads from: a presigned GET on the R2 S3 endpoint for our own objects (no
 *  function in the way, no r2.dev throttle), else the same-origin proxy like every other player. */
async function resolveSrc(url: string): Promise<string> {
  try {
    const r = await fetch(`/api/r2/sign-get?url=${encodeURIComponent(url)}`, { cache: "no-store" });
    const j = await r.json();
    if (r.ok && typeof j?.url === "string") return j.url;
  } catch { /* fall through */ }
  return videoSrc(url);
}

/** The words spoken inside [inMs, outMs): a word belongs to the window when its midpoint does. */
function wordsInWindow(words: TranscriptWord[], inMs: number, outMs: number): TranscriptWord[] {
  return words.filter((w) => { const mid = (w.startMs + w.endMs) / 2; return mid >= inMs && mid < outMs; });
}

export default function ClippingPage({ clients, selectedClientId, readOnly = false }: Props) {
  const client = clients.find((c) => c.id === selectedClientId) ?? null;
  if (!client) return <div className="flex items-center justify-center h-[60vh] text-faint text-sm">Select a client to start clipping.</div>;
  return <ClientClipping key={client.id} client={client} readOnly={readOnly} />;
}

// ── one client: the source list, the chosen video, the clips ───────────────────────────────────
function ClientClipping({ client, readOnly }: { client: Client; readOnly: boolean }) {
  const enabledPlatforms = useMemo<PlatformId[]>(() => {
    const list: PlatformId[] = [];
    if ((client as { instagramEnabled?: boolean }).instagramEnabled !== false) list.push("instagram");
    if (client.youtubeEnabled) list.push("youtube");
    return list;
  }, [client]);

  const [sources, setSources] = useState<ClipSource[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const source = sources?.find((s) => s.draftId === selectedId) ?? null;

  const fetchSources = useCallback(async (): Promise<ClipSource[]> => {
    const r = await fetch(`/api/clipping/sources?clientId=${client.id}`, { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
    return j.sources as ClipSource[];
  }, [client.id]);
  /** Show a fresh list; keep the current source and video selected when `keep` still exists. */
  const applySources = useCallback((list: ClipSource[], keep?: { draftId: number; url?: string | null }) => {
    setSources(list);
    setLoadError("");
    const pick = keep && list.find((s) => s.draftId === keep.draftId) ? keep.draftId : (list.find((s) => s.videos.length)?.draftId ?? list[0]?.draftId ?? null);
    setSelectedId(pick);
    const s = list.find((x) => x.draftId === pick);
    setVideoUrl(keep?.url && s?.videos.some((v) => v.url === keep.url) ? keep.url : (s?.videos[0]?.url ?? null));
  }, []);
  const loadSources = useCallback(async (keep?: { draftId: number; url?: string | null }) => {
    try { applySources(await fetchSources(), keep); }
    catch (e) { setLoadError(e instanceof Error ? e.message : String(e)); setSources([]); }
  }, [fetchSources, applySources]);
  useEffect(() => {
    let cancelled = false;
    fetchSources().then((list) => { if (!cancelled) applySources(list); }).catch((e) => { if (!cancelled) { setLoadError(e instanceof Error ? e.message : String(e)); setSources([]); } });
    return () => { cancelled = true; };
  }, [fetchSources, applySources]);

  function selectSource(id: number) {
    if (id === selectedId) return;
    setSelectedId(id);
    setVideoUrl(sources?.find((s) => s.draftId === id)?.videos[0]?.url ?? null);
  }

  // Attach a finished video to a YouTube draft that has none (same R2 multipart flow as raw content).
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState("");
  async function attachFinished(file: File) {
    if (!source) return;
    setUploadPct(0); setUploadError("");
    try {
      const url = await uploadToR2(file, setUploadPct);
      const r = await fetch(`/api/script-drafts/${source.draftId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ editedVideoUrl: url }) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await loadSources({ draftId: source.draftId, url });
    } catch (e) { setUploadError(e instanceof Error ? e.message : String(e)); }
    finally { setUploadPct(null); }
  }

  return (
    <div className="w-full">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-ink">Clipping</h1>
          <p className="text-sm text-faint mt-0.5">Cut short clips out of a long-form YouTube video. Each clip lands in the editor already trimmed, with what was said as its script.</p>
        </div>
      </div>

      {loadError && <div className="rounded-lg bg-danger-50 border border-danger-200 px-4 py-3 text-sm text-danger-700 mb-4">{loadError}</div>}
      {!sources && !loadError && <p className="text-sm text-muted">Loading…</p>}
      {sources && sources.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed border-line-2 py-14 text-center">
          <p className="text-sm font-semibold text-ink-2">No YouTube videos yet</p>
          <p className="text-xs text-faint mt-1">Create the long-form video as a draft on the YouTube Kanban and upload its finished cut there (or here, once it exists). It then shows up as a source.</p>
        </div>
      )}

      {sources && sources.length > 0 && (
        <div className="flex gap-5 items-start">
          <aside className="w-64 shrink-0 space-y-2">
            <p className="text-[10px] font-semibold text-faint uppercase tracking-wide px-1">Long-form videos</p>
            <ul className="rounded-2xl border border-line bg-surface divide-y divide-line-soft overflow-hidden shadow-soft">
              {sources.map((s) => (
                <li key={s.draftId}>
                  <button onClick={() => selectSource(s.draftId)}
                    className={`w-full text-left px-3 py-2.5 transition-colors ${s.draftId === selectedId ? "bg-accent-tint" : "hover:bg-surface-2"}`}>
                    <div className="text-sm font-semibold text-ink truncate">{s.title}</div>
                    <div className="flex items-center gap-2 mt-1 text-[10px]">
                      {s.stage ? <span className="px-1.5 py-0.5 rounded-full text-white font-semibold" style={{ backgroundColor: s.stage.color }}>{s.stage.name}</span> : <span className="px-1.5 py-0.5 rounded-full bg-surface-3 text-muted font-semibold">Ideas</span>}
                      <span className="text-faint">{s.videos.length === 0 ? "no video" : s.hasFinishedVideo ? "finished video" : `${s.videos.length} raw upload${s.videos.length === 1 ? "" : "s"}`}</span>
                      {s.clips.length > 0 && <span className="text-faint">· {s.clips.length} clip{s.clips.length === 1 ? "" : "s"}</span>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <div className="flex-1 min-w-0 space-y-4">
            {source && (
              <div className="o-card p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-ink truncate">{source.title}</h2>
                    <p className="text-[11px] text-faint">{source.conceptName ? `Concept: ${source.conceptName}` : "No concept"}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {source.videos.length > 1 && (
                      <select value={videoUrl ?? ""} onChange={(e) => setVideoUrl(e.target.value)}
                        className="border border-line rounded-lg px-2 py-1.5 text-xs text-ink-2 bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40">
                        {source.videos.map((v) => <option key={v.url} value={v.url}>{v.label}</option>)}
                      </select>
                    )}
                    {!readOnly && !source.hasFinishedVideo && (
                      <label className={`o-btn o-btn-ghost text-xs cursor-pointer ${uploadPct != null ? "opacity-60 pointer-events-none" : ""}`}>
                        {uploadPct != null ? `Uploading ${uploadPct}%` : "Attach finished video"}
                        <input type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) attachFinished(f); e.target.value = ""; }} />
                      </label>
                    )}
                  </div>
                </div>
                {uploadError && <p className="text-xs text-danger-500 mt-2">{uploadError}</p>}
                {!videoUrl && <p className="text-sm text-muted mt-4">This draft has no video yet. Upload its finished cut on the YouTube Kanban, or attach it here.</p>}
                {videoUrl && (
                  <VideoWorkbench key={`${source.draftId}|${videoUrl}`} client={client} source={source} videoUrl={videoUrl}
                    enabledPlatforms={enabledPlatforms} readOnly={readOnly}
                    onCreated={() => loadSources({ draftId: source.draftId, url: videoUrl })} />
                )}
              </div>
            )}

            {source && source.clips.length > 0 && (
              <div className="o-card p-4">
                <h3 className="text-sm font-semibold text-ink mb-2">Clips from this video</h3>
                <ul className="divide-y divide-line-soft">
                  {source.clips.map((c) => (
                    <li key={c.draftId} className="flex items-center gap-3 py-2">
                      <span className="text-sm">{PLATFORM_BADGE[c.platform] ?? "•"}</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-ink truncate">{c.title}</div>
                        <div className="text-[11px] text-faint">{c.outMs > c.inMs ? `${fmtMs(c.inMs)} – ${fmtMs(c.outMs)} · ${fmtMs(c.outMs - c.inMs)}` : "window unknown"}</div>
                      </div>
                      {c.stage ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full text-white shrink-0" style={{ backgroundColor: c.stage.color }}>{c.stage.name}</span> : <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-surface-3 text-muted shrink-0">Ideas</span>}
                      {c.hasFinishedVideo && <span className="text-[10px] font-semibold text-ok-700 shrink-0">✓ cut</span>}
                      <a href={`/edit/${c.draftId}`} className="text-xs font-semibold text-accent hover:text-accent-strong shrink-0">Open in editor →</a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── one video: player, marks, transcript, and the new-clip form ────────────────────────────────
function VideoWorkbench({ client, source, videoUrl, enabledPlatforms, readOnly, onCreated }: {
  client: Client; source: ClipSource; videoUrl: string; enabledPlatforms: PlatformId[]; readOnly: boolean; onCreated: () => void;
}) {
  // player
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [meta, setMeta] = useState<{ width: number; height: number } | null>(null);
  const [timeMs, setTimeMs] = useState(0);
  const [inMs, setInMs] = useState<number | null>(null);
  const [outMs, setOutMs] = useState<number | null>(null);
  const [playingWindow, setPlayingWindow] = useState(false);
  const [mediaError, setMediaError] = useState("");
  // The clip's script: the transcript window by default, or what the operator typed over it.
  // Moving a mark drops the override so the script follows the window again.
  const [scriptOverride, setScriptOverride] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    resolveSrc(videoUrl).then((s) => { if (!cancelled) setSrc(s); });
    return () => { cancelled = true; };
  }, [videoUrl]);

  const seek = useCallback((ms: number) => {
    const v = videoRef.current; if (!v) return;
    v.currentTime = Math.max(0, Math.min(ms, durationMs || ms)) / 1000;
    setTimeMs(Math.round(v.currentTime * 1000));
  }, [durationMs]);
  function togglePlay() { const v = videoRef.current; if (!v) return; setPlayingWindow(false); if (v.paused) v.play().catch(() => {}); else v.pause(); }
  function playWindow() {
    const v = videoRef.current; if (!v || inMs == null) return;
    v.currentTime = inMs / 1000; setPlayingWindow(true); v.play().catch(() => {});
  }
  function markIn() { const t = timeMs; setInMs(t); if (outMs != null && outMs <= t) setOutMs(null); setScriptOverride(null); }
  function markOut() { const t = timeMs; if (inMs != null && t <= inMs) return; setOutMs(t); setScriptOverride(null); }

  // Keyboard: I / O mark, space play, ←/→ 1 s (⇧ = 5 s), never inside a field.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      if (!src) return;
      const step = e.shiftKey ? 5000 : 1000;
      if (e.key === "i" || e.key === "I") { e.preventDefault(); markIn(); }
      else if (e.key === "o" || e.key === "O") { e.preventDefault(); markOut(); }
      else if (e.key === " ") { e.preventDefault(); togglePlay(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); seek(timeMs - step); }
      else if (e.key === "ArrowRight") { e.preventDefault(); seek(timeMs + step); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // transcript: pick up an existing one for free on mount; a paid run only on the button
  const [words, setWords] = useState<TranscriptWord[] | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState("");
  useEffect(() => {
    let cancelled = false;
    fetch("/api/clipping/transcribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draftId: source.draftId, url: videoUrl, cacheOnly: true }) })
      .then((r) => r.json()).then((j) => { if (!cancelled && Array.isArray(j?.words)) setWords(j.words); }).catch(() => {});
    return () => { cancelled = true; };
  }, [videoUrl, source.draftId]);
  async function transcribe() {
    setTranscribing(true); setTranscribeError("");
    try {
      const r = await fetch("/api/clipping/transcribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draftId: source.draftId, url: videoUrl, durationMs }) });
      // A platform timeout (the function killed at its limit) is not JSON: say what it means.
      const text = await r.text();
      let j: { error?: string; words?: unknown } = {};
      try { j = JSON.parse(text); } catch { j = { error: r.status === 504 ? "The server was cut off after 5 minutes before it could answer: this video is too large to transcribe in one go." : `HTTP ${r.status}: ${text.slice(0, 160)}` }; }
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setWords(Array.isArray(j.words) ? j.words : []);
    } catch (e) { setTranscribeError(e instanceof Error ? e.message : String(e)); }
    finally { setTranscribing(false); }
  }
  const activeWordIdx = useMemo(() => words ? words.findIndex((w) => timeMs >= w.startMs && timeMs < w.endMs) : -1, [words, timeMs]);
  const windowWords = useMemo(() => (words && inMs != null && outMs != null) ? wordsInWindow(words, inMs, outMs) : [], [words, inMs, outMs]);
  const derivedScript = useMemo(() => windowWords.map((w) => w.text).join(" "), [windowWords]);
  const script = scriptOverride ?? derivedScript;

  // clip form
  const [platformChoice, setPlatformChoice] = useState<PlatformId>("instagram");
  const platform: PlatformId = enabledPlatforms.includes(platformChoice) ? platformChoice : (enabledPlatforms[0] ?? "instagram");
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [conceptId, setConceptId] = useState<number | "">("");
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/concepts?clientId=${client.id}&isIdea=false&platform=${platform}`).then((r) => r.json()).then((list) => {
      if (cancelled || !Array.isArray(list)) return;
      setConcepts(list);
      // Default: the concept of the same name as the source's on the target platform (concepts are
      // per platform, so the YouTube concept itself cannot be used). Otherwise the operator picks.
      const name = source.conceptName?.trim().toLowerCase();
      const match = name ? (list as Concept[]).find((c) => c.name.trim().toLowerCase() === name) : null;
      setConceptId(match ? match.id : "");
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [client.id, platform, source.conceptName]);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ draftId: number; editUrl: string; title: string } | null>(null);
  const [createError, setCreateError] = useState("");

  const clipLen = inMs != null && outMs != null ? outMs - inMs : 0;
  const windowOk = clipLen >= 1000 && clipLen <= CLIP_MAX_MS;
  const canCreate = !readOnly && windowOk && !!title.trim() && conceptId !== "" && !creating;

  async function createClip() {
    if (!canCreate || inMs == null || outMs == null) return;
    setCreating(true); setCreateError(""); setCreated(null);
    try {
      const r = await fetch("/api/clipping/clips", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceDraftId: source.draftId, sourceUrl: videoUrl, platform, conceptId, title: title.trim(), inMs, outMs, script, meta: { durationMs, width: meta?.width ?? null, height: meta?.height ?? null } }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setCreated({ draftId: j.draftId, editUrl: j.editUrl, title: title.trim() });
      setTitle(""); setInMs(null); setOutMs(null); setScriptOverride(null);
      onCreated();
    } catch (e) { setCreateError(e instanceof Error ? e.message : String(e)); }
    finally { setCreating(false); }
  }

  return (
    <>
      <p className="text-[11px] text-faint -mt-1">{durationMs ? fmtMs(durationMs) : ""}{meta ? ` · ${meta.width}×${meta.height}` : ""}</p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-3">
        {/* Player + marks (the player is media chrome: black backdrop, white text over it) */}
        <div className="space-y-3">
          <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
            {src ? (
              <video ref={videoRef} src={src} controls preload="metadata" playsInline className="w-full h-full"
                onLoadedMetadata={(e) => { const v = e.currentTarget; setDurationMs(Math.round(v.duration * 1000)); setMeta({ width: v.videoWidth, height: v.videoHeight }); }}
                onTimeUpdate={(e) => { const v = e.currentTarget; const t = Math.round(v.currentTime * 1000); setTimeMs(t); if (playingWindow && outMs != null && t >= outMs) { v.pause(); setPlayingWindow(false); } }}
                onError={() => setMediaError("This video could not be played in the browser.")} />
            ) : <div className="absolute inset-0 flex items-center justify-center text-white/60 text-xs">Loading video…</div>}
          </div>
          {mediaError && <p className="text-xs text-danger-500">{mediaError}</p>}
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="font-mono text-ink-2 w-16">{fmtMs(timeMs)}</span>
            <button onClick={markIn} disabled={!src} className="o-btn o-btn-ghost text-xs" title="Set the clip's start at the playhead (I)">⟦ In</button>
            <button onClick={markOut} disabled={!src || inMs == null} className="o-btn o-btn-ghost text-xs" title="Set the clip's end at the playhead (O)">Out ⟧</button>
            <button onClick={playWindow} disabled={inMs == null || outMs == null} className="o-btn o-btn-ghost text-xs" title="Play just the marked window">▶ Play window</button>
            <span className="text-faint ml-auto">
              {inMs != null ? <button onClick={() => seek(inMs)} className="font-mono text-ink-2 hover:text-accent">{fmtMs(inMs)}</button> : "—"}
              {" → "}
              {outMs != null ? <button onClick={() => seek(outMs)} className="font-mono text-ink-2 hover:text-accent">{fmtMs(outMs)}</button> : "—"}
              {clipLen > 0 && <span className={clipLen > CLIP_MAX_MS ? "text-danger-500" : ""}> · {fmtMs(clipLen)}</span>}
            </span>
          </div>
          {durationMs > 0 && (
            <div className="relative h-2 rounded-full bg-surface-4 cursor-pointer" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * durationMs); }} title="Click to seek">
              {inMs != null && <div className="absolute top-0 h-full bg-accent/40 rounded-full" style={{ left: `${(inMs / durationMs) * 100}%`, width: `${(Math.max(inMs, outMs ?? timeMs) - inMs) / durationMs * 100}%` }} />}
              <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-accent shadow" style={{ left: `calc(${(timeMs / durationMs) * 100}% - 6px)` }} />
            </div>
          )}
          <p className="text-[10px] text-faint">Keys: <kbd>I</kbd> in · <kbd>O</kbd> out · <kbd>space</kbd> play · <kbd>←</kbd>/<kbd>→</kbd> 1 s (⇧ 5 s). Click a word to jump to it.</p>
        </div>

        {/* Transcript */}
        <div className="flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-semibold text-faint uppercase tracking-wide">Transcript</p>
            {!readOnly && (
              <button onClick={transcribe} disabled={transcribing || !durationMs} className="o-btn o-btn-ghost text-xs">
                {transcribing ? "Transcribing…" : words ? "Re-transcribe" : "Transcribe"}
              </button>
            )}
          </div>
          {transcribeError && <p className="text-xs text-danger-500 mb-2">{transcribeError}</p>}
          {transcribing && <p className="text-xs text-muted mb-2">Extracting the audio on the server and transcribing with word timings. A long video takes a minute or two.</p>}
          {!words && !transcribing && <p className="text-xs text-muted">No transcript yet. Transcribe once; every clip cut from this video then reuses it, and the editor&apos;s captions come from the cache.</p>}
          {words && words.length === 0 && <p className="text-xs text-muted">No speech was found.</p>}
          {words && words.length > 0 && (
            <div className="rounded-xl border border-line bg-surface-2 p-3 text-sm leading-7 text-ink-2 overflow-y-auto" style={{ maxHeight: 360 }}>
              {words.map((w, i) => {
                const mid = (w.startMs + w.endMs) / 2;
                const inWin = inMs != null && outMs != null && mid >= inMs && mid < outMs;
                const active = i === activeWordIdx;
                return (
                  <span key={i} onClick={() => seek(w.startMs)}
                    className={`cursor-pointer rounded px-0.5 ${inWin ? "bg-accent-tint text-accent-strong" : ""} ${active ? "font-bold text-ink underline" : ""}`}>
                    {w.text}{" "}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* New clip */}
      {!readOnly && (
        <div className="mt-5 pt-4 border-t border-line-soft">
          <h3 className="text-sm font-semibold text-ink mb-3">New clip</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-ink-2 mb-1">Title</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What this clip is about"
                className="w-full border border-line rounded-lg px-3 py-2 text-sm text-ink bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-2 mb-1">Target platform</label>
              <select value={platform} onChange={(e) => setPlatformChoice(e.target.value as PlatformId)}
                className="w-full border border-line rounded-lg px-3 py-2 text-sm text-ink-2 bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40">
                {enabledPlatforms.map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-2 mb-1">Concept</label>
              <select value={conceptId} onChange={(e) => setConceptId(e.target.value ? parseInt(e.target.value) : "")}
                className="w-full border border-line rounded-lg px-3 py-2 text-sm text-ink-2 bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40">
                <option value="">Pick a concept…</option>
                {concepts.map((c) => <option key={c.id} value={c.id}>{c.conceptType ? `${c.conceptType} · ${c.name}` : c.name}</option>)}
              </select>
              {concepts.length === 0 && <p className="text-[10px] text-faint mt-1">No {PLATFORM_LABEL[platform]} concepts yet: add one in the Concept Library first.</p>}
            </div>
          </div>
          <div className="mt-3">
            <label className="block text-xs font-medium text-ink-2 mb-1">Script for the clip <span className="text-faint font-normal">(what is said between the marks; the editor&apos;s caption aligner uses it as ground truth)</span></label>
            <textarea rows={3} value={script} onChange={(e) => setScriptOverride(e.target.value)}
              placeholder={words ? (inMs == null || outMs == null ? "Mark in and out to fill this from the transcript." : "Nothing is said in this window.") : "Transcribe the video to fill this automatically, or type what is said."}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm text-ink-2 bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40" />
            {scriptOverride != null && scriptOverride !== derivedScript && derivedScript && (
              <button onClick={() => setScriptOverride(null)} className="text-[10px] text-accent hover:text-accent-strong mt-1">Reset to the transcript window</button>
            )}
          </div>
          <div className="flex items-center gap-3 mt-4 flex-wrap">
            <button onClick={createClip} disabled={!canCreate} className="o-btn o-btn-accent text-sm disabled:opacity-50">
              {creating ? "Creating…" : "Create clip → Edit stage"}
            </button>
            <span className="text-[11px] text-faint">
              {inMs == null || outMs == null ? "Mark in and out on the player." : !windowOk ? (clipLen < 1000 ? "A clip must be at least 1 second." : `A clip can be at most ${CLIP_MAX_MS / 60000} minutes.`) : !title.trim() ? "Give the clip a title." : conceptId === "" ? "Pick a concept." : `Lands in ${PLATFORM_LABEL[platform]}'s Edit stage, trimmed to ${fmtMs(inMs)}–${fmtMs(outMs)}.`}
            </span>
          </div>
          {createError && <p className="text-xs text-danger-500 mt-2">{createError}</p>}
          {created && (
            <div className="mt-3 rounded-lg bg-ok-50 border border-ok-200 px-3 py-2 text-xs text-ok-700 flex items-center justify-between gap-3">
              <span>✓ “{created.title}” created.</span>
              <a href={created.editUrl} className="font-semibold underline">Open in editor →</a>
            </div>
          )}
        </div>
      )}
    </>
  );
}
