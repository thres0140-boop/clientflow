"use client";

// Right-hand panel, CapCut's "Details": its own 42 px header strip carries a tab row that switches
// between the selection's property groups (Video / Audio / Speed for a clip, Text / Look /
// Animation for a text element, and so on); the body holds CapCut-sized rows — an 11 px label on
// the left, a 22 px control on the right, 38 px row pitch — and a footer strip closes the panel.
// Every control maps 1:1 onto a CaptionStyle or Transform property; nothing the parity table
// calls "not representable" is offered. All handlers write the same document operations as
// before; only the chrome changed.
import { useState } from "react";
import { ANIMATION_TYPES, type AnimationSpec, type AnimationType, CAPTION_FONTS, type CaptionFontFamily, type CaptionStyle, DEFAULT_CAPTION_STYLE, normalizeCaptionStyle } from "@/features/editor/model/captionStyle";
import type { EditDocument, Transform } from "@/features/editor/model/document";
import { SPEED_MAX, SPEED_MIN, SPEED_STOPS, TRANSITION_DEFAULT_MS, TRANSITION_TYPES, type TransitionType } from "@/features/editor/model/document";
import { captionTrack, clipLengthMs, deleteClip, deleteCue, deleteText, mainTrack, overlayTrack, setCaptionStyle, setClipSpeed, setTransition, textTrack, transitionAfter, transitionCapMs, updateClip, updateCue, updateText } from "@/features/editor/model/timeline";
import type { Selection } from "./Timeline";
import { fmtTime } from "./Timeline";
import { Icon } from "./icons";
import { alignedCentre, type Box, clipBox, textBox } from "@/features/editor/render/chrome";
import { TRANSITION_LABELS } from "./transitions";
import { NOT_BUILT } from "./LeftPanel";

type Props = {
  doc: EditDocument;
  selection: Selection;
  clientId: number;
  onChange: (doc: EditDocument, commit: boolean) => void;
  onSelect: (s: Selection) => void;
  onSaveClientDefault: () => Promise<boolean>;
};

// ── CapCut-sized primitives ────────────────────────────────────────────────
const fieldCls = "h-[22px] rounded-[2px] bg-well px-2 text-[11px] text-ink-strong text-center focus:outline-none focus:ring-1 focus:ring-accent";
const selectCls = "h-[22px] w-full rounded-[2px] bg-well px-2 text-[11px] text-ink-strong focus:outline-none focus:ring-1 focus:ring-accent";
const areaCls = "w-full rounded-[2px] bg-well px-2 py-1.5 text-[11px] text-ink-strong focus:outline-none focus:ring-1 focus:ring-accent";
const btnCls = "h-[22px] px-2 rounded-[3px] text-[11px] font-medium bg-surface-3 text-ink hover:bg-surface-4 disabled:opacity-40 disabled:cursor-not-allowed";

