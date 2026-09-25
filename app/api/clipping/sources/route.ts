import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/db/prisma";
import { mayAccessClient, sessionFrom } from "@/features/editor/server/access";
import type { ClipRow, ClipSource } from "@/features/youtube/model/clipping";

export const runtime = "nodejs";

// GET /api/clipping/sources?clientId= — the client's YouTube drafts that have a video to cut
// from (a finished video, else raw uploads), newest first, each with the clips already cut
// from it (their trim window comes from the clip's edit project document).
export async function GET(req: NextRequest) {
  const session = await sessionFrom(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const clientId = parseInt(req.nextUrl.searchParams.get("clientId") || "", 10);
  if (!Number.isFinite(clientId)) return NextResponse.json({ error: "clientId required" }, { status: 400 });
  if (!mayAccessClient(session, clientId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const drafts = await prisma.scriptDraft.findMany({
    where: { clientId, platform: "youtube", isSavedIdea: false },
    select: { id: true, title: true, conceptId: true, rawContentUrls: true, editedVideoUrl: true, updatedAt: true, concept: { select: { name: true } }, stage: { select: { name: true, color: true } } },
    orderBy: { updatedAt: "desc" },
  });
  const ids = drafts.map((d) => d.id);
  const clips = ids.length ? await prisma.scriptDraft.findMany({
    where: { clipOfDraftId: { in: ids } },
    select: { id: true, title: true, platform: true, clipOfDraftId: true, editedVideoUrl: true, stage: { select: { name: true, color: true } }, editProject: { select: { document: true } } },
    orderBy: { id: "asc" },
  }) : [];

  type StoredTrack = { kind?: string; role?: string; clips?: { inMs?: unknown; outMs?: unknown }[] };
  const byId = new Map<number, ClipRow[]>();
  for (const c of clips) {
    if (c.clipOfDraftId == null) continue;
    let inMs = 0, outMs = 0;
    try {
      const doc = JSON.parse(c.editProject?.document || "{}") as { tracks?: StoredTrack[] };
      const main = (doc?.tracks || []).find((t) => t?.kind === "video" && t?.role === "main");
      const first = main?.clips?.[0];
      if (first) { inMs = Number(first.inMs) || 0; outMs = Number(first.outMs) || 0; }
    } catch { /* an unreadable document just shows no window */ }
    const row: ClipRow = { draftId: c.id, title: c.title, platform: c.platform, inMs, outMs, stage: c.stage, hasFinishedVideo: !!c.editedVideoUrl };
    byId.set(c.clipOfDraftId, [...(byId.get(c.clipOfDraftId) || []), row]);
  }

  const sources: ClipSource[] = [];
  for (const d of drafts) {
    let raw: string[] = [];
    try { raw = JSON.parse(d.rawContentUrls || "[]"); } catch { raw = []; }
    raw = raw.filter((u) => typeof u === "string" && u);
    const videos = [
      ...(d.editedVideoUrl ? [{ url: d.editedVideoUrl, label: "Finished video" }] : []),
      ...raw.map((u, i) => ({ url: u, label: raw.length === 1 ? "Raw upload" : `Raw upload ${i + 1}` })),
    ];
    sources.push({
      draftId: d.id, title: d.title, conceptId: d.conceptId, conceptName: d.concept?.name ?? null, stage: d.stage,
      videos, hasFinishedVideo: !!d.editedVideoUrl, updatedAt: d.updatedAt.toISOString(), clips: byId.get(d.id) || [],
    });
  }
  return NextResponse.json({ sources });
}
