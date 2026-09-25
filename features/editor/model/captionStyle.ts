// The ONE caption-style definition. Two renderers consume it and nothing else may define how a
// caption looks: the editor's canvas preview (Phase 2) and the export's libass/ASS render
// (Phase 4). Every property here is expressed in the canvas' own pixel space (1080x1920 by
// default; ASS gets PlayResX/PlayResY = canvas so px map 1:1) and only in terms both renderers
// implement the same way. Anything a browser canvas can do that ASS cannot (or vice versa) is
// deliberately NOT a property. See PARITY below for what is guaranteed and what is not.
//
// Client-safe: no server imports.

export type HexColor = `#${string}`; // #rrggbb

/** Fonts available to captions. The same file is served to the canvas (@font-face) and shipped
 *  to the renderer (fontsdir), which is what makes glyph metrics identical on both sides.
 *  Files land in public/fonts/captions/ in Phase 2; the registry is fixed now so the
 *  definition cannot drift towards "whatever the browser has installed". */
export type CaptionFontFamily = "Roboto" | "Inter" | "Montserrat" | "Bebas Neue";
export type CaptionFontWeight = 400 | 700 | 800;
/** One TTF per (family, weight); both renderers load exactly these files. */
export const CAPTION_FONTS: Record<CaptionFontFamily, { files: Partial<Record<CaptionFontWeight, string>>; weights: CaptionFontWeight[] }> = {
  Roboto: { files: { 700: "Roboto-Bold.ttf" }, weights: [700] },
  Inter: { files: { 400: "Inter-Regular.ttf", 700: "Inter-Bold.ttf" }, weights: [400, 700] },
  Montserrat: { files: { 800: "Montserrat-ExtraBold.ttf" }, weights: [800] },
  "Bebas Neue": { files: { 400: "BebasNeue-Regular.ttf" }, weights: [400] },
};

/** Entrance / exit animation. Each maps to libass: fade = \fad, slide* = \move (linear, from
 *  ANIMATION_SLIDE_PX away), pop = \t on \fscx\fscy from ANIMATION_POP_FROM% (linear). A cue with
 *  both a slide-in and a slide-out is exported as two ASS events (one \move per line). Timing is
 *  linear on both sides on purpose; durations are capped at half the element's on-screen time. */
export type AnimationType = "none" | "fade" | "slideleft" | "slideright" | "slideup" | "slidedown" | "pop";
export const ANIMATION_TYPES: AnimationType[] = ["none", "fade", "slideleft", "slideright", "slideup", "slidedown", "pop"];
export type AnimationSpec = { type: AnimationType; durationMs: number };
export const ANIMATION_SLIDE_PX = 160;
export const ANIMATION_POP_FROM = 60; // percent
export const ANIMATION_MAX_MS = 2000;

export type CaptionAnchor = "top" | "middle" | "bottom";
export type CaptionAlign = "left" | "center" | "right";

export type CaptionStyle = {
  v: 1;
  font: {
    family: CaptionFontFamily;
    weight: CaptionFontWeight;
    sizePx: number;           // glyph size in canvas px (ASS Fontsize)
    letterSpacingPx: number;  // ASS Spacing
    italic: boolean;          // ASS Italic (synthetic on both sides when the file has no italic)
    uppercase: boolean;       // applied to the TEXT before either renderer sees it
  };
  fill: { color: HexColor };                                  // ASS PrimaryColour
  outline: { color: HexColor; widthPx: number };              // ASS OutlineColour + Outline, BorderStyle 1
  shadow: { color: HexColor; offsetPx: number; opacity: number }; // ASS BackColour + Shadow; one diagonal offset, no blur
  box: { enabled: boolean; color: HexColor; opacity: number; paddingPx: number }; // ASS BorderStyle 4 (box per line)
  layout: {
    anchor: CaptionAnchor;    // ASS Alignment row (7-9 / 4-6 / 1-3)
    align: CaptionAlign;      // ASS Alignment column
    marginVPx: number;        // distance from the anchored edge (ASS MarginV); ignored for "middle"
    marginHPx: number;        // ASS MarginL = MarginR
    maxLines: 1 | 2 | 3;      // cues are pre-wrapped into explicit lines; no renderer auto-wraps
    wordsPerCue: number;      // 1..6, how the transcript is chunked into cues (Phase 3)
  };
  highlight: {
    mode: "none" | "color";   // colour change on the word being spoken (ASS per-word \1c override)
    color: HexColor;
  };
  animation: { in: AnimationSpec; out: AnimationSpec }; // entrance / exit, see AnimationType
};

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  v: 1,
  font: { family: "Roboto", weight: 700, sizePx: 72, letterSpacingPx: 0, italic: false, uppercase: true },
  fill: { color: "#ffffff" },
  outline: { color: "#000000", widthPx: 5 },
  shadow: { color: "#000000", offsetPx: 2, opacity: 0.5 },
  box: { enabled: false, color: "#000000", opacity: 0.6, paddingPx: 16 },
  layout: { anchor: "bottom", align: "center", marginVPx: 420, marginHPx: 60, maxLines: 2, wordsPerCue: 2 },
  highlight: { mode: "none", color: "#ffe34d" },
  animation: { in: { type: "none", durationMs: 250 }, out: { type: "none", durationMs: 250 } },
};

