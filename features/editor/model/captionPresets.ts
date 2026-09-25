// Caption presets: named, complete CaptionStyles. Built-ins cover the looks short-form fitness
// reels actually use; the owner's own are stored per client. Every preset is a CaptionStyle and
// nothing more, so every preset crosses to libass by construction — a look that would need a
// property outside the parity table (gradient text, per-word pop, rounded boxes) is not here.
//
// Client.subtitleStyle holds either a bare CaptionStyle (the original "client default", still
// accepted) or { default: CaptionStyle | null, presets: NamedPreset[] } — one column, both
// shapes readable, no migration. Client-safe: no server imports.
import { type CaptionStyle, DEFAULT_CAPTION_STYLE, normalizeCaptionStyle } from "./captionStyle";

export type NamedPreset = { id: string; name: string; style: CaptionStyle };
export type ClientCaptionSettings = { default: CaptionStyle | null; presets: NamedPreset[] };

const base = DEFAULT_CAPTION_STYLE;
const mk = (id: string, name: string, patch: Parameters<typeof normalizeCaptionStyle>[0]): NamedPreset => ({ id, name, style: normalizeCaptionStyle(patch, base) });

export const BUILTIN_PRESETS: NamedPreset[] = [
  mk("bold-outline", "Bold outline", {
    font: { family: "Montserrat", weight: 800, sizePx: 84, uppercase: true, letterSpacingPx: 1 },
    fill: { color: "#ffffff" }, outline: { color: "#000000", widthPx: 8 }, shadow: { offsetPx: 0 },
    layout: { anchor: "bottom", marginVPx: 420, maxLines: 2, wordsPerCue: 3 }, highlight: { mode: "none" },
  }),
  mk("spoken-yellow", "Spoken word · yellow", {
    font: { family: "Montserrat", weight: 800, sizePx: 80, uppercase: true },
    fill: { color: "#ffffff" }, outline: { color: "#000000", widthPx: 6 }, shadow: { offsetPx: 3, opacity: 0.6 },
    layout: { anchor: "bottom", marginVPx: 440, maxLines: 2, wordsPerCue: 4 }, highlight: { mode: "color", color: "#ffe34d" },
  }),
  mk("spoken-accent", "Spoken word · green", {
    font: { family: "Inter", weight: 700, sizePx: 76, uppercase: true },
    fill: { color: "#ffffff" }, outline: { color: "#000000", widthPx: 5 }, shadow: { offsetPx: 2, opacity: 0.5 },
    layout: { anchor: "middle", maxLines: 2, wordsPerCue: 3 }, highlight: { mode: "color", color: "#39ff88" },
  }),
  mk("boxed", "Boxed lines", {
    font: { family: "Inter", weight: 700, sizePx: 66, uppercase: false },
    fill: { color: "#ffffff" }, outline: { widthPx: 0 }, shadow: { offsetPx: 0 },
    box: { enabled: true, color: "#000000", opacity: 0.85, paddingPx: 18 },
    layout: { anchor: "bottom", marginVPx: 400, maxLines: 2, wordsPerCue: 4 }, highlight: { mode: "none" },
  }),
  mk("boxed-yellow", "Boxed · yellow on black", {
    font: { family: "Montserrat", weight: 800, sizePx: 70, uppercase: true },
    fill: { color: "#ffe34d" }, outline: { widthPx: 0 }, shadow: { offsetPx: 0 },
    box: { enabled: true, color: "#000000", opacity: 0.9, paddingPx: 16 },
    layout: { anchor: "bottom", marginVPx: 420, maxLines: 2, wordsPerCue: 3 }, highlight: { mode: "none" },
  }),
  mk("minimal", "Minimal lowercase", {
    font: { family: "Inter", weight: 400, sizePx: 54, uppercase: false, letterSpacingPx: 0 },
    fill: { color: "#ffffff" }, outline: { color: "#000000", widthPx: 2 }, shadow: { offsetPx: 2, opacity: 0.4 },
    layout: { anchor: "bottom", marginVPx: 380, maxLines: 2, wordsPerCue: 5 }, highlight: { mode: "none" },
  }),
  mk("hook", "Hook · big centred line", {
    font: { family: "Bebas Neue", weight: 400, sizePx: 150, uppercase: true, letterSpacingPx: 2 },
    fill: { color: "#ffffff" }, outline: { color: "#000000", widthPx: 6 }, shadow: { offsetPx: 4, opacity: 0.6 },
    layout: { anchor: "middle", align: "center", maxLines: 1, wordsPerCue: 4 }, highlight: { mode: "none" },
  }),
];

/** Reads Client.subtitleStyle in either shape. */
export function parseClientCaptionSettings(column: string | null | undefined): ClientCaptionSettings {
  if (!column) return { default: null, presets: [] };
  try {
    const j = JSON.parse(column);
    if (j && typeof j === "object" && ("presets" in j || "default" in j)) {
      const presets = (Array.isArray(j.presets) ? j.presets : []).filter((p: unknown) => p && typeof (p as NamedPreset).id === "string").map((p: NamedPreset) => ({ id: p.id, name: typeof p.name === "string" && p.name.trim() ? p.name.trim().slice(0, 40) : "Preset", style: normalizeCaptionStyle(p.style) }));
      return { default: j.default ? normalizeCaptionStyle(j.default) : null, presets };
    }
    return { default: normalizeCaptionStyle(j), presets: [] }; // legacy: a bare style
  } catch { return { default: null, presets: [] }; }
}

/** The client's default style, whichever shape the column has. */
export function clientDefaultStyle(column: string | null | undefined): CaptionStyle {
  return parseClientCaptionSettings(column).default ?? DEFAULT_CAPTION_STYLE;
}

/** A style is "this preset" when every property matches (used to mark the active preset). */
export function sameStyle(a: CaptionStyle, b: CaptionStyle): boolean {
  return JSON.stringify(normalizeCaptionStyle(a)) === JSON.stringify(normalizeCaptionStyle(b));
}
