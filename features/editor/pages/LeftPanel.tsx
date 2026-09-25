"use client";

// The tab bar's contents, CapCut-style: the left panel shows whatever the active top tab is
// about. Media is real (the project's clips, upload, add to main or as b-roll); Text and
// Captions list what is on their tracks; the rest are honest empty states until their features
// are built, so the shape of the finished editor is visible now.
import { useRef, useState } from "react";
import type { EditDocument, Ms } from "@/features/editor/model/document";
import { captionTrack, mainTrack, overlayTrack, textTrack } from "@/features/editor/model/timeline";
import type { AssetStatus } from "./usePlayback";
import type { Selection } from "./Timeline";
import { fmtTime } from "./Timeline";
import { uploadToR2 } from "./upload";

export const EDITOR_TABS = [
  { id: "media", label: "Media", blurb: "" },
  { id: "audio", label: "Audio", blurb: "Music, voice-over and sound effects on their own track." },
  { id: "text", label: "Text", blurb: "" },
  { id: "stickers", label: "Stickers", blurb: "Emoji, shapes and image stickers on the canvas." },
  { id: "effects", label: "Effects", blurb: "Zoom pops, shakes and other clip effects." },
  { id: "transitions", label: "Transitions", blurb: "Cuts, fades and wipes between main-track clips." },
  { id: "captions", label: "Captions", blurb: "" },
  { id: "filters", label: "Filters", blurb: "Colour looks applied to a clip." },
  { id: "adjust", label: "Adjust", blurb: "Brightness, contrast, saturation and the rest." },
  { id: "templates", label: "Templates", blurb: "Saved layouts of captions, text and b-roll to reuse per client." },
] as const;
export type EditorTab = (typeof EDITOR_TABS)[number]["id"];

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

const h2 = "text-[11px] font-semibold uppercase tracking-wide text-muted";

export default function LeftPanel(p: Props) {
  const tab = EDITOR_TABS.find((t) => t.id === p.tab)!;
  if (p.tab === "media") return <MediaPanel {...p} />;
  if (p.tab === "text") return <TextPanel {...p} />;
  if (p.tab === "captions") return <CaptionsPanel {...p} />;
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6">
      <p className="text-sm font-semibold text-ink-2">{tab.label} — not built yet</p>
      <p className="text-xs text-faint mt-1">{tab.blurb}</p>
    </div>
  );
}