/** What the two renderers are held to, property by property. "exact" means the same numbers
 *  produce the same result on both (positions within 1 px, the width of a font hinting
 *  difference). "approximate" means both draw it but the shape is not byte-identical.
 *  Anything not listed is not a property of the style, on purpose. */
export const PARITY = {
  exact: [
    "font.family / font.weight (same TTF on both sides)",
    "font.sizePx (ASS PlayRes = canvas px)",
    "font.letterSpacingPx (ASS Spacing)",
    "font.uppercase (applied to the text, not by a renderer)",
    "fill.color",
    "outline.color / outline.widthPx",
    "layout.anchor / layout.align / marginVPx / marginHPx (ASS Alignment + margins)",
    "layout.maxLines: line breaks are explicit in the cue (\\N), never auto-wrapped",
    "cue timing and words-per-cue",
    "highlight.mode=color (per-word colour override)",
    "font.italic when the font file has a true italic; synthetic otherwise on both sides",
    "animation in/out: fade (\\fad), slide (\\move, linear, 160 px), pop (\\t \\fscx\\fscy 60→100, linear); durations capped at half the on-screen time on both sides; a slide-in plus a slide-out exports as two events",
  ],
  approximate: [
    "shadow: ASS has one diagonal offset and no blur; the canvas is restricted to the same",
    "box: ASS BorderStyle 4 pads by the outline width per line; the canvas pads by paddingPx per line, and the box's outer shape is a plain rectangle on both",
    "outline joins: libass and canvas round corners slightly differently at widths > 6 px",
    "emoji: both fall back to a system emoji font, which differs per machine",
    "text-element rotation (Transform.rotation): canvas rotates the laid-out block about its centre; ASS \\frz with \\org at the same centre rotates the glyph run — identical for one line, within a few px for multi-line blocks",
  ],
  notRepresentable: [
    "line height / leading (ASS has none)",
    "gradient or image fills",
    "blur, glow, rounded box corners",
    "per-letter or per-word animation (pop, bounce, typewriter)",
    "mixed fonts or sizes inside one cue",
  ],
} as const;

const HEX = /^#[0-9a-fA-F]{6}$/;
const clamp = (n: unknown, lo: number, hi: number, d: number) => (typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d);
const hex = (v: unknown, d: HexColor): HexColor => (typeof v === "string" && HEX.test(v) ? (v.toLowerCase() as HexColor) : d);

/* eslint-disable @typescript-eslint/no-explicit-any -- `any` is confined to coercing untrusted JSON below */
/** Coerces any stored JSON (an older version, a partial override, garbage) into a valid style.
 *  Unknown fonts fall back to the default font; out-of-range numbers are clamped. */
export function normalizeCaptionStyle(input: unknown, base: CaptionStyle = DEFAULT_CAPTION_STYLE): CaptionStyle {
  const s = (input && typeof input === "object" ? input : {}) as Record<string, any>;
  const font = s.font ?? {}, fill = s.fill ?? {}, outline = s.outline ?? {}, shadow = s.shadow ?? {}, box = s.box ?? {}, layout = s.layout ?? {}, highlight = s.highlight ?? {}, anim = s.animation ?? {};
  const spec = (v: any, d: AnimationSpec): AnimationSpec => ({ type: ANIMATION_TYPES.includes(v?.type) ? v.type : d.type, durationMs: Math.round(clamp(v?.durationMs, 50, ANIMATION_MAX_MS, d.durationMs)) });
  const family: CaptionFontFamily = font.family in CAPTION_FONTS ? font.family : base.font.family;
  const weights = CAPTION_FONTS[family].weights;
  return {
    v: 1,
    font: {
      family,
      weight: weights.includes(font.weight) ? font.weight : weights[0],
      sizePx: clamp(font.sizePx, 24, 200, base.font.sizePx),
      letterSpacingPx: clamp(font.letterSpacingPx, -10, 40, base.font.letterSpacingPx),
      italic: typeof font.italic === "boolean" ? font.italic : base.font.italic,
      uppercase: typeof font.uppercase === "boolean" ? font.uppercase : base.font.uppercase,
    },
    fill: { color: hex(fill.color, base.fill.color) },
    outline: { color: hex(outline.color, base.outline.color), widthPx: clamp(outline.widthPx, 0, 20, base.outline.widthPx) },
    shadow: { color: hex(shadow.color, base.shadow.color), offsetPx: clamp(shadow.offsetPx, 0, 20, base.shadow.offsetPx), opacity: clamp(shadow.opacity, 0, 1, base.shadow.opacity) },
    box: { enabled: typeof box.enabled === "boolean" ? box.enabled : base.box.enabled, color: hex(box.color, base.box.color), opacity: clamp(box.opacity, 0, 1, base.box.opacity), paddingPx: clamp(box.paddingPx, 0, 60, base.box.paddingPx) },
    layout: {
      anchor: (["top", "middle", "bottom"] as const).includes(layout.anchor) ? layout.anchor : base.layout.anchor,
      align: (["left", "center", "right"] as const).includes(layout.align) ? layout.align : base.layout.align,
      marginVPx: clamp(layout.marginVPx, 0, 1000, base.layout.marginVPx),
      marginHPx: clamp(layout.marginHPx, 0, 400, base.layout.marginHPx),
      maxLines: ([1, 2, 3] as const).includes(layout.maxLines) ? layout.maxLines : base.layout.maxLines,
      wordsPerCue: Math.round(clamp(layout.wordsPerCue, 1, 6, base.layout.wordsPerCue)),
    },
    highlight: { mode: highlight.mode === "color" ? "color" : "none", color: hex(highlight.color, base.highlight.color) },
    animation: { in: spec(anim.in, base.animation.in), out: spec(anim.out, base.animation.out) },
  };
}

