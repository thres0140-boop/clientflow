"use client";

// The tab bar's contents, CapCut-style: the left panel shows whatever the active top tab is
// about, as a stack of rounded, collapsible section rows. Media is real (the project's clips,
// import, add to main or as b-roll); Text and Captions list what is on their tracks; the rest
// are honest empty states until their features are built, so the shape of the finished editor
// is visible now.
import { useRef, useState } from "react";
import type { EditDocument, Ms } from "@/features/editor/model/document";
import { captionTrack, textTrack } from "@/features/editor/model/timeline";
import type { AssetStatus } from "./usePlayback";
import type { Selection } from "./Timeline";
import { fmtTime } from "./Timeline";
import { uploadToR2 } from "./upload";
import { Icon, type IconName } from "./icons";

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

type Props = {
  tab: EditorTab;
  doc: EditDocument;
  status: Record<string, AssetStatus>;
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
};

/** A rounded, collapsible section row: header with chevron, title and an optional count. */
export function Section({ title, count, defaultOpen = true, action, children }: { title: string; count?: number; defaultOpen?: boolean; action?: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-line-soft bg-surface-2 overflow-hidden">
      <div className="flex items-center gap-2 px-2.5 h-9">
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 flex-1 min-w-0 text-left text-ink-2 hover:text-ink">
          <Icon name="chevron" size={14} className={`shrink-0 transition-transform ${open ? "" : "-rotate-90"}`} />
          <span className="text-[11px] font-semibold uppercase tracking-wide truncate">{title}</span>
          {count != null && <span className="text-[10px] font-mono text-faint">{count}</span>}
        </button>
        {action}
      </div>
      {open && <div className="px-2.5 pb-2.5">{children}</div>}
    </div>
  );
}

const smallBtn = "h-7 inline-flex items-center gap-1.5 px-2.5 rounded-md text-[11px] font-semibold border transition-colors";

export default function LeftPanel(p: Props) {
  const tab = EDITOR_TABS.find((t) => t.id === p.tab)!;
  if (p.tab === "media") return <MediaPanel {...p} />;
  if (p.tab === "text") return <TextPanel {...p} />;
  if (p.tab === "captions") return <CaptionsPanel {...p} />;
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6 gap-2">
      <span className="h-10 w-10 rounded-lg bg-surface-2 border border-line-soft flex items-center justify-center text-muted"><Icon name={tab.icon} size={18} /></span>
      <p className="text-sm font-semibold text-ink-2">{tab.label} — not built yet</p>
      <p className="text-xs text-faint">{tab.blurb}</p>
    </div>
  );
}

