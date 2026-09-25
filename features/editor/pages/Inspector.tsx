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
import { Icon } from "./icons";
import { alignedCentre, type Box, clipBox, textBox } from "@/features/editor/render/chrome";

type Props = {
  doc: EditDocument;
  selection: Selection;
  clientId: number;
  onChange: (doc: EditDocument, commit: boolean) => void;
  onSelect: (s: Selection) => void;
};

const inputCls = "w-full h-8 rounded-md border border-line bg-surface px-2 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-accent";
const areaCls = "w-full rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-accent";
const labelCls = "block text-[10px] font-semibold uppercase tracking-wide text-muted mb-1";

function Field({ label, children, span }: { label: string; children: React.ReactNode; span?: boolean }) {
  return <div className={span ? "col-span-2" : ""}><label className={labelCls}>{label}</label>{children}</div>;
}
/** A labelled group with a divider above: the panel's vertical rhythm. */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="pt-4 border-t border-line-soft first:pt-0 first:border-t-0">
      <h4 className="text-[10px] font-semibold uppercase tracking-wide text-faint mb-3">{title}</h4>
      <div className="grid grid-cols-2 gap-x-3 gap-y-3">{children}</div>
    </section>
  );
}
function Num({ value, onChange, min, max, step = 1, suffix }: { value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; suffix?: string }) {
  return (
    <div className="relative">
      <input type="number" className={`${inputCls} ${suffix ? "pr-8" : ""}`} value={Number.isFinite(value) ? +value.toFixed(step < 1 ? 2 : 0) : 0} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} />
      {suffix && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-faint pointer-events-none">{suffix}</span>}
    </div>
  );
}
function Color({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-9 shrink-0 rounded-md border border-line bg-surface p-0.5" />
      <input className={inputCls} value={value} onChange={(e) => /^#[0-9a-fA-F]{6}$/.test(e.target.value) && onChange(e.target.value.toLowerCase())} />
    </div>
  );
}
function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 h-8 text-xs text-ink-2 cursor-pointer">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="accent-[var(--color-accent)]" />{label}
    </label>
  );
}
function Seg<T extends string>({ value, options, onChange }: { value: T; options: { v: T; l: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex h-8 rounded-md border border-line bg-surface p-0.5 w-full">
      {options.map((o) => (
        <button key={o.v} onClick={() => onChange(o.v)} className={`flex-1 px-2 text-[11px] font-semibold rounded ${value === o.v ? "bg-accent text-on-accent" : "text-muted hover:text-ink-2"}`}>{o.l}</button>
      ))}
    </div>
  );
}

/** The caption-style form. Used for the document style and for a text element's own style. */
export function StyleEditor({ style, onChange, showLayout = true }: { style: CaptionStyle; onChange: (s: CaptionStyle) => void; showLayout?: boolean }) {
  const set = (patch: (s: CaptionStyle) => CaptionStyle) => onChange(normalizeCaptionStyle(patch(style), style));
  const family = style.font.family;
  const hex = (v: string) => v as CaptionStyle["fill"]["color"];
  return (
    <div className="space-y-4">
      <Group title="Font">
        <Field label="Family" span>
          <select className={inputCls} value={family} onChange={(e) => set((s) => ({ ...s, font: { ...s.font, family: e.target.value as CaptionFontFamily, weight: CAPTION_FONTS[e.target.value as CaptionFontFamily].weights[0] } }))}>
            {(Object.keys(CAPTION_FONTS) as CaptionFontFamily[]).map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </Field>
        <Field label="Size"><Num value={style.font.sizePx} min={24} max={200} suffix="px" onChange={(n) => set((s) => ({ ...s, font: { ...s.font, sizePx: n } }))} /></Field>
        <Field label="Letter spacing"><Num value={style.font.letterSpacingPx} min={-10} max={40} suffix="px" onChange={(n) => set((s) => ({ ...s, font: { ...s.font, letterSpacingPx: n } }))} /></Field>
        <Toggle label="Uppercase" value={style.font.uppercase} onChange={(v) => set((s) => ({ ...s, font: { ...s.font, uppercase: v } }))} />
        <Toggle label="Italic" value={style.font.italic} onChange={(v) => set((s) => ({ ...s, font: { ...s.font, italic: v } }))} />
      </Group>
      <Group title="Colour">
        <Field label="Fill" span><Color value={style.fill.color} onChange={(v) => set((s) => ({ ...s, fill: { color: hex(v) } }))} /></Field>
      </Group>
      <Group title="Outline & shadow">
        <Field label="Outline colour"><Color value={style.outline.color} onChange={(v) => set((s) => ({ ...s, outline: { ...s.outline, color: hex(v) } }))} /></Field>
        <Field label="Outline width"><Num value={style.outline.widthPx} min={0} max={20} suffix="px" onChange={(n) => set((s) => ({ ...s, outline: { ...s.outline, widthPx: n } }))} /></Field>
        <Field label="Shadow colour"><Color value={style.shadow.color} onChange={(v) => set((s) => ({ ...s, shadow: { ...s.shadow, color: hex(v) } }))} /></Field>
        <Field label="Shadow offset"><Num value={style.shadow.offsetPx} min={0} max={20} suffix="px" onChange={(n) => set((s) => ({ ...s, shadow: { ...s.shadow, offsetPx: n } }))} /></Field>
        <Field label="Shadow opacity"><Num value={style.shadow.opacity} min={0} max={1} step={0.05} onChange={(n) => set((s) => ({ ...s, shadow: { ...s.shadow, opacity: n } }))} /></Field>
      </Group>
      <Group title="Background box">
        <div className="col-span-2"><Toggle label="Box behind each line" value={style.box.enabled} onChange={(v) => set((s) => ({ ...s, box: { ...s.box, enabled: v } }))} /></div>
        {style.box.enabled && (
          <>
            <Field label="Colour" span><Color value={style.box.color} onChange={(v) => set((s) => ({ ...s, box: { ...s.box, color: hex(v) } }))} /></Field>
            <Field label="Opacity"><Num value={style.box.opacity} min={0} max={1} step={0.05} onChange={(n) => set((s) => ({ ...s, box: { ...s.box, opacity: n } }))} /></Field>
            <Field label="Padding"><Num value={style.box.paddingPx} min={0} max={60} suffix="px" onChange={(n) => set((s) => ({ ...s, box: { ...s.box, paddingPx: n } }))} /></Field>
          </>
        )}
      </Group>
      {showLayout && (
        <>
          <Group title="Layout">
            <Field label="Anchor" span><Seg value={style.layout.anchor} options={[{ v: "top", l: "Top" }, { v: "middle", l: "Middle" }, { v: "bottom", l: "Bottom" }]} onChange={(v) => set((s) => ({ ...s, layout: { ...s.layout, anchor: v } }))} /></Field>
            <Field label="Align" span><Seg value={style.layout.align} options={[{ v: "left", l: "Left" }, { v: "center", l: "Centre" }, { v: "right", l: "Right" }]} onChange={(v) => set((s) => ({ ...s, layout: { ...s.layout, align: v } }))} /></Field>
            <Field label="From edge"><Num value={style.layout.marginVPx} min={0} max={1000} suffix="px" onChange={(n) => set((s) => ({ ...s, layout: { ...s.layout, marginVPx: n } }))} /></Field>
            <Field label="Side margin"><Num value={style.layout.marginHPx} min={0} max={400} suffix="px" onChange={(n) => set((s) => ({ ...s, layout: { ...s.layout, marginHPx: n } }))} /></Field>
            <Field label="Max lines"><Seg value={String(style.layout.maxLines) as "1" | "2" | "3"} options={[{ v: "1", l: "1" }, { v: "2", l: "2" }, { v: "3", l: "3" }]} onChange={(v) => set((s) => ({ ...s, layout: { ...s.layout, maxLines: Number(v) as 1 | 2 | 3 } }))} /></Field>
            <Field label="Words per caption"><Num value={style.layout.wordsPerCue} min={1} max={6} onChange={(n) => set((s) => ({ ...s, layout: { ...s.layout, wordsPerCue: n } }))} /></Field>
          </Group>
          <Group title="Spoken word">
            <Field label="Highlight" span={style.highlight.mode !== "color"}><Seg value={style.highlight.mode} options={[{ v: "none", l: "Plain" }, { v: "color", l: "Colour" }]} onChange={(v) => set((s) => ({ ...s, highlight: { ...s.highlight, mode: v } }))} /></Field>
            {style.highlight.mode === "color" && <Field label="Colour"><Color value={style.highlight.color} onChange={(v) => set((s) => ({ ...s, highlight: { ...s.highlight, color: hex(v) } }))} /></Field>}
          </Group>
        </>
      )}
    </div>
  );
}

/** CapCut's Transform block: scale (slider + number), position X/Y as px from the canvas centre,
 *  rotation, the keep-aspect toggle (disabled: the model has one uniform scale), and alignment.
 *  Writes the same Transform the preview handles write, so the two never disagree. */
function TransformBlock({ doc, t, box, onChange }: { doc: EditDocument; t: Transform; box: Box | null; onChange: (t: Transform) => void }) {
  const W = doc.canvas.width, H = doc.canvas.height;
  const alignBtn = (label: string, icon: string, h: "left" | "center" | "right" | null, v: "top" | "middle" | "bottom" | null) => (
    <button key={label} title={label} disabled={!box} onClick={() => box && onChange(alignedCentre(doc, box, t, h, v))}
      className="h-8 flex-1 rounded-md border border-line bg-surface text-[11px] font-semibold text-ink-2 hover:text-ink hover:bg-surface-3 disabled:opacity-40">{icon}</button>
  );
  return (
    <Group title="Transform">
      <Field label="Scale" span>
        <div className="flex items-center gap-2">
          <input type="range" min={5} max={300} value={Math.round(t.scale * 100)} onChange={(e) => onChange({ ...t, scale: Number(e.target.value) / 100 })} className="flex-1 h-8 accent-[var(--color-accent)]" aria-label="Scale" />
          <div className="w-24"><Num value={Math.round(t.scale * 100)} min={5} max={500} suffix="%" onChange={(n) => onChange({ ...t, scale: Math.max(0.05, n / 100) })} /></div>
        </div>
      </Field>
      <Field label="Position X"><Num value={Math.round((t.x - 0.5) * W)} step={1} suffix="px" onChange={(n) => onChange({ ...t, x: 0.5 + n / W })} /></Field>
      <Field label="Position Y"><Num value={Math.round((t.y - 0.5) * H)} step={1} suffix="px" onChange={(n) => onChange({ ...t, y: 0.5 + n / H })} /></Field>
      <Field label="Rotation">
        <div className="flex items-center gap-1">
          <Num value={t.rotation} min={-180} max={180} step={1} suffix="°" onChange={(n) => onChange({ ...t, rotation: Math.max(-180, Math.min(180, n)) })} />
          <button title="Reset rotation" onClick={() => onChange({ ...t, rotation: 0 })} className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-md border border-line bg-surface text-ink-2 hover:text-ink"><Icon name="retry" size={14} /></button>
        </div>
      </Field>
      <Field label="Opacity"><Num value={Math.round(t.opacity * 100)} min={0} max={100} step={5} suffix="%" onChange={(n) => onChange({ ...t, opacity: Math.max(0, Math.min(1, n / 100)) })} /></Field>
      <div className="col-span-2">
        <label className="flex items-center gap-2 h-8 text-xs text-ink-2 opacity-50 cursor-not-allowed" title="Keep aspect ratio is always on: the document has one uniform scale, not separate width and height scales">
          <input type="checkbox" checked disabled className="accent-[var(--color-accent)]" />Keep aspect ratio
        </label>
      </div>
      <Field label="Align" span>
        <div className="flex gap-1">{alignBtn("Align left", "⇤", "left", null)}{alignBtn("Centre horizontally", "↔", "center", null)}{alignBtn("Align right", "⇥", "right", null)}</div>
        <div className="flex gap-1 mt-1">{alignBtn("Align top", "⤒", null, "top")}{alignBtn("Centre vertically", "↕", null, "middle")}{alignBtn("Align bottom", "⤓", null, "bottom")}</div>
      </Field>
    </Group>
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
      <Panel kind="Selected" title={isOverlay ? "B-roll clip" : "Clip"} onDelete={() => { commit(deleteClip(doc, track.id, clip.id)); onSelect(null); }}>
        <Group title="Source">
          <div className="col-span-2 text-xs text-ink-2 truncate" title={asset?.url}>{asset?.name}</div>
        </Group>
        <Group title="Trim">
          <Field label="In"><Num value={clip.inMs} min={0} max={clip.outMs - 100} step={10} suffix="ms" onChange={(n) => commit(updateClip(doc, track.id, clip.id, { inMs: Math.max(0, Math.min(clip.outMs - 100, n)) }))} /></Field>
          <Field label="Out"><Num value={clip.outMs} min={clip.inMs + 100} max={asset?.durationMs ?? undefined} step={10} suffix="ms" onChange={(n) => commit(updateClip(doc, track.id, clip.id, { outMs: Math.max(clip.inMs + 100, Math.min(asset?.durationMs ?? n, n)) }))} /></Field>
          {isOverlay && <Field label="Starts at"><Num value={clip.at} min={0} step={10} suffix="ms" onChange={(n) => commit(updateClip(doc, track.id, clip.id, { at: Math.max(0, n) }))} /></Field>}
          <Field label="Length"><div className="h-8 flex items-center text-xs font-mono text-ink-2">{fmtTime(clipLengthMs(clip))}</div></Field>
        </Group>
        {!isOverlay && (
          <Group title="Audio">
            <Toggle label="Mute" value={clip.muted} onChange={(v) => commit(updateClip(doc, track.id, clip.id, { muted: v }))} />
            <Field label="Volume"><Num value={clip.volume} min={0} max={1} step={0.05} onChange={(n) => commit(updateClip(doc, track.id, clip.id, { volume: n }))} /></Field>
          </Group>
        )}
        <TransformBlock doc={doc} t={clip.transform} box={clipBox(doc, clip, null)} onChange={(t) => commit(updateClip(doc, track.id, clip.id, { transform: t }))} />
        {isOverlay && <p className="text-[10px] text-faint">B-roll is always silent (audio mixing is out of scope). Drag it on the preview to move it; the handles scale and rotate it.</p>}
      </Panel>
    );
  }

  if (selection?.kind === "cue") {
    const track = captionTrack(doc);
    const cue = track?.kind === "caption" ? track.cues.find((q) => q.id === selection.id) : undefined;
    if (!cue) return null;
    return (
      <Panel kind="Selected" title="Caption" onDelete={() => { commit(deleteCue(doc, cue.id)); onSelect(null); }}>
        <Group title="Text">
          <Field label={`One line per row, max ${doc.captionStyle.layout.maxLines}`} span>
            <textarea className={areaCls} rows={3} value={cue.lines.join("\n")}
              onChange={(e) => onChange(updateCue(doc, cue.id, { lines: e.target.value.split("\n").slice(0, doc.captionStyle.layout.maxLines), words: null }), false)}
              onBlur={() => commit(doc)} />
          </Field>
          {cue.words && <p className="col-span-2 text-[10px] text-faint">{cue.words.length} timed words (editing the text drops word timing).</p>}
        </Group>
        <Group title="Timing">
          <Field label="Start"><Num value={cue.startMs} min={0} step={10} suffix="ms" onChange={(n) => commit(updateCue(doc, cue.id, { startMs: Math.max(0, Math.min(cue.endMs - 100, n)) }))} /></Field>
          <Field label="End"><Num value={cue.endMs} min={cue.startMs + 100} step={10} suffix="ms" onChange={(n) => commit(updateCue(doc, cue.id, { endMs: Math.max(cue.startMs + 100, n) }))} /></Field>
        </Group>
        <Group title="Look">
          <div className="col-span-2">
            <Toggle label="Override the style for this caption" value={!!cue.styleOverride}
              onChange={(v) => commit(updateCue(doc, cue.id, { styleOverride: v ? { ...doc.captionStyle } : null }))} />
            {!cue.styleOverride && <p className="text-[10px] text-faint">Captions share the document caption style. Deselect to edit it.</p>}
          </div>
        </Group>
        {cue.styleOverride && (
          <div className="pt-4 border-t border-line-soft">
            <StyleEditor style={normalizeCaptionStyle({ ...doc.captionStyle, ...cue.styleOverride }, doc.captionStyle)} onChange={(s) => commit(updateCue(doc, cue.id, { styleOverride: s }))} />
          </div>
        )}
      </Panel>
    );
  }

  if (selection?.kind === "text") {
    const track = textTrack(doc);
    const el = track?.kind === "text" ? track.elements.find((e) => e.id === selection.id) : undefined;
    if (!el) return null;
    return (
      <Panel kind="Selected" title="Text" onDelete={() => { commit(deleteText(doc, el.id)); onSelect(null); }}>
        <Group title="Content">
          <Field label="Text" span>
            <textarea className={areaCls} rows={2} value={el.text} onChange={(e) => onChange(updateText(doc, el.id, { text: e.target.value }), false)} onBlur={() => commit(doc)} />
          </Field>
        </Group>
        <Group title="Timing">
          <Field label="Start"><Num value={el.startMs} min={0} step={10} suffix="ms" onChange={(n) => commit(updateText(doc, el.id, { startMs: Math.max(0, Math.min(el.endMs - 100, n)) }))} /></Field>
          <Field label="End"><Num value={el.endMs} min={el.startMs + 100} step={10} suffix="ms" onChange={(n) => commit(updateText(doc, el.id, { endMs: Math.max(el.startMs + 100, n) }))} /></Field>
        </Group>
        <TransformBlock doc={doc} t={el.transform} box={textBox(doc, el)} onChange={(t) => commit(updateText(doc, el.id, { transform: t }))} />
        <div className="pt-4 border-t border-line-soft">
          <StyleEditor style={el.style} showLayout={false} onChange={(s) => commit(updateText(doc, el.id, { style: s }))} />
          <button className="o-btn o-btn-ghost text-xs mt-4" onClick={() => commit(updateText(doc, el.id, { style: doc.captionStyle }))}>Use the caption style</button>
        </div>
      </Panel>
    );
  }

  return (
    <Panel kind="Nothing selected" title="Caption style">
      <p className="text-[10px] text-faint -mt-1">One definition for the preview and the export. Anything not here cannot be rendered the same way twice, so it is not offered.</p>
      <StyleEditor style={doc.captionStyle} onChange={(s) => commit(setCaptionStyle(doc, s))} />
      <div className="flex flex-wrap gap-2 pt-4 border-t border-line-soft">
        <button className="o-btn o-btn-ghost text-xs" onClick={saveClientDefault} disabled={savingDefault === "saving"}>
          {savingDefault === "saved" ? "✓ Saved as client default" : savingDefault === "error" ? "Could not save" : "Save as this client's default"}
        </button>
        <button className="o-btn o-btn-ghost text-xs" onClick={() => commit(setCaptionStyle(doc, DEFAULT_CAPTION_STYLE))}>Reset</button>
      </div>
    </Panel>
  );
}

function Panel({ kind, title, onDelete, children }: { kind: string; title: string; onDelete?: () => void; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted block">{kind}</span>
          <h3 className="text-sm font-bold text-ink">{title}</h3>
        </div>
        {onDelete && (
          <button onClick={onDelete} title="Delete" className="h-8 w-8 inline-flex items-center justify-center rounded-md text-danger-600 hover:bg-danger-50"><Icon name="trash" /></button>
        )}
      </div>
      {children}
    </div>
  );
}
