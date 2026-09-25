// Draws one frame of the document onto a canvas: main clip, overlay clips, captions, text.
// Videos are supplied by the caller as HTMLVideoElements already seeked to the right source time
// (the playback engine owns that); this module only paints.
import type { CaptionCue, EditDocument, Ms, Transform, VideoClip } from "@/features/editor/model/document";
import { animationState, type CaptionStyle, normalizeCaptionStyle } from "@/features/editor/model/captionStyle";
import { captionTrack, clipAt, clipLengthMs, mainTrack, overlayTrack, textTrack } from "@/features/editor/model/timeline";
import { drawText, layoutText } from "./canvasText";

export type FrameSources = { videoFor: (assetId: string) => HTMLVideoElement | null };

/** Fit-height placement: scale 1 = the source fills the canvas height, centred. */
export function clipRect(clip: VideoClip, source: { width: number; height: number }, canvas: { width: number; height: number }) {
  const s = (canvas.height / Math.max(1, source.height)) * clip.transform.scale;
  const w = source.width * s, h = source.height * s;
  return { x: clip.transform.x * canvas.width - w / 2, y: clip.transform.y * canvas.height - h / 2, w, h };
}

function drawClip(ctx: CanvasRenderingContext2D, doc: EditDocument, clip: VideoClip, video: HTMLVideoElement | null) {
  const asset = doc.assets.find((a) => a.id === clip.assetId);
  const w = video?.videoWidth || asset?.width || doc.canvas.width, h = video?.videoHeight || asset?.height || doc.canvas.height;
  const r = clipRect(clip, { width: w, height: h }, doc.canvas);
  ctx.save();
  ctx.globalAlpha = clip.transform.opacity;
  if (clip.transform.rotation) {
    ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
    ctx.rotate((clip.transform.rotation * Math.PI) / 180);
    ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2));
  }
  if (video && video.readyState >= 2) {
    try { ctx.drawImage(video, r.x, r.y, r.w, r.h); } catch { /* not decodable yet */ }
  } else {
    ctx.fillStyle = "#1a1a1a"; ctx.fillRect(r.x, r.y, r.w, r.h); // media placeholder, deliberately not themed
  }
  ctx.restore();
}

export function activeWordIndex(cue: CaptionCue, tMs: Ms): { line: number; index: number } | null {
  if (!cue.words) return null;
  const i = cue.words.findIndex((w) => tMs >= w.startMs && tMs < w.endMs);
  if (i < 0) return null;
  // Words are laid out per line in order; map the flat index onto (line, index).
  let remaining = i;
  for (let l = 0; l < cue.lines.length; l++) {
    const n = cue.lines[l].split(" ").length;
    if (remaining < n) return { line: l, index: remaining };
    remaining -= n;
  }
  return null;
}

/** Captions and text only, in document coordinates (the caller sets the transform that maps
 *  1080x1920 onto the on-screen canvas). This is what the preview paints on a TRANSPARENT canvas
 *  layered over real <video> elements; the video pixels are never copied. */
export function drawOverlay(ctx: CanvasRenderingContext2D, doc: EditDocument, tMs: Ms) {
  const { width, height } = doc.canvas;
  const captions = captionTrack(doc);
  if (captions && captions.kind === "caption") {
    const cue = captions.cues.find((q) => tMs >= q.startMs && tMs < q.endMs);
    if (cue && cue.lines.some((l) => l.trim())) {
      const style = cueStyle(doc, captions.styleOverride, cue);
      const layout = layoutText(ctx, style, cue.lines, doc.canvas);
      const a = animationState(style, tMs, cue.startMs, cue.endMs);
      ctx.save();
      if (a.dx || a.dy || a.scale !== 1) {
        const cx = layout.box.x + layout.box.w / 2, cy = layout.box.y + layout.box.h / 2;
        ctx.translate(cx + a.dx, cy + a.dy); ctx.scale(a.scale, a.scale); ctx.translate(-cx, -cy);
      }
      drawText(ctx, style, layout, { activeWord: activeWordIndex(cue, tMs), opacity: a.alpha });
      ctx.restore();
    }
  }
  const texts = textTrack(doc);
  if (texts && texts.kind === "text") {
    for (const el of texts.elements) {
      if (tMs < el.startMs || tMs >= el.endMs || !el.text.trim()) continue;
      const cx = el.transform.x * width, cy = el.transform.y * height;
      const layout = layoutText(ctx, el.style, el.text.split("\n"), doc.canvas, { scale: el.transform.scale, origin: { cx, cy } });
      const a = animationState(el.style, tMs, el.startMs, el.endMs);
      ctx.save();
      ctx.translate(cx + a.dx, cy + a.dy);
      if (el.transform.rotation) ctx.rotate((el.transform.rotation * Math.PI) / 180);
      if (a.scale !== 1) ctx.scale(a.scale, a.scale);
      ctx.translate(-cx, -cy);
      drawText(ctx, el.style, layout, { scale: el.transform.scale, opacity: el.transform.opacity * a.alpha });
      ctx.restore();
    }
  }
}

