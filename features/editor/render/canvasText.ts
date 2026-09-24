// The CANVAS half of "one caption-style definition, two renderers". Draws exactly the properties
// in CaptionStyle and nothing more: if a property is not in the style, it is not drawn here,
// however easy the canvas would make it. The ASS half (Phase 4) reads the same values.
//
// Layout follows ASS semantics so the export lands in the same place: sizes are in canvas px
// (ASS PlayRes = canvas), the line box is the font's ascent + descent (what libass uses), lines
// are the cue's explicit lines (no wrapping), anchor/align/margins map to ASS Alignment and
// MarginL/R/V. The outline is stroked at 2x width under the fill so the visible outline equals
// widthPx (ASS's Outline is measured outward from the glyph edge).
import type { CaptionStyle } from "@/features/editor/model/captionStyle";

export type TextLayout = {
  lines: { text: string; x: number; y: number; width: number; words: { text: string; x: number; width: number }[] }[];
  lineHeight: number;
  ascent: number;
  box: { x: number; y: number; w: number; h: number }; // bounding box of all lines (before outline/box padding)
};

export function fontString(style: CaptionStyle, scale = 1): string {
  const px = Math.max(1, Math.round(style.font.sizePx * scale));
  return `${style.font.italic ? "italic " : ""}${style.font.weight} ${px}px "${style.font.family}"`;
}

function withColorAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
}

function measure(ctx: CanvasRenderingContext2D, text: string, letterSpacing: number): number {
  const m = ctx.measureText(text);
  // Canvas letterSpacing (when supported) is already in measureText; the manual fallback adds it.
  return "letterSpacing" in ctx ? m.width : m.width + letterSpacing * Math.max(0, text.length - 1);
}

/** Lays out explicit lines for a given anchor. `origin` overrides the ASS anchor with a centre
 *  point (used by free text elements, whose position comes from a Transform). */
export function layoutText(
  ctx: CanvasRenderingContext2D, style: CaptionStyle, rawLines: string[], canvas: { width: number; height: number },
  opts: { scale?: number; origin?: { cx: number; cy: number } } = {},
): TextLayout {
  const scale = opts.scale ?? 1;
  ctx.font = fontString(style, scale);
  const ls = style.font.letterSpacingPx * scale;
  if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${ls}px`;
  const lines = rawLines.map((l) => (style.font.uppercase ? l.toUpperCase() : l));
  const probe = ctx.measureText("Hg");
  const ascent = probe.fontBoundingBoxAscent || style.font.sizePx * scale * 0.8;
  const descent = probe.fontBoundingBoxDescent || style.font.sizePx * scale * 0.2;
  const lineHeight = ascent + descent;
  const widths = lines.map((l) => measure(ctx, l, ls));
  const blockW = Math.max(0, ...widths);
  const blockH = lineHeight * lines.length;
  const mH = style.layout.marginHPx * scale, mV = style.layout.marginVPx * scale;

  let top: number;
  if (opts.origin) top = opts.origin.cy - blockH / 2;
  else if (style.layout.anchor === "top") top = mV;
  else if (style.layout.anchor === "middle") top = (canvas.height - blockH) / 2;
  else top = canvas.height - mV - blockH;

  const laid = lines.map((text, i) => {
    const width = widths[i];
    let x: number;
    if (opts.origin) x = style.layout.align === "left" ? opts.origin.cx - blockW / 2 : style.layout.align === "right" ? opts.origin.cx + blockW / 2 - width : opts.origin.cx - width / 2;
    else if (style.layout.align === "left") x = mH;
    else if (style.layout.align === "right") x = canvas.width - mH - width;
    else x = (canvas.width - width) / 2;
    const y = top + i * lineHeight + ascent; // baseline
    // Word boxes for the active-word highlight: measured cumulatively so spacing matches the line.
    const words: { text: string; x: number; width: number }[] = [];
    let cursor = x;
    const parts = text.split(" ");
    for (let p = 0; p < parts.length; p++) {
      const w = measure(ctx, parts[p], ls);
      words.push({ text: parts[p], x: cursor, width: w });
      cursor += w + measure(ctx, " ", ls);
    }
    return { text, x, y, width, words };
  });
  const minX = Math.min(...laid.map((l) => l.x), opts.origin ? opts.origin.cx : canvas.width);
  return { lines: laid, lineHeight, ascent, box: { x: minX, y: top, w: blockW, h: blockH } };
}

/** Draws laid-out text. `activeWord` = { line, index } colours one word with highlight.color. */
export function drawText(ctx: CanvasRenderingContext2D, style: CaptionStyle, layout: TextLayout, opts: { scale?: number; opacity?: number; activeWord?: { line: number; index: number } | null } = {}) {
  const scale = opts.scale ?? 1;
  ctx.save();
  ctx.globalAlpha = opts.opacity ?? 1;
  ctx.font = fontString(style, scale);
  if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${style.font.letterSpacingPx * scale}px`;
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const outlineW = style.outline.widthPx * scale;
  const shadowOff = style.shadow.offsetPx * scale;

  // Box (ASS BorderStyle 4): one rectangle per line behind the glyphs.
  if (style.box.enabled) {
    ctx.fillStyle = withColorAlpha(style.box.color, style.box.opacity);
    const pad = style.box.paddingPx * scale;
    for (const l of layout.lines) {
      ctx.fillRect(l.x - pad, l.y - layout.ascent - pad, l.width + pad * 2, layout.lineHeight + pad * 2);
    }
  }

  const drawLine = (l: TextLayout["lines"][number], lineIndex: number, pass: "shadow" | "outline" | "fill") => {
    const draw = (text: string, x: number, y: number, fill: string) => {
      if (pass === "shadow") {
        if (shadowOff <= 0) return;
        ctx.fillStyle = withColorAlpha(style.shadow.color, style.shadow.opacity);
        if (outlineW > 0) { ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = outlineW * 2; ctx.strokeText(text, x + shadowOff, y + shadowOff); }
        ctx.fillText(text, x + shadowOff, y + shadowOff);
      } else if (pass === "outline") {
        if (outlineW <= 0) return;
        ctx.strokeStyle = style.outline.color; ctx.lineWidth = outlineW * 2; ctx.strokeText(text, x, y);
      } else {
        ctx.fillStyle = fill; ctx.fillText(text, x, y);
      }
    };
    const active = opts.activeWord && opts.activeWord.line === lineIndex ? opts.activeWord.index : -1;
    if (pass === "fill" && style.highlight.mode === "color" && active >= 0) {
      l.words.forEach((w, i) => draw(w.text, w.x, l.y, i === active ? style.highlight.color : style.fill.color));
    } else {
      draw(l.text, l.x, l.y, style.fill.color);
    }
  };
  // Same order libass uses: shadow, then outline, then fill, per whole block.
  for (const pass of ["shadow", "outline", "fill"] as const) layout.lines.forEach((l, i) => drawLine(l, i, pass));
  ctx.restore();
}