function MediaPanel({ doc, status, onAddToMain, onAddBroll, onUploaded, onRetry, onRemoveAsset }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState("");
  const usage = new Map<string, number>();
  for (const t of doc.tracks) if (t.kind === "video") for (const c of t.clips) usage.set(c.assetId, (usage.get(c.assetId) ?? 0) + 1);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setError(""); setPct(0);
    try { onUploaded(await uploadToR2(f, setPct), f.name); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setPct(null); }
  }

  const importBtn = (
    <button onClick={() => fileRef.current?.click()} disabled={pct !== null} className={`${smallBtn} bg-surface border-line text-ink-2 hover:text-ink hover:border-line-strong disabled:opacity-60`}>
      <Icon name="import" size={14} />{pct !== null ? `${pct}%` : "Import"}
    </button>
  );

  return (
    <div className="p-3 space-y-2.5">
      <input ref={fileRef} type="file" accept="video/*" hidden onChange={onFile} />
      <Section title="Your media" count={doc.assets.length} action={importBtn}>
        {error && <p className="text-xs text-danger-600 bg-danger-50 px-3 py-2 rounded-md mb-2">{error}</p>}
        <ul className="space-y-1.5">
          {doc.assets.map((a) => {
            const st = status[a.id];
            const failed = st?.state === "failed";
            const loading = !failed && a.durationMs == null;
            const n = usage.get(a.id) ?? 0;
            return (
              <li key={a.id} className={`rounded-md border p-2 ${failed ? "border-danger-200 bg-danger-50" : "border-line-soft bg-surface"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-ink truncate" title={a.url}>{a.name}</span>
                  <span className={`text-[10px] font-mono shrink-0 ${failed ? "text-danger-600" : "text-faint"}`}>{failed ? "failed" : loading ? "reading…" : fmtTime(a.durationMs!)}</span>
                </div>
                {failed && <p className="text-[10px] text-danger-600 mt-1">{st.reason}</p>}
                <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                  {failed ? (
                    <>
                      <button onClick={() => onRetry(a.id)} className={`${smallBtn} h-6 px-2 bg-surface border-line text-ink-2 hover:text-ink`}><Icon name="retry" size={12} />Retry</button>
                      <button onClick={() => onRemoveAsset(a.id)} className={`${smallBtn} h-6 px-2 bg-surface border-line text-danger-600`}><Icon name="trash" size={12} />Remove</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => onAddToMain(a.id)} disabled={loading} className={`${smallBtn} h-6 px-2 bg-hue-emerald-50 border-hue-emerald-200 text-hue-emerald-700 disabled:opacity-50`}>+ Main</button>
                      <button onClick={() => onAddBroll(a.id)} disabled={loading} className={`${smallBtn} h-6 px-2 bg-hue-sky-50 border-hue-sky-200 text-hue-sky-700 disabled:opacity-50`}>+ B-roll</button>
                    </>
                  )}
                  {n > 0 && <span className="text-[10px] text-faint ml-auto">×{n} on timeline</span>}
                </div>
              </li>
            );
          })}
          {doc.assets.length === 0 && <li className="text-xs text-faint py-4 text-center">No media yet. Raw clips uploaded to the draft land here.</li>}
        </ul>
      </Section>
      <Section title="Library" defaultOpen={false}>
        <p className="text-xs text-faint py-2">Stock b-roll and reusable client footage will live here.</p>
      </Section>
    </div>
  );
}

function TextPanel({ doc, selection, onSelect, onSeek, onAddText }: Props) {
  const track = textTrack(doc);
  const els = track?.kind === "text" ? track.elements : [];
  const addBtn = <button onClick={onAddText} className={`${smallBtn} bg-surface border-line text-ink-2 hover:text-ink hover:border-line-strong`}>+ Add</button>;
  return (
    <div className="p-3 space-y-2.5">
      <Section title="Text" action={addBtn}>
        <p className="text-[11px] text-faint py-1">Adds a text at the playhead. Its look is edited on the right once selected.</p>
      </Section>
      <Section title="On the timeline" count={els.length}>
        <ul className="space-y-1">
          {els.map((el) => (
            <li key={el.id}>
              <button onClick={() => { onSelect({ kind: "text", id: el.id }); onSeek(el.startMs); }}
                className={`w-full text-left rounded-md px-2 py-1.5 border ${selection?.kind === "text" && selection.id === el.id ? "border-hue-violet-500 bg-hue-violet-50" : "border-line-soft bg-surface hover:bg-surface-3"}`}>
                <div className="text-xs text-ink truncate">{el.text || "Text"}</div>
                <div className="text-[10px] font-mono text-faint">{fmtTime(el.startMs)} – {fmtTime(el.endMs)}</div>
              </button>
            </li>
          ))}
          {els.length === 0 && <li className="text-xs text-faint py-3 text-center">No text on the timeline.</li>}
        </ul>
      </Section>
      <Section title="Presets" defaultOpen={false}>
        <p className="text-xs text-faint py-2">Text presets and per-client styles are a later pass.</p>
      </Section>
    </div>
  );
}

function CaptionsPanel({ doc, selection, onSelect, onSeek, onAddCaption }: Props) {
  const track = captionTrack(doc);
  const cues = track?.kind === "caption" ? track.cues : [];
  const addBtn = <button onClick={onAddCaption} className={`${smallBtn} bg-surface border-line text-ink-2 hover:text-ink hover:border-line-strong`}>+ Add</button>;
  return (
    <div className="p-3 space-y-2.5">
      <Section title="Captions" action={addBtn}>
        <p className="text-[11px] text-faint py-1">Adds a caption at the playhead. Captions share the caption style on the right.</p>
      </Section>
      <Section title="Auto-captions" defaultOpen={false}>
        <p className="text-xs text-faint py-2">Word-timed captions from the transcript, styled per client, arrive in Phase 3.</p>
      </Section>
      <Section title="On the timeline" count={cues.length}>
        <ul className="space-y-1">
          {cues.map((q) => (
            <li key={q.id}>
              <button onClick={() => { onSelect({ kind: "cue", id: q.id }); onSeek(q.startMs); }}
                className={`w-full text-left rounded-md px-2 py-1.5 border ${selection?.kind === "cue" && selection.id === q.id ? "border-warn-500 bg-warn-50" : "border-line-soft bg-surface hover:bg-surface-3"}`}>
                <div className="text-xs text-ink truncate">{q.lines.join(" / ") || "…"}</div>
                <div className="text-[10px] font-mono text-faint">{fmtTime(q.startMs)} – {fmtTime(q.endMs)}</div>
              </button>
            </li>
          ))}
          {cues.length === 0 && <li className="text-xs text-faint py-3 text-center">No captions yet.</li>}
        </ul>
      </Section>
    </div>
  );
}
