"use client";

// Right-hand panel: edits whatever is selected (clip, caption cue, text element), or the
// document's caption style when nothing is. Every control maps 1:1 onto a CaptionStyle property;
// there are no controls for anything the parity table calls "not representable".
import { useState } from "react";
import { CAPTION_FONTS, type CaptionFontFamily, type CaptionStyle, DEFAULT_CAPTION_STYLE, normalizeCaptionStyle } from "@/features/editor/model/captionStyle";
import type { EditDocument, Transform } from "@/features/editor/model/document";
import { captionTrack, clipLengthMs, deleteClip, deleteCue, deleteText, mainTrack, overlayTrack, setCaptionStyle, textTrack, updateClip, updateCue, updateText } from "@/features/editor/model/timeline";
import type { Selection } from "./Timeline";
import { fmtTime } from "./Timeline";

type Props = {
  doc: EditDocument;
  selection: Selection;
  clientId: number;
  onChange: (doc: EditDocument, commit: boolean) => void;
  onSelect: (s: Selection) => void;
};

const inputCls = "w-full rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-accent";
const labelCls = "block text-[10px] font-semibold uppercase tracking-wide text-muted mb-1";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className={labelCls}>{label}</label>{children}</div>;
}
function Num({ value, onChange, min, max, step = 1, suffix }: { value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; suffix?: string }) {
  return (
    <div className="flex items-center gap-1">
      <input type="number" className={inputCls} value={Number.isFinite(value) ? +value.toFixed(step < 1 ? 2 : 0) : 0} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} />
      {suffix && <span className="text-[10px] text-faint">{suffix}</span>}
    </div>
  );
}
function Color({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-7 w-9 rounded border border-line bg-surface p-0.5" />
      <input className={inputCls} value={value} onChange={(e) => /^#[0-9a-fA-F]{6}$/.test(e.target.value) && onChange(e.target.value.toLowerCase())} />
    </div>
  );
}
function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-xs text-ink-2 cursor-pointer">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="accent-[var(--color-accent)]" />{label}
    </label>
  );
}
function Seg<T extends string>({ value, options, onChange }: { value: T; options: { v: T; l: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-md border border-line bg-surface p-0.5">
      {options.map((o) => (
        <button key={o.v} onClick={() => onChange(o.v)} className={`px-2 py-1 text-[11px] font-semibold rounded ${value === o.v ? "bg-accent text-on-accent" : "text-muted hover:text-ink-2"}`}>{o.l}</button>
      ))}
    </div>
  );
}

/** The caption-style form. Used for the document style and for a text element's own style. */
export function StyleEditor({ style, onChange, showLayout = true }: { style: CaptionStyle; onChange: (s: CaptionStyle) => void; showLayout?: boolean }) {
  const set = (patch: (s: CaptionStyle) => CaptionStyle) => onChange(normalizeCaptionStyle(patch(style), style));
  const family = style.font.family;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Font">
          <select className={inputCls} value={family} onChange={(e) => set((s) => ({ ...s, font: { ...s.font, family: e.target.value as CaptionFontFamily, weight: CAPTION_FONTS[e.target.value as CaptionFontFamily].weights[0] } }))}>
            {(Object.keys(CAPTION_FONTS) as CaptionFontFamily[]).map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </Field>
        <Field label="Size (px)"><Num value={style.font.sizePx} min={24} max={200} onChange={(n) => set((s) => ({ ...s, font: { ...s.font, sizePx: n } }))} /></Field>
        <Field label="Letter spacing"><Num value={style.font.letterSpacingPx} min={-10} max={40} onChange={(n) => set((s) => ({ ...s, font: { ...s.font, letterSpacingPx: n } }))} /></Field>
        <div className="flex flex-col gap-1 justify-end pb-1">
          <Toggle label="Uppercase" value={style.font.uppercase} onChange={(v) => set((s) => ({ ...s, font: { ...s.font, uppercase: v } }))} />
          <Toggle label="Italic" value={style.font.italic} onChange={(v) => set((s) => ({ ...s, font: { ...s.font, italic: v } }))} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Fill"><Color value={style.fill.color} onChange={(v) => set((s) => ({ ...s, fill: { color: v as CaptionStyle["fill"]["color"] } }))} /></Field>
        <Field label="Outline"><Color value={style.outline.color} onChange={(v) => set((s) => ({ ...s, outline: { ...s.outline, color: v as CaptionStyle["fill"]["color"] } }))} /></Field>
        <Field label="Outline width"><Num value={style.outline.widthPx} min={0} max={20} onChange={(n) => set((s) => ({ ...s, outline: { ...s.outline, widthPx: n } }))} /></Field>
        <Field label="Shadow offset"><Num value={style.shadow.offsetPx} min={0} max={20} onChange={(n) => set((s) => ({ ...s, shadow: { ...s.shadow, offsetPx: n } }))} /></Field>
        <Field label="Shadow"><Color value={style.shadow.color} onChange={(v) => set((s) => ({ ...s, shadow: { ...s.shadow, color: v as CaptionStyle["fill"]["color"] } }))} /></Field>
        <Field label="Shadow opacity"><Num value={style.shadow.opacity} min={0} max={1} step={0.05} onChange={(n) => set((s) => ({ ...s, shadow: { ...s.shadow, opacity: n } }))} /></Field>
      </div>
      <div className="rounded-lg border border-line-soft p-2 space-y-2">
        <Toggle label="Background box (per line)" value={style.box.enabled} onChange={(v) => set((s) => ({ ...s, box: { ...s.box, enabled: v } }))} />
        {style.box.enabled && (
          <div className="grid grid-cols-3 gap-2">
            <Field label="Colour"><Color value={style.box.color} onChange={(v) => set((s) => ({ ...s, box: { ...s.box, color: v as CaptionStyle["fill"]["color"] } }))} /></Field>
            <Field label="Opacity"><Num value={style.box.opacity} min={0} max={1} step={0.05} onChange={(n) => set((s) => ({ ...s, box: { ...s.box, opacity: n } }))} /></Field>
            <Field label="Padding"><Num value={style.box.paddingPx} min={0} max={60} onChange={(n) => set((s) => ({ ...s, box: { ...s.box, paddingPx: n } }))} /></Field>
          </div>
        )}
      </div>
      {showLayout && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Seg value={style.layout.anchor} options={[{ v: "top", l: "Top" }, { v: "middle", l: "Middle" }, { v: "bottom", l: "Bottom" }]} onChange={(v) => set((s) => ({ ...s, layout: { ...s.layout, anchor: v } }))} />
            <Seg value={style.layout.align} options={[{ v: "left", l: "L" }, { v: "center", l: "C" }, { v: "right", l: "R" }]} onChange={(v) => set((s) => ({ ...s, layout: { ...s.layout, align: v } }))} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Margin from edge (px)"><Num value={style.layout.marginVPx} min={0} max={1000} onChange={(n) => set((s) => ({ ...s, layout: { ...s.layout, marginVPx: n } }))} /></Field>
            <Field label="Side margin (px)"><Num value={style.layout.marginHPx} min={0} max={400} onChange={(n) => set((s) => ({ ...s, layout: { ...s.layout, marginHPx: n } }))} /></Field>
            <Field label="Max lines"><Seg value={String(style.layout.maxLines) as "1" | "2" | "3"} options={[{ v: "1", l: "1" }, { v: "2", l: "2" }, { v: "3", l: "3" }]} onChange={(v) => set((s) => ({ ...s, layout: { ...s.layout, maxLines: Number(v) as 1 | 2 | 3 } }))} /></Field>
            <Field label="Words per caption"><Num value={style.layout.wordsPerCue} min={1} max={6} onChange={(n) => set((s) => ({ ...s, layout: { ...s.layout, wordsPerCue: n } }))} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2 items-end">
            <Field label="Spoken word"><Seg value={style.highlight.mode} options={[{ v: "none", l: "Plain" }, { v: "color", l: "Colour" }]} onChange={(v) => set((s) => ({ ...s, highlight: { ...s.highlight, mode: v } }))} /></Field>
            {style.highlight.mode === "color" && <Field label="Highlight"><Color value={style.highlight.color} onChange={(v) => set((s) => ({ ...s, highlight: { ...s.highlight, color: v as CaptionStyle["fill"]["color"] } }))} /></Field>}
          </div>
        </div>
      )}
    </div>
  );
}