/** Progress of the entrance/exit at `tMs` for an element on screen from startMs to endMs:
 *  `enter` runs 0→1 over the in-duration, `exit` 1→0 over the out-duration, both linear, both
 *  capped at half the on-screen time. Returned as multipliers the renderers apply identically. */
export function animationState(style: CaptionStyle, tMs: number, startMs: number, endMs: number): { alpha: number; dx: number; dy: number; scale: number; active: boolean } {
  const len = Math.max(1, endMs - startMs);
  const cap = len / 2;
  const din = style.animation.in.type === "none" ? 0 : Math.min(cap, style.animation.in.durationMs);
  const dout = style.animation.out.type === "none" ? 0 : Math.min(cap, style.animation.out.durationMs);
  let alpha = 1, dx = 0, dy = 0, scale = 1, active = false;
  const apply = (type: AnimationType, p: number) => { // p: 1 = fully on screen, 0 = fully off
    if (type === "fade") alpha *= p;
    else if (type === "slideleft") dx += (1 - p) * ANIMATION_SLIDE_PX;   // enters from the right, leaves to the left → mirrored below
    else if (type === "slideright") dx -= (1 - p) * ANIMATION_SLIDE_PX;
    else if (type === "slideup") dy += (1 - p) * ANIMATION_SLIDE_PX;
    else if (type === "slidedown") dy -= (1 - p) * ANIMATION_SLIDE_PX;
    else if (type === "pop") scale *= ANIMATION_POP_FROM / 100 + (1 - ANIMATION_POP_FROM / 100) * p;
  };
  if (din > 0 && tMs < startMs + din) { active = true; apply(style.animation.in.type, Math.max(0, (tMs - startMs) / din)); }
  if (dout > 0 && tMs >= endMs - dout) {
    active = true;
    // On exit a slide continues in the same direction: leftwards for "slideleft", etc.
    const p = Math.max(0, (endMs - tMs) / dout);
    const t = style.animation.out.type;
    if (t === "fade") alpha *= p;
    else if (t === "slideleft") dx -= (1 - p) * ANIMATION_SLIDE_PX;
    else if (t === "slideright") dx += (1 - p) * ANIMATION_SLIDE_PX;
    else if (t === "slideup") dy -= (1 - p) * ANIMATION_SLIDE_PX;
    else if (t === "slidedown") dy += (1 - p) * ANIMATION_SLIDE_PX;
    else if (t === "pop") scale *= ANIMATION_POP_FROM / 100 + (1 - ANIMATION_POP_FROM / 100) * p;
  }
  return { alpha, dx, dy, scale, active };
}

/** Reads Client.subtitleStyle (a JSON string, bare-parsed like every other JSON column) with a
 *  fallback to the built-in default. The column holds either a bare style or
 *  { default, presets } (see captionPresets.ts). Client.captionStyle / captionGuidelines are
 *  prose briefs for WRITING Instagram post captions and are not consulted here. */
export function captionStyleForClient(subtitleStyle: string | null | undefined): CaptionStyle {
  if (!subtitleStyle) return DEFAULT_CAPTION_STYLE;
  try {
    const j = JSON.parse(subtitleStyle);
    if (j && typeof j === "object" && ("presets" in j || "default" in j)) return j.default ? normalizeCaptionStyle(j.default) : DEFAULT_CAPTION_STYLE;
    return normalizeCaptionStyle(j);
  } catch { return DEFAULT_CAPTION_STYLE; }
}
