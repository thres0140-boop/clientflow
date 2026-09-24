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
    const face = new FontFace(family, `url(${CAPTION_FONT_BASE}/${spec.file})`, { weight: String(spec.weights[0]) });
    p = face.load().then((f) => { document.fonts.add(f); }).catch(() => { /* falls back to a system font; the preview then warns */ });
    loaded.set(family, p);
  }
  return p;
}

export function loadAllCaptionFonts(): Promise<void> {
  return Promise.all((Object.keys(CAPTION_FONTS) as CaptionFontFamily[]).map(loadCaptionFont)).then(() => undefined);
}