function TransformEditor({ t, onChange }: { t: Transform; onChange: (t: Transform) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="X (0–1)"><Num value={t.x} min={-0.5} max={1.5} step={0.01} onChange={(n) => onChange({ ...t, x: n })} /></Field>
      <Field label="Y (0–1)"><Num value={t.y} min={-0.5} max={1.5} step={0.01} onChange={(n) => onChange({ ...t, y: n })} /></Field>
      <Field label="Scale"><Num value={t.scale} min={0.05} max={5} step={0.05} onChange={(n) => onChange({ ...t, scale: Math.max(0.05, n) })} /></Field>
      <Field label="Opacity"><Num value={t.opacity} min={0} max={1} step={0.05} onChange={(n) => onChange({ ...t, opacity: n })} /></Field>
    </div>
  );
}

export default function Inspector({ doc, selection, clientId, onChange, onSelect }: Props) {
  const [savingDefault, setSavingDefault] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const commit = (d: EditDocument) => onChange(d, true);

  async function saveClientDefault() {
    setSavingDefault("saving");
    try {
      const r = await fetch(`/api/clients/${clientId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subtitleStyle: doc.captionStyle }) });
      setSavingDefault(r.ok ? "saved" : "error");
    } catch { setSavingDefault("error"); }
    setTimeout(() => setSavingDefault("idle"), 1500);
  }

  if (selection?.kind === "clip") {
    const track = [mainTrack(doc), overlayTrack(doc)].find((t) => t?.id === selection.trackId);
    const clip = track?.clips.find((c) => c.id === selection.id);
    if (!track || !clip) return null;
    const asset = doc.assets.find((a) => a.id === clip.assetId);
    const isOverlay = track.role === "overlay";
    return (
      <Panel title={isOverlay ? "B-roll clip" : "Clip"} onDelete={() => { commit(deleteClip(doc, track.id, clip.id)); onSelect(null); }}>
        <p className="text-xs text-ink-2 truncate" title={asset?.url}>{asset?.name}</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="In"><Num value={clip.inMs} min={0} max={clip.outMs - 100} step={10} suffix="ms" onChange={(n) => commit(updateClip(doc, track.id, clip.id, { inMs: Math.max(0, Math.min(clip.outMs - 100, n)) }))} /></Field>
          <Field label="Out"><Num value={clip.outMs} min={clip.inMs + 100} max={asset?.durationMs ?? undefined} step={10} suffix="ms" onChange={(n) => commit(updateClip(doc, track.id, clip.id, { outMs: Math.max(clip.inMs + 100, Math.min(asset?.durationMs ?? n, n)) }))} /></Field>
          {isOverlay && <Field label="Starts at"><Num value={clip.at} min={0} step={10} suffix="ms" onChange={(n) => commit(updateClip(doc, track.id, clip.id, { at: Math.max(0, n) }))} /></Field>}
          <Field label="Length"><div className="text-xs font-mono text-ink-2 py-1">{fmtTime(clipLengthMs(clip))}</div></Field>
        </div>
        {!isOverlay && (
          <div className="grid grid-cols-2 gap-2 items-end">
            <Toggle label="Mute" value={clip.muted} onChange={(v) => commit(updateClip(doc, track.id, clip.id, { muted: v }))} />
            <Field label="Volume"><Num value={clip.volume} min={0} max={1} step={0.05} onChange={(n) => commit(updateClip(doc, track.id, clip.id, { volume: n }))} /></Field>
          </div>
        )}
        <Field label="Position & size"><TransformEditor t={clip.transform} onChange={(t) => commit(updateClip(doc, track.id, clip.id, { transform: t }))} /></Field>
        {isOverlay && <p className="text-[10px] text-faint">B-roll is always silent (audio mixing is out of scope). Drag it on the preview to move it.</p>}
      </Panel>
    );
  }

  if (selection?.kind === "cue") {
    const track = captionTrack(doc);
    const cue = track?.kind === "caption" ? track.cues.find((q) => q.id === selection.id) : undefined;
    if (!cue) return null;
    return (
      <Panel title="Caption" onDelete={() => { commit(deleteCue(doc, cue.id)); onSelect(null); }}>
        <Field label={`Text (one line per row, max ${doc.captionStyle.layout.maxLines})`}>
          <textarea className={inputCls} rows={3} value={cue.lines.join("\n")}
            onChange={(e) => onChange(updateCue(doc, cue.id, { lines: e.target.value.split("\n").slice(0, doc.captionStyle.layout.maxLines), words: null }), false)}
            onBlur={() => commit(doc)} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Start"><Num value={cue.startMs} min={0} step={10} suffix="ms" onChange={(n) => commit(updateCue(doc, cue.id, { startMs: Math.max(0, Math.min(cue.endMs - 100, n)) }))} /></Field>
          <Field label="End"><Num value={cue.endMs} min={cue.startMs + 100} step={10} suffix="ms" onChange={(n) => commit(updateCue(doc, cue.id, { endMs: Math.max(cue.startMs + 100, n) }))} /></Field>
        </div>
        {cue.words && <p className="text-[10px] text-faint">{cue.words.length} timed words (editing the text drops word timing).</p>}
        <p className="text-[10px] text-faint">Captions use the document caption style. Deselect to edit it.</p>
      </Panel>
    );
  }

  if (selection?.kind === "text") {
    const track = textTrack(doc);
    const el = track?.kind === "text" ? track.elements.find((e) => e.id === selection.id) : undefined;
    if (!el) return null;
    return (
      <Panel title="Text" onDelete={() => { commit(deleteText(doc, el.id)); onSelect(null); }}>
        <Field label="Text">
          <textarea className={inputCls} rows={2} value={el.text} onChange={(e) => onChange(updateText(doc, el.id, { text: e.target.value }), false)} onBlur={() => commit(doc)} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Start"><Num value={el.startMs} min={0} step={10} suffix="ms" onChange={(n) => commit(updateText(doc, el.id, { startMs: Math.max(0, Math.min(el.endMs - 100, n)) }))} /></Field>
          <Field label="End"><Num value={el.endMs} min={el.startMs + 100} step={10} suffix="ms" onChange={(n) => commit(updateText(doc, el.id, { endMs: Math.max(el.startMs + 100, n) }))} /></Field>
        </div>
        <Field label="Position & size (drag on the preview too)"><TransformEditor t={el.transform} onChange={(t) => commit(updateText(doc, el.id, { transform: { ...t, rotation: 0 } }))} /></Field>
        <Field label="Look">
          <StyleEditor style={el.style} showLayout={false} onChange={(s) => commit(updateText(doc, el.id, { style: s }))} />
        </Field>
        <button className="o-btn o-btn-ghost text-xs" onClick={() => commit(updateText(doc, el.id, { style: doc.captionStyle }))}>Use the caption style</button>
      </Panel>
    );
  }

  return (
    <Panel title="Caption style">
      <p className="text-[10px] text-faint">One definition for the preview and the export. Anything not here cannot be rendered the same way twice, so it is not offered.</p>
      <StyleEditor style={doc.captionStyle} onChange={(s) => commit(setCaptionStyle(doc, s))} />
      <div className="flex gap-2 pt-1">
        <button className="o-btn o-btn-ghost text-xs" onClick={saveClientDefault} disabled={savingDefault === "saving"}>
          {savingDefault === "saved" ? "✓ Saved as client default" : savingDefault === "error" ? "Could not save" : "Save as this client's default"}
        </button>
        <button className="o-btn o-btn-ghost text-xs" onClick={() => commit(setCaptionStyle(doc, DEFAULT_CAPTION_STYLE))}>Reset</button>
      </div>
    </Panel>
  );
}

function Panel({ title, onDelete, children }: { title: string; onDelete?: () => void; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-ink"><span className="text-[10px] font-semibold uppercase tracking-wide text-muted block">{onDelete ? "Selected" : "Nothing selected"}</span>{title}</h3>
        {onDelete && <button onClick={onDelete} className="text-[11px] font-semibold text-danger-600 hover:text-danger-700">Delete</button>}
      </div>
      {children}
    </div>
  );
}

