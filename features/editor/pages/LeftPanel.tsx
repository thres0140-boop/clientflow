"use client";

// The left panel, structured like CapCut's: its own header row IS the tab bar; below it a narrow
// secondary nav column, a content area with a toolbar row, and a footer bar. Media is real (the
// project's clips as thumbnails, a drop-zone import, add to main or as b-roll); Text and Captions
// list their tracks; every other tab, sub-nav entry and toolbar control that has no feature yet
// is rendered as a real, disabled control with a tooltip saying so — the shape of the finished
// thing, never a fake working button.
import { useRef, useState } from "react";
import type { EditDocument, Ms } from "@/features/editor/model/document";
import { captionTrack, textTrack } from "@/features/editor/model/timeline";
import type { AssetStatus } from "./usePlayback";
import type { Selection } from "./Timeline";
import { fmtTime } from "./Timeline";
import { uploadToR2 } from "./upload";
import { Icon, IconButton, type IconName } from "./icons";
import PresetGrid, { type PresetsApi } from "./PresetGrid";
import { TRANSITION_LABELS } from "./transitions";
import { TRANSITION_DEFAULT_MS, TRANSITION_TYPES, type TransitionType } from "@/features/editor/model/document";
import { mainTrack, transitionAfter } from "@/features/editor/model/timeline";

export const EDITOR_TABS: readonly { id: string; label: string; icon: IconName; blurb: string }[] = [
  { id: "media", label: "Media", icon: "media", blurb: "" },
  { id: "audio", label: "Audio", icon: "audio", blurb: "Music, voice-over and sound effects on their own track." },
  { id: "text", label: "Text", icon: "text", blurb: "" },
  { id: "stickers", label: "Stickers", icon: "stickers", blurb: "Emoji, shapes and image stickers on the canvas." },
  { id: "effects", label: "Effects", icon: "effects", blurb: "Zoom pops, shakes and other clip effects." },
  { id: "transitions", label: "Transitions", icon: "transitions", blurb: "Cuts, fades and wipes between main-track clips." },
  { id: "captions", label: "Captions", icon: "captions", blurb: "" },
  { id: "filters", label: "Filters", icon: "filters", blurb: "Colour looks applied to a clip." },
  { id: "adjust", label: "Adjust", icon: "adjust", blurb: "Brightness, contrast, saturation and the rest." },
  { id: "templates", label: "Templates", icon: "templates", blurb: "Saved layouts of captions, text and b-roll to reuse per client." },
] as const;
export type EditorTab = "media" | "audio" | "text" | "stickers" | "effects" | "transitions" | "captions" | "filters" | "adjust" | "templates";

export const NOT_BUILT = "Not built yet";

export type AutoCaptionsState = { phase: "idle" | "working" | "done" | "error"; message: string };
export type AutoCaptions = {
  state: AutoCaptionsState;
  canGenerate: boolean;
  hasScript: boolean;
  hasTranscript: boolean;
  useScript: boolean;
  setUseScript: (v: boolean) => void;
  generate: () => void;
  relayout: () => void;
};

type Props = {
  tab: EditorTab;
  onTab: (t: EditorTab) => void;
  doc: EditDocument;
  status: Record<string, AssetStatus>;
  thumbs: Record<string, string>;
  tMs: Ms;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onSeek: (t: Ms) => void;
  onAddToMain: (assetId: string) => void;
  onAddBroll: (assetId: string) => void;
  onUploaded: (url: string, name: string) => void;
  onRetry: (assetId: string) => void;
  onRemoveAsset: (assetId: string) => void;
  onAddCaption: () => void;
  onAddText: () => void;
  autoCaptions: AutoCaptions;
  presets: PresetsApi;
  still: string | null; // a poster frame from the project's first clip, behind the preset previews
  transitions: { apply: (type: TransitionType | null, durationMs: number, toAll: boolean) => void };
};