/** The style a cue is drawn with: the document style, then the track's override, then the cue's own. */
export function cueStyle(doc: EditDocument, trackOverride: Partial<CaptionStyle> | null, cue: CaptionCue): CaptionStyle {
  const base = trackOverride ? normalizeCaptionStyle({ ...doc.captionStyle, ...trackOverride }, doc.captionStyle) : doc.captionStyle;
  return cue.styleOverride ? normalizeCaptionStyle({ ...base, ...cue.styleOverride }, base) : base;
}

/** A cheap fingerprint of what drawOverlay would paint at `tMs`: when it has not changed since
 *  the last paint, the paint is skipped. */
export function overlayKey(doc: EditDocument, tMs: Ms): string {
  const parts: string[] = [];
  const captions = captionTrack(doc);
  if (captions && captions.kind === "caption") {
    const cue = captions.cues.find((q) => tMs >= q.startMs && tMs < q.endMs);
    if (cue) { const w = activeWordIndex(cue, tMs); parts.push(`q:${cue.id}:${w ? `${w.line}.${w.index}` : "-"}`); }
  }
  const texts = textTrack(doc);
  if (texts && texts.kind === "text") for (const el of texts.elements) if (tMs >= el.startMs && tMs < el.endMs) {
    parts.push(`t:${el.id}`);
    if (animationState(el.style, tMs, el.startMs, el.endMs).active) parts.push(`a${tMs}`);
  }
  if (captions && captions.kind === "caption") {
    const cue = captions.cues.find((q) => tMs >= q.startMs && tMs < q.endMs);
    if (cue && animationState(cueStyle(doc, captions.styleOverride, cue), tMs, cue.startMs, cue.endMs).active) parts.push(`a${tMs}`);
  }
  return parts.join("|");
}

/** The spike / test path: paints video frames AND the overlay onto one canvas. The editor's
 *  preview no longer uses this (see drawOverlay); kept for the model tests. */
export function drawFrame(ctx: CanvasRenderingContext2D, doc: EditDocument, tMs: Ms, sources: FrameSources) {
  const { width, height } = doc.canvas;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#000"; // the video backdrop, same in both themes
  ctx.fillRect(0, 0, width, height);

  const main = clipAt(mainTrack(doc), tMs);
  if (main) drawClip(ctx, doc, main.clip, sources.videoFor(main.clip.assetId));

  const overlay = overlayTrack(doc);
  if (overlay) {
    for (const c of overlay.clips) {
      if (tMs >= c.at && tMs < c.at + clipLengthMs(c)) drawClip(ctx, doc, c, sources.videoFor(c.assetId));
    }
  }

  const captions = captionTrack(doc);
  if (captions && captions.kind === "caption") {
    const cue = captions.cues.find((q) => tMs >= q.startMs && tMs < q.endMs);
    if (cue && cue.lines.some((l) => l.trim())) {
      const style = cueStyle(doc, captions.styleOverride, cue);
      const layout = layoutText(ctx, style, cue.lines, doc.canvas);
      drawText(ctx, style, layout, { activeWord: activeWordIndex(cue, tMs) });
    }
  }

  const texts = textTrack(doc);
  if (texts && texts.kind === "text") {
    for (const el of texts.elements) {
      if (tMs < el.startMs || tMs >= el.endMs || !el.text.trim()) continue;
      const layout = layoutText(ctx, el.style, el.text.split("\n"), doc.canvas, { scale: el.transform.scale, origin: { cx: el.transform.x * width, cy: el.transform.y * height } });
      drawText(ctx, el.style, layout, { scale: el.transform.scale, opacity: el.transform.opacity });
    }
  }
}

/** Hit-test text elements for dragging on the preview (canvas px). */
export function textElementAt(ctx: CanvasRenderingContext2D, doc: EditDocument, tMs: Ms, x: number, y: number): string | null {
  const texts = textTrack(doc);
  if (!texts || texts.kind !== "text") return null;
  for (let i = texts.elements.length - 1; i >= 0; i--) {
    const el = texts.elements[i];
    if (tMs < el.startMs || tMs >= el.endMs) continue;
    const cx = el.transform.x * doc.canvas.width, cy = el.transform.y * doc.canvas.height;
    const l = layoutText(ctx, el.style, el.text.split("\n"), doc.canvas, { scale: el.transform.scale, origin: { cx, cy } });
    // Undo the element's rotation about its centre, then test the unrotated box.
    const a = (-el.transform.rotation * Math.PI) / 180, dx = x - cx, dy = y - cy;
    const lx = cx + dx * Math.cos(a) - dy * Math.sin(a), ly = cy + dx * Math.sin(a) + dy * Math.cos(a);
    const pad = 24;
    if (lx >= l.box.x - pad && lx <= l.box.x + l.box.w + pad && ly >= l.box.y - pad && ly <= l.box.y + l.box.h + pad) return el.id;
  }
  return null;
}

export function transformPatch(t: Transform, patch: Partial<Transform>): Transform {
  return { ...t, ...patch };
}
