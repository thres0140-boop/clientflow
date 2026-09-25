// Selection chrome on the preview: the selected element's bounding box with scale and rotation
// handles, and the guides that appear while dragging (canvas centre lines and the safe margins),
// all in document coordinates. Colours come from the editor's tokens at draw time, never literals.
import type { EditDocument, Ms, TextElement, Transform, VideoClip } from "@/features/editor/model/document";
import { mainTrack, overlayTrack, textTrack } from "@/features/editor/model/timeline";
import { layoutText } from "./canvasText";
import { clipRect } from "./compositor";

export type Box = { cx: number; cy: number; w: number; h: number; rotation: number };
export type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "rotate";
export const HANDLES: HandleId[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
export const ROTATE_HANDLE_OFFSET = 70; // doc px above the top edge

/** Safe margins for a 9:16 reel: the strip the platform's own UI covers. Guides snap to these. */
export const SAFE = { x: 0.05, top: 0.08, bottom: 0.14 } as const;

let measure: CanvasRenderingContext2D | null = null;
function measureCtx(): CanvasRenderingContext2D | null {
  if (measure) return measure;
  if (typeof document === "undefined") return null;
  measure = document.createElement("canvas").getContext("2d");
  return measure;
}

/** The on-canvas box of a text element (its laid-out lines, unrotated). */
export function textBox(doc: EditDocument, el: TextElement): Box | null {
  const ctx = measureCtx();
  if (!ctx) return null;
  const l = layoutText(ctx, el.style, el.text.split("\n"), doc.canvas, { scale: el.transform.scale, origin: { cx: el.transform.x * doc.canvas.width, cy: el.transform.y * doc.canvas.height } });
  const pad = 12;
  return { cx: l.box.x + l.box.w / 2, cy: l.box.y + l.box.h / 2, w: l.box.w + pad * 2, h: l.box.h + pad * 2, rotation: el.transform.rotation };
}

export function clipBox(doc: EditDocument, clip: VideoClip, size: { width: number; height: number } | null): Box {
  const a = doc.assets.find((x) => x.id === clip.assetId);
  const r = clipRect(clip, size ?? { width: a?.width || doc.canvas.width, height: a?.height || doc.canvas.height }, doc.canvas);
  return { cx: r.x + r.w / 2, cy: r.y + r.h / 2, w: r.w, h: r.h, rotation: clip.transform.rotation };
}

export type Selected = { kind: "clip"; trackId: string; id: string } | { kind: "text"; id: string };

/** The selected element's box, or null when it is not on screen at `tMs`. */
export function selectionBox(doc: EditDocument, sel: Selected | null, tMs: Ms, sizeFor: (assetId: string) => { width: number; height: number } | null): { box: Box; transform: Transform } | null {
  if (!sel) return null;
  if (sel.kind === "text") {
    const el = textTrack(doc)?.kind === "text" ? (textTrack(doc) as { elements: TextElement[] }).elements.find((e) => e.id === sel.id) : undefined;
    if (!el || tMs < el.startMs || tMs >= el.endMs) return null;
    const box = textBox(doc, el);
    return box ? { box, transform: el.transform } : null;
  }
  const track = [mainTrack(doc), overlayTrack(doc)].find((t) => t?.id === sel.trackId);
  const clip = track?.clips.find((c) => c.id === sel.id);
  if (!clip || tMs < clip.at || tMs >= clip.at + (clip.outMs - clip.inMs)) return null;
  return { box: clipBox(doc, clip, sizeFor(clip.assetId)), transform: clip.transform };
}

/** Rotates a point about the box centre by -rotation, so hit tests can be done unrotated. */
export function toLocal(box: Box, p: { x: number; y: number }): { x: number; y: number } {
  const a = (-box.rotation * Math.PI) / 180, dx = p.x - box.cx, dy = p.y - box.cy;
  return { x: box.cx + dx * Math.cos(a) - dy * Math.sin(a), y: box.cy + dx * Math.sin(a) + dy * Math.cos(a) };
}

export function handlePoints(box: Box): Record<HandleId, { x: number; y: number }> {
  const l = box.cx - box.w / 2, r = box.cx + box.w / 2, t = box.cy - box.h / 2, b = box.cy + box.h / 2;
  return { nw: { x: l, y: t }, n: { x: box.cx, y: t }, ne: { x: r, y: t }, e: { x: r, y: box.cy }, se: { x: r, y: b }, s: { x: box.cx, y: b }, sw: { x: l, y: b }, w: { x: l, y: box.cy }, rotate: { x: box.cx, y: t - ROTATE_HANDLE_OFFSET } };
}

/** Which handle (if any) is under a document-space point; `tol` in doc px. */
export function hitHandle(box: Box, p: { x: number; y: number }, tol: number): HandleId | null {
  const q = toLocal(box, p);
  const pts = handlePoints(box);
  let best: HandleId | null = null, bestD = tol;
  for (const id of [...HANDLES, "rotate"] as HandleId[]) {
    const d = Math.hypot(pts[id].x - q.x, pts[id].y - q.y);
    if (d <= bestD) { best = id; bestD = d; }
  }
  return best;
}

export function insideBox(box: Box, p: { x: number; y: number }, pad = 0): boolean {
  const q = toLocal(box, p);
  return Math.abs(q.x - box.cx) <= box.w / 2 + pad && Math.abs(q.y - box.cy) <= box.h / 2 + pad;
}

export type Guides = { v: number[]; h: number[] }; // doc-space x positions and y positions to draw

/** Snaps a proposed centre (doc px) to the canvas centre lines and the safe margins when within
 *  `tol`, returning the snapped centre and which guides to show. Edges are snapped by shifting the
 *  centre, so the element keeps its size. */
export function snapCentre(doc: EditDocument, box: Box, cx: number, cy: number, tol: number): { cx: number; cy: number; guides: Guides } {
  const W = doc.canvas.width, H = doc.canvas.height;
  const guides: Guides = { v: [], h: [] };
  const safeL = W * SAFE.x, safeR = W * (1 - SAFE.x), safeT = H * SAFE.top, safeB = H * (1 - SAFE.bottom);
  const candX: { at: number; edge: "c" | "l" | "r" }[] = [{ at: W / 2, edge: "c" }, { at: safeL, edge: "l" }, { at: safeR, edge: "r" }];
  const candY: { at: number; edge: "c" | "t" | "b" }[] = [{ at: H / 2, edge: "c" }, { at: safeT, edge: "t" }, { at: safeB, edge: "b" }];
  let bx = cx, bestX = tol + 1;
  for (const c of candX) {
    const pos = c.edge === "c" ? cx : c.edge === "l" ? cx - box.w / 2 : cx + box.w / 2;
    const d = Math.abs(pos - c.at);
    if (d <= tol && d < bestX) { bestX = d; bx = cx + (c.at - pos); guides.v = [c.at]; }
  }
  let by = cy, bestY = tol + 1;
  for (const c of candY) {
    const pos = c.edge === "c" ? cy : c.edge === "t" ? cy - box.h / 2 : cy + box.h / 2;
    const d = Math.abs(pos - c.at);
    if (d <= tol && d < bestY) { bestY = d; by = cy + (c.at - pos); guides.h = [c.at]; }
  }
  return { cx: bx, cy: by, guides };
}

/** Draws the box, its handles and any guides. `accent`/`ink` are resolved token values. */
export function drawChrome(ctx: CanvasRenderingContext2D, doc: EditDocument, box: Box | null, guides: Guides | null, colours: { accent: string; ink: string }, dragging: boolean) {
  const W = doc.canvas.width, H = doc.canvas.height;
  ctx.save();
  ctx.lineWidth = 2;
  if (dragging) {
    // Safe-margin frame, faint, so the guides have something to snap against visibly.
    ctx.strokeStyle = colours.ink;
    ctx.globalAlpha = 0.25;
    ctx.setLineDash([8, 8]);
    ctx.strokeRect(W * SAFE.x, H * SAFE.top, W * (1 - 2 * SAFE.x), H * (1 - SAFE.top - SAFE.bottom));
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
  if (guides) {
    ctx.strokeStyle = colours.accent;
    for (const x of guides.v) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (const y of guides.h) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  }
  if (box) {
    ctx.translate(box.cx, box.cy);
    ctx.rotate((box.rotation * Math.PI) / 180);
    ctx.translate(-box.cx, -box.cy);
    ctx.strokeStyle = colours.accent;
    ctx.strokeRect(box.cx - box.w / 2, box.cy - box.h / 2, box.w, box.h);
    const pts = handlePoints(box);
    // Rotation stem + handle
    ctx.beginPath(); ctx.moveTo(box.cx, box.cy - box.h / 2); ctx.lineTo(pts.rotate.x, pts.rotate.y); ctx.stroke();
    ctx.fillStyle = colours.ink;
    for (const id of HANDLES) { const p = pts[id]; ctx.beginPath(); ctx.rect(p.x - 9, p.y - 9, 18, 18); ctx.fill(); ctx.stroke(); }
    ctx.beginPath(); ctx.arc(pts.rotate.x, pts.rotate.y, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

/** Alignment: the centre that puts the element's edge (or centre) on the canvas edge (or centre). */
export function alignedCentre(doc: EditDocument, box: Box, t: Transform, h: "left" | "center" | "right" | null, v: "top" | "middle" | "bottom" | null): Transform {
  const W = doc.canvas.width, H = doc.canvas.height;
  let x = t.x, y = t.y;
  if (h === "left") x = box.w / 2 / W; else if (h === "center") x = 0.5; else if (h === "right") x = 1 - box.w / 2 / W;
  if (v === "top") y = box.h / 2 / H; else if (v === "middle") y = 0.5; else if (v === "bottom") y = 1 - box.h / 2 / H;
  return { ...t, x, y };
}