type SubNav = { id: string; label: string; disabled?: boolean };
const SUB_NAV: Record<EditorTab, SubNav[]> = {
  media: [{ id: "import", label: "Import" }, { id: "yours", label: "Yours" }, { id: "generate", label: "Generate", disabled: true }, { id: "spaces", label: "Spaces", disabled: true }, { id: "library", label: "Library", disabled: true }],
  audio: [{ id: "music", label: "Music", disabled: true }, { id: "sfx", label: "Sound FX", disabled: true }, { id: "voice", label: "Voice-over", disabled: true }],
  text: [{ id: "add", label: "Add text" }, { id: "timeline", label: "On timeline" }, { id: "presets", label: "Presets", disabled: true }],
  stickers: [{ id: "all", label: "All", disabled: true }],
  effects: [{ id: "all", label: "All", disabled: true }],
  transitions: [{ id: "all", label: "All" }],
  captions: [{ id: "auto", label: "Auto-captions" }, { id: "presets", label: "Presets" }, { id: "timeline", label: "On timeline" }, { id: "add", label: "Add" }],
  filters: [{ id: "all", label: "All", disabled: true }],
  adjust: [{ id: "all", label: "All", disabled: true }],
  templates: [{ id: "mine", label: "Mine", disabled: true }, { id: "client", label: "Per client", disabled: true }],
};

const pill = "h-8 w-full flex items-center justify-between gap-1 px-3 rounded-md text-xs font-semibold transition-colors";
const toolBtn = "h-8 inline-flex items-center gap-1.5 px-2.5 rounded-md text-[11px] font-semibold transition-colors";

export default function LeftPanel(p: Props) {
  const { tab, onTab } = p;
  const [subByTab, setSubByTab] = useState<Partial<Record<EditorTab, string>>>({});
  const subs = SUB_NAV[tab];
  const sub = subByTab[tab] ?? subs.find((s) => !s.disabled)?.id ?? subs[0].id;
  const setSub = (id: string) => setSubByTab((m) => ({ ...m, [tab]: id }));
  const tabDef = EDITOR_TABS.find((t) => t.id === tab)!;
  const tabsRef = useRef<HTMLDivElement>(null);

  return (
    <div className="h-full flex flex-col">
      {/* Header row = the tab bar: icon above label, quiet active state. */}
      <div className="h-[46px] shrink-0 flex items-stretch border-b border-line-soft">
        <div ref={tabsRef} className="flex-1 min-w-0 flex items-stretch overflow-x-auto [scrollbar-width:none] px-1">
          {EDITOR_TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button key={t.id} onClick={() => onTab(t.id as EditorTab)} title={t.label}
                className={`relative min-w-[58px] px-2 flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold whitespace-nowrap transition-colors ${active ? "text-accent" : "text-muted hover:text-ink"}`}>
                <Icon name={t.icon} />
                {t.label}
                {active && <span className="absolute left-2 right-2 bottom-0 h-0.5 rounded-full bg-accent" />}
              </button>
            );
          })}
        </div>
        <button onClick={() => tabsRef.current?.scrollBy({ left: 160, behavior: "smooth" })} title="More tabs" aria-label="Scroll tabs"
          className="w-6 shrink-0 flex items-center justify-center text-muted hover:text-ink border-l border-line-soft"><Icon name="chevronRight" size={14} /></button>
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* Secondary nav column */}
        <nav className="w-[124px] shrink-0 p-2 space-y-1.5 border-r border-line-soft overflow-y-auto">
          {subs.map((s) => (
            <button key={s.id} onClick={() => !s.disabled && setSub(s.id)} disabled={s.disabled} title={s.disabled ? NOT_BUILT : undefined}
              className={`${pill} ${sub === s.id && !s.disabled ? "bg-surface-3 text-accent" : "bg-surface-2 text-ink-2 hover:bg-surface-3"} disabled:opacity-40 disabled:cursor-not-allowed`}>
              <span className="truncate">{s.label}</span><Icon name="chevron" size={12} className="shrink-0 -rotate-90 opacity-60" />
            </button>
          ))}
        </nav>

        {/* Content area with its own toolbar row */}
        <div className="flex-1 min-w-0 flex flex-col">
          {tab === "media" ? <MediaContent {...p} sub={sub} />
            : tab === "text" ? <TextContent {...p} sub={sub} />
            : tab === "captions" ? <CaptionsContent {...p} sub={sub} />
            : tab === "transitions" ? <TransitionsContent {...p} />
            : (
              <>
                <Toolbar>
                  <button disabled title={NOT_BUILT} className={`${toolBtn} bg-surface-3 text-ink-2 disabled:opacity-40 disabled:cursor-not-allowed`}><Icon name="search" size={14} />Search</button>
                  <span className="flex-1" />
                  <IconButton name="grid" label={NOT_BUILT} disabled /><IconButton name="sort" label={NOT_BUILT} disabled /><IconButton name="filter" label={NOT_BUILT} disabled />
                </Toolbar>
                <div className="flex-1 flex flex-col items-center justify-center text-center px-6 gap-2">
                  <span className="h-10 w-10 rounded-md bg-surface-2 border border-line-soft flex items-center justify-center text-muted"><Icon name={tabDef.icon} size={18} /></span>
                  <p className="text-sm font-semibold text-ink-2">{tabDef.label} — not built yet</p>
                  <p className="text-xs text-faint">{tabDef.blurb}</p>
                </div>
              </>
            )}
        </div>
      </div>
    </div>
  );
}