/** A row: 12 px label in an 80 px column on the left, the control(s) on the right (CapCut, full-screen). */
function Row({ label, children, top }: { label: string; children: React.ReactNode; top?: boolean }) {
  return (
    <div className={`grid grid-cols-[80px_1fr] gap-x-3 ${top ? "items-start" : "items-center"} min-h-[22px]`}>
      <span className="text-[12px] text-ink truncate pt-px" title={label}>{label}</span>
      <div className="flex items-center gap-2 min-w-0">{children}</div>
    </div>
  );
}
/** A section: 12 px bold header with a collapse chevron, 2 px separator above, 38 px row pitch. */
function Group({ title, children, first }: { title: string; children: React.ReactNode; first?: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <section className={first ? "pt-2" : "pt-4 mt-4 border-t-2 border-line"}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 text-[12px] font-bold text-ink-strong mb-3">
        {title}<Icon name="chevron" size={10} className={`text-ink transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && <div className="flex flex-col gap-4">{children}</div>}
    </section>
  );
}
/** CapCut's number field: a 54 px well with the value (68 with an axis letter inside, as on Position), and a
 *  16 px stepper beside it. */
function Num({ value, onChange, min, max, step = 1, suffix, prefix, width = 54 }: { value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; suffix?: string; prefix?: string; width?: number }) {
  const clampV = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  const shown = Number.isFinite(value) ? +value.toFixed(step < 1 ? 2 : 0) : 0;
  return (
    <div className="inline-flex items-center gap-1">
      <div className="h-[22px] inline-flex items-center rounded-[2px] bg-well focus-within:ring-1 focus-within:ring-accent" style={{ width }}>
        {prefix && <span className="pl-2 text-[11px] text-faint select-none">{prefix}</span>}
        <input type="number" className="h-full flex-1 min-w-0 bg-transparent px-1 text-[11px] text-ink-strong text-center focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" value={shown} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} />
      </div>
      <div className="h-[22px] w-4 flex flex-col rounded-[2px] overflow-hidden bg-surface-3">
        <button type="button" aria-label="Increase" onClick={() => onChange(clampV(+(value + step).toFixed(4)))} className="flex-1 flex items-center justify-center text-ink hover:bg-surface-4"><Icon name="chevron" size={8} className="rotate-180" /></button>
        <button type="button" aria-label="Decrease" onClick={() => onChange(clampV(+(value - step).toFixed(4)))} className="flex-1 flex items-center justify-center text-ink hover:bg-surface-4"><Icon name="chevron" size={8} /></button>
      </div>
      {suffix && <span className="text-[11px] text-ink">{suffix}</span>}
    </div>
  );
}
function Color({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex items-center gap-1.5">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-[22px] w-[22px] shrink-0 rounded-[2px] bg-well p-0.5" />
      <input className={fieldCls} style={{ width: 68 }} value={value} onChange={(e) => /^#[0-9a-fA-F]{6}$/.test(e.target.value) && onChange(e.target.value.toLowerCase())} />
    </div>
  );
}
/** CapCut's 36x16 switch. */
function Toggle({ value, onChange, label, disabled }: { value: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={value} aria-label={label} disabled={disabled} onClick={() => onChange(!value)}
      className={`relative h-4 w-9 shrink-0 rounded-full transition-colors ${value ? "bg-accent" : "bg-surface-3"} disabled:opacity-40 disabled:cursor-not-allowed`}>
      <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-ink-strong transition-transform ${value ? "left-0.5 translate-x-5" : "left-0.5"}`} />
    </button>
  );
}
/** CapCut's segmented control: a 24 px well track with the active segment raised. */
function Seg<T extends string>({ value, options, onChange }: { value: T; options: { v: T; l: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex h-6 rounded bg-well p-0.5 w-full">
      {options.map((o) => (
        <button key={o.v} onClick={() => onChange(o.v)} className={`flex-1 px-2 text-[12px] rounded-[3px] ${value === o.v ? "bg-surface-3 text-ink-strong" : "text-ink hover:text-ink-strong"}`}>{o.l}</button>
      ))}
    </div>
  );
}
function Slider({ value, min, max, step, onChange }: { value: number; min: number; max: number; step: number; onChange: (n: number) => void }) {
  return <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="flex-1 min-w-0 h-[22px] accent-[var(--color-ink-strong)]" aria-label="slider" />;
}

const ANIMATION_LABELS: Record<AnimationType, string> = { none: "None", fade: "Fade", slideleft: "Slide left", slideright: "Slide right", slideup: "Slide up", slidedown: "Slide down", pop: "Pop" };
function AnimationRows({ label, spec, onChange }: { label: string; spec: AnimationSpec; onChange: (v: AnimationSpec) => void }) {
  return (
    <>
      <Row label={label}>
        <select className={selectCls} value={spec.type} onChange={(e) => onChange({ ...spec, type: e.target.value as AnimationType })}>
          {ANIMATION_TYPES.map((t) => <option key={t} value={t}>{ANIMATION_LABELS[t]}</option>)}
        </select>
      </Row>
      <Row label={`${label} duration`}><Num value={spec.durationMs} min={50} max={2000} step={50} suffix="ms" onChange={(n) => onChange({ ...spec, durationMs: n })} /></Row>
    </>
  );
}

/** The caption-style groups. `which` picks the tab's share: look (font, colour, outline, box), layout, animation. */
export function StyleSections({ style, onChange, which }: { style: CaptionStyle; onChange: (s: CaptionStyle) => void; which: ("look" | "layout" | "animation")[] }) {
  const set = (patch: (s: CaptionStyle) => CaptionStyle) => onChange(normalizeCaptionStyle(patch(style), style));
  const family = style.font.family;
  const hex = (v: string) => v as CaptionStyle["fill"]["color"];
  // The first rendered section carries no separator; which one that is follows from `which`.
  const firstKey = which.includes("look") ? "look" : which.includes("layout") ? "layout" : "animation";
  return (
    <>
      {which.includes("look") && (
        <>
          <Group title="Font" first={firstKey === "look"}>
            <Row label="Family">
              <select className={selectCls} value={family} onChange={(e) => set((s) => ({ ...s, font: { ...s.font, family: e.target.value as CaptionFontFamily, weight: CAPTION_FONTS[e.target.value as CaptionFontFamily].weights[0] } }))}>
                {(Object.keys(CAPTION_FONTS) as CaptionFontFamily[]).map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </Row>
            {CAPTION_FONTS[family].weights.length > 1 && (
              <Row label="Weight"><Seg value={String(style.font.weight)} options={CAPTION_FONTS[family].weights.map((w) => ({ v: String(w), l: w === 400 ? "Regular" : w === 700 ? "Bold" : "Extra bold" }))} onChange={(v) => set((s) => ({ ...s, font: { ...s.font, weight: Number(v) as CaptionStyle["font"]["weight"] } }))} /></Row>
            )}
            <Row label="Size"><Num value={style.font.sizePx} min={24} max={200} suffix="px" onChange={(n) => set((s) => ({ ...s, font: { ...s.font, sizePx: n } }))} /></Row>
            <Row label="Letter spacing"><Num value={style.font.letterSpacingPx} min={-10} max={40} suffix="px" onChange={(n) => set((s) => ({ ...s, font: { ...s.font, letterSpacingPx: n } }))} /></Row>
            <Row label="Uppercase"><Toggle label="Uppercase" value={style.font.uppercase} onChange={(v) => set((s) => ({ ...s, font: { ...s.font, uppercase: v } }))} /></Row>
            <Row label="Italic"><Toggle label="Italic" value={style.font.italic} onChange={(v) => set((s) => ({ ...s, font: { ...s.font, italic: v } }))} /></Row>
          </Group>
          <Group title="Colour">
            <Row label="Fill"><Color value={style.fill.color} onChange={(v) => set((s) => ({ ...s, fill: { color: hex(v) } }))} /></Row>
          </Group>
          <Group title="Outline & shadow">
            <Row label="Outline"><Color value={style.outline.color} onChange={(v) => set((s) => ({ ...s, outline: { ...s.outline, color: hex(v) } }))} /></Row>
            <Row label="Outline width"><Num value={style.outline.widthPx} min={0} max={20} suffix="px" onChange={(n) => set((s) => ({ ...s, outline: { ...s.outline, widthPx: n } }))} /></Row>
            <Row label="Shadow"><Color value={style.shadow.color} onChange={(v) => set((s) => ({ ...s, shadow: { ...s.shadow, color: hex(v) } }))} /></Row>
            <Row label="Shadow offset"><Num value={style.shadow.offsetPx} min={0} max={20} suffix="px" onChange={(n) => set((s) => ({ ...s, shadow: { ...s.shadow, offsetPx: n } }))} /></Row>
            <Row label="Shadow opacity"><Slider value={Math.round(style.shadow.opacity * 100)} min={0} max={100} step={5} onChange={(n) => set((s) => ({ ...s, shadow: { ...s.shadow, opacity: n / 100 } }))} /><Num value={Math.round(style.shadow.opacity * 100)} min={0} max={100} step={5} suffix="%" width={54} onChange={(n) => set((s) => ({ ...s, shadow: { ...s.shadow, opacity: n / 100 } }))} /></Row>
          </Group>
          <Group title="Background box">
            <Row label="Box"><Toggle label="Box behind each line" value={style.box.enabled} onChange={(v) => set((s) => ({ ...s, box: { ...s.box, enabled: v } }))} /></Row>
            {style.box.enabled && (
              <>
                <Row label="Colour"><Color value={style.box.color} onChange={(v) => set((s) => ({ ...s, box: { ...s.box, color: hex(v) } }))} /></Row>
                <Row label="Opacity"><Slider value={Math.round(style.box.opacity * 100)} min={0} max={100} step={5} onChange={(n) => set((s) => ({ ...s, box: { ...s.box, opacity: n / 100 } }))} /><Num value={Math.round(style.box.opacity * 100)} min={0} max={100} step={5} suffix="%" width={54} onChange={(n) => set((s) => ({ ...s, box: { ...s.box, opacity: n / 100 } }))} /></Row>
                <Row label="Padding"><Num value={style.box.paddingPx} min={0} max={60} suffix="px" onChange={(n) => set((s) => ({ ...s, box: { ...s.box, paddingPx: n } }))} /></Row>
              </>
            )}
          </Group>
        </>
      )}
      {which.includes("layout") && (
        <>
          <Group title="Layout" first={firstKey === "layout"}>
            <Row label="Anchor"><Seg value={style.layout.anchor} options={[{ v: "top", l: "Top" }, { v: "middle", l: "Middle" }, { v: "bottom", l: "Bottom" }]} onChange={(v) => set((s) => ({ ...s, layout: { ...s.layout, anchor: v } }))} /></Row>
            <Row label="Align"><Seg value={style.layout.align} options={[{ v: "left", l: "Left" }, { v: "center", l: "Centre" }, { v: "right", l: "Right" }]} onChange={(v) => set((s) => ({ ...s, layout: { ...s.layout, align: v } }))} /></Row>
            <Row label="From edge"><Num value={style.layout.marginVPx} min={0} max={1000} suffix="px" onChange={(n) => set((s) => ({ ...s, layout: { ...s.layout, marginVPx: n } }))} /></Row>
            <Row label="Side margin"><Num value={style.layout.marginHPx} min={0} max={400} suffix="px" onChange={(n) => set((s) => ({ ...s, layout: { ...s.layout, marginHPx: n } }))} /></Row>
            <Row label="Max lines"><Seg value={String(style.layout.maxLines) as "1" | "2" | "3"} options={[{ v: "1", l: "1" }, { v: "2", l: "2" }, { v: "3", l: "3" }]} onChange={(v) => set((s) => ({ ...s, layout: { ...s.layout, maxLines: Number(v) as 1 | 2 | 3 } }))} /></Row>
            <Row label="Words per caption"><Num value={style.layout.wordsPerCue} min={1} max={6} onChange={(n) => set((s) => ({ ...s, layout: { ...s.layout, wordsPerCue: n } }))} /></Row>
          </Group>
          <Group title="Spoken word">
            <Row label="Highlight"><Seg value={style.highlight.mode} options={[{ v: "none", l: "Plain" }, { v: "color", l: "Colour" }]} onChange={(v) => set((s) => ({ ...s, highlight: { ...s.highlight, mode: v } }))} /></Row>
            {style.highlight.mode === "color" && <Row label="Colour"><Color value={style.highlight.color} onChange={(v) => set((s) => ({ ...s, highlight: { ...s.highlight, color: hex(v) } }))} /></Row>}
          </Group>
        </>
      )}
      {which.includes("animation") && (
        <Group title="Animation" first={firstKey === "animation"}>
          <AnimationRows label="In" spec={style.animation.in} onChange={(v) => set((s) => ({ ...s, animation: { ...s.animation, in: v } }))} />
          <AnimationRows label="Out" spec={style.animation.out} onChange={(v) => set((s) => ({ ...s, animation: { ...s.animation, out: v } }))} />
          <p className="text-[10px] text-muted">Linear, capped at half the on-screen time. Fade, slide and pop each map to a libass tag, so the export animates the same way.</p>
        </Group>
      )}
    </>
  );
}

/** CapCut's Transform block: scale slider + %, position X/Y with steppers, rotation with reset,
 *  the keep-aspect toggle rendered disabled (the model has one uniform scale), and alignment. */
function TransformGroup({ doc, t, box, onChange, first }: { doc: EditDocument; t: Transform; box: Box | null; onChange: (t: Transform) => void; first?: boolean }) {
  const W = doc.canvas.width, H = doc.canvas.height;
  const alignBtn = (label: string, icon: string, h: "left" | "center" | "right" | null, v: "top" | "middle" | "bottom" | null) => (
    <button key={label} title={label} disabled={!box} onClick={() => box && onChange(alignedCentre(doc, box, t, h, v))}
      className="h-[22px] flex-1 rounded-[3px] bg-surface-3 text-[12px] text-ink hover:bg-surface-4 disabled:opacity-40">{icon}</button>
  );
  return (
    <Group title="Transform" first={first}>
      <Row label="Scale"><Slider value={Math.round(t.scale * 100)} min={5} max={300} step={1} onChange={(n) => onChange({ ...t, scale: n / 100 })} /><Num value={Math.round(t.scale * 100)} min={5} max={500} suffix="%" width={54} onChange={(n) => onChange({ ...t, scale: Math.max(0.05, n / 100) })} /></Row>
      <Row label="Keep aspect ratio"><span title="Always on: the document has one uniform scale, not separate width and height scales"><Toggle label="Keep aspect ratio" value disabled onChange={() => {}} /></span></Row>
      <Row label="Position">
        <Num prefix="X" value={Math.round((t.x - 0.5) * W)} step={1} width={68} onChange={(n) => onChange({ ...t, x: 0.5 + n / W })} />
        <Num prefix="Y" value={Math.round((t.y - 0.5) * H)} step={1} width={68} onChange={(n) => onChange({ ...t, y: 0.5 + n / H })} />
      </Row>
      <Row label="Rotate">
        <Num value={t.rotation} min={-180} max={180} step={1} suffix="°" onChange={(n) => onChange({ ...t, rotation: Math.max(-180, Math.min(180, n)) })} />
        <button title="Reset rotation" onClick={() => onChange({ ...t, rotation: 0 })} className="h-[22px] w-[22px] inline-flex items-center justify-center rounded-full bg-surface-3 text-ink hover:bg-surface-4"><Icon name="retry" size={11} /></button>
      </Row>
      <Row label="Opacity"><Slider value={Math.round(t.opacity * 100)} min={0} max={100} step={5} onChange={(n) => onChange({ ...t, opacity: n / 100 })} /><Num value={Math.round(t.opacity * 100)} min={0} max={100} step={5} suffix="%" width={54} onChange={(n) => onChange({ ...t, opacity: Math.max(0, Math.min(1, n / 100)) })} /></Row>
      <div className="grid grid-cols-[80px_1fr] gap-x-3">
        <span />
        <div className="flex gap-1 rounded-[3px] bg-surface-3 p-0.5">{alignBtn("Align left", "⇤", "left", null)}{alignBtn("Centre horizontally", "↔", "center", null)}{alignBtn("Align right", "⇥", "right", null)}{alignBtn("Align top", "⤒", null, "top")}{alignBtn("Centre vertically", "↕", null, "middle")}{alignBtn("Align bottom", "⤓", null, "bottom")}</div>
      </div>
    </Group>
  );
}

type Tab = { id: string; label: string };

export default function Inspector({ doc, selection, onChange, onSelect, onSaveClientDefault }: Props) {
  const [savingDefault, setSavingDefault] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [tabByKind, setTabByKind] = useState<Record<string, string>>({});
  const commit = (d: EditDocument) => onChange(d, true);

  async function saveClientDefault() {
    setSavingDefault("saving");
    setSavingDefault((await onSaveClientDefault()) ? "saved" : "error");
    setTimeout(() => setSavingDefault("idle"), 1500);
  }

  // What the header tab row offers depends on the selection; the active tab is remembered per kind.
  let kind = "none", tabs: Tab[] = [{ id: "style", label: "Captions" }, { id: "animation", label: "Animation" }];
  let title = "Caption style", onDelete: (() => void) | undefined;
  let body: (tab: string) => React.ReactNode = () => null;

  if (selection?.kind === "clip") {
    const track = [mainTrack(doc), overlayTrack(doc)].find((t) => t?.id === selection.trackId);
    const clip = track?.clips.find((c) => c.id === selection.id);
    if (track && clip) {
      const asset = doc.assets.find((a) => a.id === clip.assetId);
      const isOverlay = track.role === "overlay";
      kind = "clip"; title = isOverlay ? "B-roll" : "Video";
      tabs = [{ id: "video", label: "Video" }, ...(isOverlay ? [] : [{ id: "audio", label: "Audio" }]), { id: "speed", label: "Speed" }];
      onDelete = () => { commit(deleteClip(doc, track.id, clip.id)); onSelect(null); };
      body = (tab) => tab === "audio" ? (
        <Group title="Audio" first>
          <Row label="Mute"><Toggle label="Mute" value={clip.muted} onChange={(v) => commit(updateClip(doc, track.id, clip.id, { muted: v }))} /></Row>
          <Row label="Volume"><Slider value={Math.round(clip.volume * 100)} min={0} max={100} step={5} onChange={(n) => commit(updateClip(doc, track.id, clip.id, { volume: n / 100 }))} /><Num value={Math.round(clip.volume * 100)} min={0} max={100} step={5} suffix="%" width={54} onChange={(n) => commit(updateClip(doc, track.id, clip.id, { volume: n / 100 }))} /></Row>
        </Group>
      ) : tab === "speed" ? (
        <Group title="Speed" first>
          <div className="grid grid-cols-[80px_1fr] gap-x-3">
            <span />
            <div className="flex flex-wrap gap-1">
              {SPEED_STOPS.map((s) => (
                <button key={s} onClick={() => commit(setClipSpeed(doc, track.id, clip.id, s))}
                  className={`h-[22px] px-2 rounded-[3px] text-[11px] font-medium ${clip.speed === s ? "bg-accent text-on-accent" : "bg-surface-3 text-ink hover:bg-surface-4"}`}>{s}×</button>
              ))}
            </div>
          </div>
          <Row label="Custom"><Num value={clip.speed} min={SPEED_MIN} max={SPEED_MAX} step={0.05} suffix="×" onChange={(n) => commit(setClipSpeed(doc, track.id, clip.id, Math.max(SPEED_MIN, Math.min(SPEED_MAX, n))))} /></Row>
          <Row label="On timeline"><span className="text-[11px] font-mono text-ink-strong">{fmtTime(clipLengthMs(clip))}</span></Row>
          <p className="text-[10px] text-muted">{SPEED_MIN}× to {SPEED_MAX}×, the range one ffmpeg atempo covers. Pitch is preserved (atempo on export, the browser&apos;s default in the preview). Captions, text and b-roll inside this clip are rescaled with it; everything after it shifts.</p>
        </Group>
      ) : (
        <>
          <Group title="Source" first>
            <Row label="Clip"><span className="text-[11px] text-ink-strong truncate" title={asset?.url}>{asset?.name}</span></Row>
            <Row label="In"><Num value={clip.inMs} min={0} max={clip.outMs - 100} step={10} suffix="ms" onChange={(n) => commit(updateClip(doc, track.id, clip.id, { inMs: Math.max(0, Math.min(clip.outMs - 100, n)) }))} /></Row>
            <Row label="Out"><Num value={clip.outMs} min={clip.inMs + 100} max={asset?.durationMs ?? undefined} step={10} suffix="ms" onChange={(n) => commit(updateClip(doc, track.id, clip.id, { outMs: Math.max(clip.inMs + 100, Math.min(asset?.durationMs ?? n, n)) }))} /></Row>
            {isOverlay && <Row label="Starts at"><Num value={clip.at} min={0} step={10} suffix="ms" onChange={(n) => commit(updateClip(doc, track.id, clip.id, { at: Math.max(0, n) }))} /></Row>}
            <Row label="Length"><span className="text-[11px] font-mono text-ink-strong">{fmtTime(clipLengthMs(clip))}</span></Row>
          </Group>
          <TransformGroup doc={doc} t={clip.transform} box={clipBox(doc, clip, null)} onChange={(t) => commit(updateClip(doc, track.id, clip.id, { transform: t }))} />
          {isOverlay && <p className="mt-3 text-[10px] text-muted">B-roll is always silent (audio mixing is out of scope). Drag it on the preview to move it; the handles scale and rotate it.</p>}
        </>
      );
    }
  } else if (selection?.kind === "cue") {
    const track = captionTrack(doc);
    const cue = track?.kind === "caption" ? track.cues.find((q) => q.id === selection.id) : undefined;
    if (cue) {
      kind = "cue"; title = "Caption";
      tabs = [{ id: "caption", label: "Caption" }, { id: "look", label: "Look" }, { id: "animation", label: "Animation" }];
      onDelete = () => { commit(deleteCue(doc, cue.id)); onSelect(null); };
      const merged = normalizeCaptionStyle({ ...doc.captionStyle, ...cue.styleOverride }, doc.captionStyle);
      const overrideRows = (which: ("look" | "layout" | "animation")[]) => (
        <>
          <div className="pt-2 pb-1"><Row label="Override"><Toggle label="Override the style for this caption" value={!!cue.styleOverride} onChange={(v) => commit(updateCue(doc, cue.id, { styleOverride: v ? { ...doc.captionStyle } : null }))} /><span className="text-[10px] text-muted">{cue.styleOverride ? "this caption only" : "editing the style of all captions"}</span></Row></div>
          {cue.styleOverride
            ? <StyleSections style={merged} which={which} onChange={(s) => commit(updateCue(doc, cue.id, { styleOverride: s }))} />
            : <StyleSections style={doc.captionStyle} which={which} onChange={(s) => commit(setCaptionStyle(doc, s))} />}
        </>
      );
      body = (tab) => tab === "look" ? overrideRows(["look", "layout"]) : tab === "animation" ? overrideRows(["animation"]) : (
        <>
          <Group title="Text" first>
            <Row label={`Lines (max ${doc.captionStyle.layout.maxLines})`} top>
              <textarea className={areaCls} rows={3} value={cue.lines.join("\n")}
                onChange={(e) => onChange(updateCue(doc, cue.id, { lines: e.target.value.split("\n").slice(0, doc.captionStyle.layout.maxLines), words: null }), false)}
                onBlur={() => commit(doc)} />
            </Row>
            {cue.words && <p className="text-[10px] text-muted">{cue.words.length} timed words (editing the text drops word timing).</p>}
          </Group>
          <Group title="Timing">
            <Row label="Start"><Num value={cue.startMs} min={0} step={10} suffix="ms" onChange={(n) => commit(updateCue(doc, cue.id, { startMs: Math.max(0, Math.min(cue.endMs - 100, n)) }))} /></Row>
            <Row label="End"><Num value={cue.endMs} min={cue.startMs + 100} step={10} suffix="ms" onChange={(n) => commit(updateCue(doc, cue.id, { endMs: Math.max(cue.startMs + 100, n) }))} /></Row>
          </Group>
        </>
      );
    }
  } else if (selection?.kind === "text") {
    const track = textTrack(doc);
    const el = track?.kind === "text" ? track.elements.find((e) => e.id === selection.id) : undefined;
    if (el) {
      kind = "text"; title = "Text";
      tabs = [{ id: "text", label: "Text" }, { id: "look", label: "Look" }, { id: "animation", label: "Animation" }];
      onDelete = () => { commit(deleteText(doc, el.id)); onSelect(null); };
      body = (tab) => tab === "look" ? (
        <>
          <StyleSections style={el.style} which={["look"]} onChange={(s) => commit(updateText(doc, el.id, { style: s }))} />
          <button className={`${btnCls} mt-4`} onClick={() => commit(updateText(doc, el.id, { style: doc.captionStyle }))}>Use the caption style</button>
        </>
      ) : tab === "animation" ? (
        <StyleSections style={el.style} which={["animation"]} onChange={(s) => commit(updateText(doc, el.id, { style: s }))} />
      ) : (
        <>
          <Group title="Content" first>
            <Row label="Text" top><textarea className={areaCls} rows={2} value={el.text} onChange={(e) => onChange(updateText(doc, el.id, { text: e.target.value }), false)} onBlur={() => commit(doc)} /></Row>
          </Group>
          <Group title="Timing">
            <Row label="Start"><Num value={el.startMs} min={0} step={10} suffix="ms" onChange={(n) => commit(updateText(doc, el.id, { startMs: Math.max(0, Math.min(el.endMs - 100, n)) }))} /></Row>
            <Row label="End"><Num value={el.endMs} min={el.startMs + 100} step={10} suffix="ms" onChange={(n) => commit(updateText(doc, el.id, { endMs: Math.max(el.startMs + 100, n) }))} /></Row>
          </Group>
          <TransformGroup doc={doc} t={el.transform} box={textBox(doc, el)} onChange={(t) => commit(updateText(doc, el.id, { transform: t }))} />
        </>
      );
    }
  } else if (selection?.kind === "transition") {
    const main = mainTrack(doc);
    const i = main.clips.findIndex((c) => c.id === selection.afterClipId);
    const a = main.clips[i], b = main.clips[i + 1];
    if (a && b) {
      const tr = transitionAfter(main, a.id);
      const cap = transitionCapMs(main, a.id);
      const na = doc.assets.find((x) => x.id === a.assetId)?.name ?? "clip", nb = doc.assets.find((x) => x.id === b.assetId)?.name ?? "clip";
      kind = "transition"; title = tr ? "Transition" : "Cut";
      tabs = [{ id: "transition", label: "Transition" }];
      onDelete = tr ? () => commit(setTransition(doc, a.id, null)) : undefined;
      body = () => (
        <Group title="Transition" first>
          <Row label="Between"><span className="text-[11px] text-ink-strong truncate">{na} <span className="text-muted">→</span> {nb}</span></Row>
          <Row label="Type">
            <select className={selectCls} value={tr?.type ?? "none"} onChange={(e) => commit(setTransition(doc, a.id, e.target.value === "none" ? null : (e.target.value as TransitionType), tr?.durationMs ?? TRANSITION_DEFAULT_MS))}>
              <option value="none">None (cut)</option>
              {TRANSITION_TYPES.map((t) => <option key={t} value={t}>{TRANSITION_LABELS[t]}</option>)}
            </select>
          </Row>
          <Row label="Duration"><Num value={tr?.durationMs ?? TRANSITION_DEFAULT_MS} min={100} max={cap} step={50} suffix="ms" onChange={(n) => tr && commit(setTransition(doc, a.id, tr.type, Math.max(100, Math.min(cap, n))))} /><span className="text-[10px] text-muted">cap {cap} ms</span></Row>
          <p className="text-[10px] text-muted">The two clips overlap by the duration, so the timeline gets that much shorter. Capped at half the shorter clip. Exports as ffmpeg xfade.</p>
        </Group>
      );
    }
  }
  if (kind === "none") {
    body = (tab) => tab === "animation" ? (
      <StyleSections style={doc.captionStyle} which={["animation"]} onChange={(s) => commit(setCaptionStyle(doc, s))} />
    ) : (
      <>
        <StyleSections style={doc.captionStyle} which={["look", "layout"]} onChange={(s) => commit(setCaptionStyle(doc, s))} />
        <div className="flex flex-wrap gap-2 pt-4 mt-4 border-t-2 border-line">
          <button className={btnCls} onClick={saveClientDefault} disabled={savingDefault === "saving"}>
            {savingDefault === "saved" ? "✓ Saved as client default" : savingDefault === "error" ? "Could not save" : "Save as this client's default"}
          </button>
          <button className={btnCls} onClick={() => commit(setCaptionStyle(doc, DEFAULT_CAPTION_STYLE))}>Reset</button>
        </div>
      </>
    );
  }
  const tab = tabs.some((t) => t.id === tabByKind[kind]) ? tabByKind[kind] : tabs[0].id;

  return (
    <div className="h-full flex flex-col">
      {/* Header strip: CapCut's tab row (Video · Audio · Speed …), 42 px, filled */}
      <div className="h-[42px] shrink-0 flex items-stretch px-2 bg-surface-2 rounded-t-md">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTabByKind((m) => ({ ...m, [kind]: t.id }))}
            className={`px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors ${tab === t.id ? "text-accent" : "text-ink hover:text-ink-strong"}`}>{t.label}</button>
        ))}
        <span className="flex-1" />
        {onDelete && <button onClick={onDelete} title="Delete" className="self-center h-6 w-6 inline-flex items-center justify-center rounded-[3px] text-ink hover:bg-surface-3"><Icon name="trash" size={13} /></button>}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-5">
        <div className="text-[10px] text-muted pt-2">{kind === "none" ? "Nothing selected" : `Selected · ${title}`}</div>
        {body(tab)}
      </div>
      <div className="h-[39px] shrink-0 flex items-center justify-end px-3 bg-surface-2 rounded-b-md">
        <button disabled title={`Modify — ${NOT_BUILT.toLowerCase()}`} className={btnCls}>Modify</button>
      </div>
    </div>
  );
}
