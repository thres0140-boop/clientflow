// Loads the caption font registry into the page with the FontFace API. The same files are what
// the export ships to libass (fontsdir), so glyph metrics match by construction.
import { CAPTION_FONTS, type CaptionFontFamily } from "@/features/editor/model/captionStyle";

export const CAPTION_FONT_BASE = "/fonts/captions";

const loaded = new Map<CaptionFontFamily, Promise<void>>();

export function loadCaptionFont(family: CaptionFontFamily): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  let p = loaded.get(family);
  if (!p) {
    const spec = CAPTION_FONTS[family];
    p = Promise.all(spec.weights.map((w) => {
      const file = spec.files[w];
      if (!file) return Promise.resolve();
      const face = new FontFace(family, `url(${CAPTION_FONT_BASE}/${file})`, { weight: String(w) });
      return face.load().then((f) => { document.fonts.add(f); }).catch(() => { /* falls back to a system font; the preview then warns */ });
    })).then(() => undefined);
    loaded.set(family, p);
  }
  return p;
}

export function loadAllCaptionFonts(): Promise<void> {
  return Promise.all((Object.keys(CAPTION_FONTS) as CaptionFontFamily[]).map(loadCaptionFont)).then(() => undefined);
}