function Toolbar({ children }: { children: React.ReactNode }) {
  return <div className="h-11 shrink-0 flex items-center gap-1.5 px-3 border-b border-line-soft">{children}</div>;
}
function Footer({ children }: { children: React.ReactNode }) {
  return <div className="h-11 shrink-0 flex items-center gap-2 px-3 border-t border-line-soft">{children}</div>;
}

function MediaContent({ doc, status, thumbs, sub, onAddToMain, onAddBroll, onUploaded, onRetry, onRemoveAsset }: Props & { sub: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [over, setOver] = useState(false);
  const usage = new Map<string, number>();
  for (const t of doc.tracks) if (t.kind === "video") for (const c of t.clips) usage.set(c.assetId, (usage.get(c.assetId) ?? 0) + 1);

  async function importFiles(files: File[]) {
    const videos = files.filter((f) => f.type.startsWith("video/") || /\.(mp4|mov|m4v|webm)$/i.test(f.name));
    if (!videos.length) return;
    setError(""); setPct(0);
    try {
      for (const f of videos) onUploaded(await uploadToR2(f, setPct), f.name); // one at a time; each lands in the library as it finishes
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setPct(null); }
  }

  return (
    <>
      <input ref={fileRef} type="file" accept="video/*" multiple hidden onChange={(e) => { const fs = Array.from(e.target.files || []); e.target.value = ""; importFiles(fs); }} />
      <Toolbar>
        <button onClick={() => fileRef.current?.click()} disabled={pct !== null} className={`${toolBtn} bg-surface-3 text-ink hover:bg-surface-4 disabled:opacity-60`}>
          <Icon name="plus" size={14} />{pct !== null ? `${pct}%` : "Import"}
        </button>
        <button disabled title={`Record — ${NOT_BUILT.toLowerCase()}`} className={`${toolBtn} bg-surface-3 text-ink-2 disabled:opacity-40 disabled:cursor-not-allowed`}><Icon name="record" size={14} />Record</button>
        <span className="flex-1" />
        <IconButton name="search" label={NOT_BUILT} disabled />
        <IconButton name="grid" label={NOT_BUILT} disabled />
        <IconButton name="sort" label={NOT_BUILT} disabled />
        <IconButton name="filter" label={NOT_BUILT} disabled />
      </Toolbar>

      <div className="flex-1 min-h-0 overflow-y-auto p-3"
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); importFiles(Array.from(e.dataTransfer.files || [])); }}>
        {sub === "import" && (
          <div role="button" tabIndex={0}
            onClick={() => pct === null && fileRef.current?.click()}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileRef.current?.click(); } }}
            className={`mb-3 rounded-md border border-dashed px-3 py-3 flex items-center gap-3 cursor-pointer transition-colors ${over ? "border-accent bg-accent-tint" : "border-line-2 bg-surface-2 hover:border-line-strong"}`}>
            <span className="h-8 w-8 rounded-md bg-surface-3 flex items-center justify-center text-ink-2 shrink-0"><Icon name="import" /></span>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-ink">{pct !== null ? `Uploading ${pct}%` : "Import"}</div>
              <div className="text-[10px] text-faint truncate">{pct !== null ? "to Cloudflare R2, in 8 MB parts" : "Drop videos here, or click"}</div>
            </div>
          </div>
        )}
        {error && <p className="text-xs text-danger-600 bg-danger-50 px-3 py-2 rounded-md mb-3">{error}</p>}
        <div className="text-[11px] font-semibold text-ink-2 mb-2">All</div>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2">
          {doc.assets.map((a) => {
            const st = status[a.id];
            const failed = st?.state === "failed";
            const loading = !failed && a.durationMs == null;
            const n = usage.get(a.id) ?? 0;
            const thumb = thumbs[a.id];
            return (
              <li key={a.id} className={`group rounded-md border overflow-hidden ${failed ? "border-danger-200" : "border-line-soft"} bg-surface-2`}>
                <div className="relative aspect-[9/16] bg-black">
                  {/* Media thumbnail: black backdrop and white text over it stay literal (dark-mode doc, media rule). */}
                  {thumb ? <img src={thumb} alt="" className="absolute inset-0 w-full h-full object-cover" /> : (
                    <div className="absolute inset-0 flex items-center justify-center text-white/40"><Icon name="media" size={20} /></div>
                  )}
                  {!failed && a.durationMs != null && <span className="absolute bottom-1 right-1 text-[10px] font-mono text-white bg-black/60 rounded px-1">{fmtTime(a.durationMs).replace(/\.\d+$/, "")}</span>}
                  {loading && <span className="absolute bottom-1 left-1 text-[10px] text-white/80 bg-black/60 rounded px-1">reading…</span>}
                  {failed && <span className="absolute inset-x-1 bottom-1 text-[10px] text-white bg-danger-600/90 rounded px-1 truncate" title={st.reason}>failed</span>}
                  {n > 0 && <span className="absolute top-1 left-1 text-[10px] font-semibold text-white bg-black/60 rounded px-1">×{n}</span>}
                  {!failed && !loading && (
                    <div className="absolute inset-x-1 top-1 flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => onAddToMain(a.id)} title="Add to the main track" className="h-6 px-1.5 rounded text-[10px] font-semibold bg-accent text-on-accent">+ Main</button>
                      <button onClick={() => onAddBroll(a.id)} title="Add as b-roll at the playhead" className="h-6 px-1.5 rounded text-[10px] font-semibold bg-surface text-ink border border-line">+ B-roll</button>
                    </div>
                  )}
                </div>
                <div className="px-1.5 py-1">
                  <div className="text-[11px] text-ink truncate" title={a.name}>{a.name}</div>
                  {failed ? (
                    <div className="mt-1 flex gap-1">
                      <button onClick={() => onRetry(a.id)} className="h-6 px-1.5 rounded-md text-[10px] font-semibold bg-surface text-ink-2 border border-line hover:text-ink inline-flex items-center gap-1"><Icon name="retry" size={12} />Retry</button>
                      <button onClick={() => onRemoveAsset(a.id)} title="Remove" className="h-6 px-1.5 rounded-md text-[10px] font-semibold bg-surface text-danger-600 border border-line inline-flex items-center"><Icon name="trash" size={12} /></button>
                    </div>
                  ) : (
                    <div className="text-[10px] text-faint truncate">{a.width && a.height ? `${a.width}×${a.height}` : loading ? "reading length…" : "video"}</div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {doc.assets.length === 0 && <p className="text-xs text-faint py-6 text-center">No media yet. Raw clips uploaded to the draft land here.</p>}
      </div>

      <Footer>
        <button disabled title={NOT_BUILT} className={`${toolBtn} px-1 text-accent disabled:opacity-40 disabled:cursor-not-allowed`}><Icon name="sparkle" size={14} />AI clipper</button>
        <span className="flex-1" />
        <span className="text-[11px] text-muted">{doc.assets.length} item{doc.assets.length === 1 ? "" : "s"}</span>
        <button disabled title={NOT_BUILT} className={`${toolBtn} bg-accent text-on-accent disabled:opacity-40 disabled:cursor-not-allowed`}>Make clips</button>
      </Footer>
    </>
  );
}

function TextContent({ doc, sub, selection, onSelect, onSeek, onAddText }: Props & { sub: string }) {
  const track = textTrack(doc);
  const els = track?.kind === "text" ? track.elements : [];
  return (
    <>
      <Toolbar>
        <button onClick={onAddText} className={`${toolBtn} bg-surface-3 text-ink hover:bg-surface-4`}><Icon name="plus" size={14} />Add text</button>
        <span className="flex-1" />
        <IconButton name="search" label={NOT_BUILT} disabled />
      </Toolbar>
      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {sub === "add" ? (
          <p className="text-[11px] text-faint">Adds a text at the playhead. Its look is edited on the right once selected. Presets are not built yet.</p>
        ) : (
          <ul className="space-y-1">
            {els.map((el) => (
              <li key={el.id}>
                <button onClick={() => { onSelect({ kind: "text", id: el.id }); onSeek(el.startMs); }}
                  className={`w-full text-left rounded-md px-2 py-1.5 border ${selection?.kind === "text" && selection.id === el.id ? "border-hue-violet-500 bg-hue-violet-50" : "border-line-soft bg-surface-2 hover:bg-surface-3"}`}>
                  <div className="text-xs text-ink truncate">{el.text || "Text"}</div>
                  <div className="text-[10px] font-mono text-faint">{fmtTime(el.startMs)} – {fmtTime(el.endMs)}</div>
                </button>
              </li>
            ))}
            {els.length === 0 && <li className="text-xs text-faint py-3 text-center">No text on the timeline.</li>}
          </ul>
        )}
      </div>
      <Footer><span className="text-[11px] text-muted">{els.length} text{els.length === 1 ? "" : "s"} on the timeline</span></Footer>
    </>
  );
}

const TRANSITION_GLYPH: Record<TransitionType, string> = { fade: "◐", fadeblack: "◼", slideleft: "←", slideright: "→", slideup: "↑", slidedown: "↓", zoomin: "⤢" };

function TransitionsContent({ doc, selection, transitions, onSelect }: Props) {
  const [duration, setDuration] = useState(TRANSITION_DEFAULT_MS);
  const main = mainTrack(doc);
  const boundaries = Math.max(0, main.clips.length - 1);
  const sel = selection?.kind === "transition" ? selection.afterClipId : null;
  const current = sel ? transitionAfter(main, sel) : undefined;
  const card = (type: TransitionType | null) => {
    const active = sel ? (type === null ? !current : current?.type === type) : false;
    return (
      <button key={type ?? "none"} onClick={() => transitions.apply(type, duration, !sel)} disabled={boundaries === 0}
        title={sel ? `Apply to the selected cut` : `Apply to every cut (${boundaries})`}
        className={`rounded-md border p-2 text-left ${active ? "border-accent bg-accent-tint" : "border-line-soft bg-surface-2 hover:bg-surface-3"} disabled:opacity-40`}>
        <div className="h-10 rounded bg-black flex items-center justify-center text-white text-lg">{type ? TRANSITION_GLYPH[type] : "|"}</div>
        <div className="mt-1 text-[11px] text-ink truncate">{type ? TRANSITION_LABELS[type] : "None (cut)"}</div>
      </button>
    );
  };
  return (
    <>
      <Toolbar>
        <span className="text-[11px] text-ink-2">Duration</span>
        <input type="number" min={100} max={3000} step={50} value={duration} onChange={(e) => setDuration(Math.max(100, Number(e.target.value) || TRANSITION_DEFAULT_MS))} className="w-20 h-8 rounded-md border border-line bg-surface px-2 text-xs text-ink" aria-label="Transition duration in ms" />
        <span className="text-[10px] text-faint">ms · capped at half the shorter clip</span>
        <span className="flex-1" />
        <IconButton name="search" label={NOT_BUILT} disabled />
      </Toolbar>
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        <p className="text-[11px] text-faint">{boundaries === 0 ? "Add a second clip to the main track to get a cut to transition over." : sel ? "Applies to the selected cut on the timeline." : `No cut selected: applies to all ${boundaries} cut${boundaries === 1 ? "" : "s"}. Click a cut marker on the timeline to target one.`}</p>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">{[null, ...TRANSITION_TYPES].map(card)}</div>
        {boundaries > 0 && (
          <div>
            <div className="text-[11px] font-semibold text-ink-2 mb-1.5">Cuts</div>
            <ul className="space-y-1">
              {main.clips.slice(0, -1).map((c, i) => {
                const tr = transitionAfter(main, c.id);
                const a = doc.assets.find((x) => x.id === c.assetId)?.name ?? "clip", b = doc.assets.find((x) => x.id === main.clips[i + 1].assetId)?.name ?? "clip";
                return (
                  <li key={c.id}>
                    <button onClick={() => onSelect({ kind: "transition", afterClipId: c.id })} className={`w-full text-left rounded-md px-2 py-1.5 border text-xs ${sel === c.id ? "border-accent bg-accent-tint" : "border-line-soft bg-surface-2 hover:bg-surface-3"}`}>
                      <span className="text-ink truncate">{a} → {b}</span>
                      <span className="block text-[10px] font-mono text-faint">{tr ? `${TRANSITION_LABELS[tr.type]} · ${tr.durationMs} ms` : "cut"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <p className="text-[10px] text-faint">Exports as ffmpeg xfade with the same name and duration; the preview approximates it with the two clips overlapping.</p>
      </div>
      <Footer><span className="text-[11px] text-muted">{main.transitions.length} transition{main.transitions.length === 1 ? "" : "s"} on {boundaries} cut{boundaries === 1 ? "" : "s"}</span></Footer>
    </>
  );
}

function CaptionsContent({ doc, sub, selection, onSelect, onSeek, onAddCaption, autoCaptions: ac, presets, still }: Props & { sub: string }) {
  const track = captionTrack(doc);
  const cues = track?.kind === "caption" ? track.cues : [];
  const working = ac.state.phase === "working";
  return (
    <>
      <Toolbar>
        <button onClick={ac.generate} disabled={!ac.canGenerate || working} title={ac.canGenerate ? "Transcribe the main track with word timings and lay the captions out" : "Add clips to the main track first"}
          className={`${toolBtn} bg-accent text-on-accent hover:bg-accent-strong disabled:opacity-50 disabled:cursor-not-allowed`}>
          <Icon name="sparkle" size={14} />{working ? "Generating…" : ac.hasTranscript ? "Regenerate" : "Generate captions"}
        </button>
        <button onClick={onAddCaption} className={`${toolBtn} bg-surface-3 text-ink hover:bg-surface-4`}><Icon name="plus" size={14} />Add</button>
        <span className="flex-1" />
        <IconButton name="search" label={NOT_BUILT} disabled />
      </Toolbar>
      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {sub === "auto" ? (
          <div className="space-y-3">
            <p className="text-[11px] text-faint">Audio is extracted on the server straight from the clip in R2 and transcribed by Whisper with word timings in the client&apos;s language. Words become captions using the caption style&apos;s words-per-caption and max lines; every caption stays editable. Transcripts are cached per clip, so regenerating is free unless the footage changed. Ceiling: 15 minutes of main track.</p>
            <label className={`flex items-start gap-2 text-xs ${ac.hasScript ? "text-ink-2 cursor-pointer" : "text-faint cursor-not-allowed"}`} title={ac.hasScript ? "Use the draft's hook and script for the wording; Whisper only supplies the timing" : "This draft has no script to align to"}>
              <input type="checkbox" className="mt-0.5 accent-[var(--color-accent)]" checked={ac.useScript && ac.hasScript} disabled={!ac.hasScript} onChange={(e) => ac.setUseScript(e.target.checked)} />
              <span>Use the script&apos;s wording<span className="block text-[10px] text-faint">Whisper for when, the script for what. Falls back to Whisper&apos;s words where the speaker improvised, and entirely if the script was not followed.</span></span>
            </label>
            {ac.state.phase !== "idle" && (
              <p className={`text-[11px] rounded-md px-3 py-2 ${ac.state.phase === "error" ? "text-danger-600 bg-danger-50" : ac.state.phase === "working" ? "text-ink-2 bg-surface-2" : "text-ink-2 bg-surface-2"}`}>{ac.state.message}</p>
            )}
            <button onClick={ac.relayout} disabled={!ac.hasTranscript || working} title="Re-chunk the cached transcript with the current caption style (words per caption, max lines) and the current clips"
              className={`${toolBtn} bg-surface-3 text-ink hover:bg-surface-4 disabled:opacity-40 disabled:cursor-not-allowed`}><Icon name="retry" size={14} />Re-layout with current style</button>
          </div>
        ) : sub === "presets" ? (
          <PresetGrid api={presets} still={still} />
        ) : sub === "add" ? (
          <p className="text-[11px] text-faint">Adds a caption at the playhead. Captions share the caption style on the right; a selected caption can override it.</p>
        ) : (
          <ul className="space-y-1">
            {cues.map((q) => (
              <li key={q.id}>
                <button onClick={() => { onSelect({ kind: "cue", id: q.id }); onSeek(q.startMs); }}
                  className={`w-full text-left rounded-md px-2 py-1.5 border ${selection?.kind === "cue" && selection.id === q.id ? "border-warn-500 bg-warn-50" : "border-line-soft bg-surface-2 hover:bg-surface-3"}`}>
                  <div className="text-xs text-ink truncate">{q.lines.join(" / ") || "…"}</div>
                  <div className="text-[10px] font-mono text-faint">{fmtTime(q.startMs)} – {fmtTime(q.endMs)}</div>
                </button>
              </li>
            ))}
            {cues.length === 0 && <li className="text-xs text-faint py-3 text-center">No captions yet.</li>}
          </ul>
        )}
      </div>
      <Footer><span className="text-[11px] text-muted">{cues.length} caption{cues.length === 1 ? "" : "s"} on the timeline</span></Footer>
    </>
  );
}