function MediaPanel({ doc, status, onAddToMain, onAddBroll, onUploaded, onRetry, onRemoveAsset }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState("");
  const usage = new Map<string, number>();
  for (const t of doc.tracks) if (t.kind === "video") for (const c of t.clips) usage.set(c.assetId, (usage.get(c.assetId) ?? 0) + 1);
  void mainTrack; void overlayTrack;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setError(""); setPct(0);
    try { onUploaded(await uploadToR2(f, setPct), f.name); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setPct(null); }
  }

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className={h2}>Your media</span>
        <span className="text-[10px] text-faint">{doc.assets.length}</span>
      </div>
      <input ref={fileRef} type="file" accept="video/*" hidden onChange={onFile} />
      <button onClick={() => fileRef.current?.click()} disabled={pct !== null} className="o-btn o-btn-ghost w-full text-xs">
        {pct !== null ? `Uploading ${pct}%` : "⬆ Import a file"}
      </button>
      {error && <p className="text-xs text-danger-600 bg-danger-50 px-3 py-2 rounded-lg">{error}</p>}
      <ul className="space-y-1.5">
        {doc.assets.map((a) => {
          const st = status[a.id];
          const failed = st?.state === "failed";
          const loading = !failed && a.durationMs == null;
          const n = usage.get(a.id) ?? 0;
          return (
            <li key={a.id} className={`rounded-lg border p-2 ${failed ? "border-danger-200 bg-danger-50" : "border-line-soft bg-surface-2"}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-ink truncate" title={a.url}>{a.name}</span>
                <span className={`text-[10px] font-mono shrink-0 ${failed ? "text-danger-600" : "text-faint"}`}>{failed ? "failed" : loading ? "reading…" : fmtTime(a.durationMs!)}</span>
              </div>
              {failed && <p className="text-[10px] text-danger-600 mt-1">{st.reason}</p>}
              <div className="mt-1.5 flex items-center gap-1 flex-wrap">
                {failed ? (
                  <>
                    <button onClick={() => onRetry(a.id)} className="text-[10px] font-semibold text-ink-2 hover:text-ink px-1.5 py-0.5 rounded bg-surface border border-line">Retry</button>
                    <button onClick={() => onRemoveAsset(a.id)} className="text-[10px] font-semibold text-danger-600 px-1.5 py-0.5 rounded bg-surface border border-line">Remove</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => onAddToMain(a.id)} disabled={loading} className="text-[10px] font-semibold text-hue-emerald-700 px-1.5 py-0.5 rounded bg-hue-emerald-50 border border-hue-emerald-200 disabled:opacity-50">+ Main</button>
                    <button onClick={() => onAddBroll(a.id)} disabled={loading} className="text-[10px] font-semibold text-hue-sky-700 px-1.5 py-0.5 rounded bg-hue-sky-50 border border-hue-sky-200 disabled:opacity-50">+ B-roll at playhead</button>
                  </>
                )}
                {n > 0 && <span className="text-[10px] text-faint ml-auto">on timeline ×{n}</span>}
              </div>
            </li>
          );
        })}
        {doc.assets.length === 0 && <li className="text-xs text-faint py-4 text-center">No media yet. Raw clips uploaded to the draft land here.</li>}
      </ul>
    </div>
  );
}

function TextPanel({ doc, selection, onSelect, onSeek, onAddText }: Props) {
  const track = textTrack(doc);
  const els = track?.kind === "text" ? track.elements : [];
  return (
    <div className="p-3 space-y-3">
      <span className={h2}>Text</span>
      <button onClick={onAddText} className="o-btn o-btn-ghost w-full text-xs">+ Add text at playhead</button>
      <ul className="space-y-1">
        {els.map((el) => (
          <li key={el.id}>
            <button onClick={() => { onSelect({ kind: "text", id: el.id }); onSeek(el.startMs); }}
              className={`w-full text-left rounded-lg px-2 py-1.5 border ${selection?.kind === "text" && selection.id === el.id ? "border-hue-violet-500 bg-hue-violet-50" : "border-line-soft bg-surface-2 hover:bg-surface-3"}`}>
              <div className="text-xs text-ink truncate">{el.text || "Text"}</div>
              <div className="text-[10px] font-mono text-faint">{fmtTime(el.startMs)} – {fmtTime(el.endMs)}</div>
            </button>
          </li>
        ))}
        {els.length === 0 && <li className="text-xs text-faint py-3 text-center">No text on the timeline.</li>}
      </ul>
      <p className="text-[10px] text-faint">Text presets and per-client styles are a later pass; the look is edited on the right once a text is selected.</p>
    </div>
  );
}

function CaptionsPanel({ doc, selection, onSelect, onSeek, onAddCaption }: Props) {
  const track = captionTrack(doc);
  const cues = track?.kind === "caption" ? track.cues : [];
  return (
    <div className="p-3 space-y-3">
      <span className={h2}>Captions</span>
      <button onClick={onAddCaption} className="o-btn o-btn-ghost w-full text-xs">+ Add caption at playhead</button>
      <div className="rounded-lg border border-dashed border-line-2 p-2 text-[10px] text-faint">Auto-captions from the transcript (word-timed, styled per client) arrive in Phase 3.</div>
      <ul className="space-y-1">
        {cues.map((q) => (
          <li key={q.id}>
            <button onClick={() => { onSelect({ kind: "cue", id: q.id }); onSeek(q.startMs); }}
              className={`w-full text-left rounded-lg px-2 py-1.5 border ${selection?.kind === "cue" && selection.id === q.id ? "border-warn-500 bg-warn-50" : "border-line-soft bg-surface-2 hover:bg-surface-3"}`}>
              <div className="text-xs text-ink truncate">{q.lines.join(" / ") || "…"}</div>
              <div className="text-[10px] font-mono text-faint">{fmtTime(q.startMs)} – {fmtTime(q.endMs)}</div>
            </button>
          </li>
        ))}
        {cues.length === 0 && <li className="text-xs text-faint py-3 text-center">No captions yet.</li>}
      </ul>
    </div>
  );
}
