"use client";

// Caption presets as a grid of real previews: each card is a canvas painted by the SAME caption
// renderer the preview uses (layoutText + drawText), over a still frame from the project, so the
// owner sees the look in context. Clicking applies the preset to the document's caption style;
// per-cue overrides are untouched. The owner's own presets live per client and can be removed.
import { useEffect, useRef, useState } from "react";
import type { CaptionStyle } from "@/features/editor/model/captionStyle";
import { BUILTIN_PRESETS, type NamedPreset, sameStyle } from "@/features/editor/model/captionPresets";
import { drawText, layoutText } from "@/features/editor/render/canvasText";
import { Icon } from "./icons";

const CANVAS = { width: 1080, height: 1920 };
const SAMPLE = ["DIT IS PRECIES", "WAAROM JE STILSTAAT"];

export type PresetsApi = {
  client: NamedPreset[];
  current: CaptionStyle;
  apply: (style: CaptionStyle) => void;
  saveCurrent: (name: string) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
};

function PresetCard({ preset, still, active, onApply, onRemove }: { preset: NamedPreset; still: string | null; active: boolean; onApply: () => void; onRemove?: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const s = c.width / CANVAS.width;
    const paint = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#000"; // media backdrop, deliberately not themed
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.setTransform(s, 0, 0, s, 0, 0);
      if (img) ctx.drawImage(img, 0, 0, CANVAS.width, CANVAS.height);
      const lines = preset.style.font.uppercase ? SAMPLE : SAMPLE.map((l) => l.toLowerCase());
      const shown = lines.slice(0, preset.style.layout.maxLines);
      const layout = layoutText(ctx, preset.style, shown, CANVAS);
      drawText(ctx, preset.style, layout, { activeWord: preset.style.highlight.mode === "color" ? { line: 0, index: 2 } : null });
    };
    let img: HTMLImageElement | null = null;
    if (still) { img = new Image(); img.onload = paint; img.src = still; }
    paint();
    // Fonts may still be loading on the first paint; repaint once they are in.
    document.fonts?.ready.then(paint).catch(() => {});
  }, [preset, still]);
  return (
    <div className={`group relative rounded-md overflow-hidden border ${active ? "border-accent ring-2 ring-accent/30" : "border-line-soft"} bg-surface-2`}>
      <button onClick={onApply} className="block w-full text-left" title={`Apply "${preset.name}"`}>
        <canvas ref={ref} width={216} height={384} className="block w-full aspect-[9/16]" />
        <div className="px-1.5 py-1 text-[11px] text-ink truncate">{preset.name}</div>
      </button>
      {onRemove && (
        <button onClick={onRemove} title="Remove this preset" className="absolute top-1 right-1 h-6 w-6 rounded-md bg-black/60 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center"><Icon name="trash" size={12} /></button>
      )}
    </div>
  );
}

export default function PresetGrid({ api, still }: { api: PresetsApi; still: string | null }) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    const ok = await api.saveCurrent(name.trim());
    setBusy(false);
    if (ok) { setNaming(false); setName(""); }
  }
  return (
    <div className="space-y-3">
      <div>
        <div className="text-[11px] font-semibold text-ink-2 mb-2">Built in</div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
          {BUILTIN_PRESETS.map((p) => <PresetCard key={p.id} preset={p} still={still} active={sameStyle(p.style, api.current)} onApply={() => api.apply(p.style)} />)}
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold text-ink-2">This client&apos;s</span>
          {!naming && <button onClick={() => setNaming(true)} className="h-7 px-2.5 rounded-md text-[11px] font-semibold border border-line bg-surface text-ink-2 hover:text-ink">Save current as preset</button>}
        </div>
        {naming && (
          <div className="flex items-center gap-1.5 mb-2">
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setNaming(false); }} placeholder="Preset name"
              className="flex-1 h-8 rounded-md border border-line bg-surface px-2 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-accent" />
            <button onClick={save} disabled={busy || !name.trim()} className="h-8 px-2.5 rounded-md text-[11px] font-semibold bg-accent text-on-accent disabled:opacity-50">Save</button>
            <button onClick={() => setNaming(false)} className="h-8 px-2 rounded-md text-[11px] font-semibold text-muted hover:text-ink">Cancel</button>
          </div>
        )}
        {api.client.length === 0 ? (
          <p className="text-[11px] text-faint">None yet. Tune the caption style on the right, then save it here to reuse it on this client&apos;s next reel.</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
            {api.client.map((p) => <PresetCard key={p.id} preset={p} still={still} active={sameStyle(p.style, api.current)} onApply={() => api.apply(p.style)} onRemove={() => api.remove(p.id)} />)}
          </div>
        )}
      </div>
      <p className="text-[10px] text-faint">A preset is a complete caption style and nothing more, so every one exports through libass exactly as previewed. Per-caption overrides survive applying a preset.</p>
    </div>
  );
}
