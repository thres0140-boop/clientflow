import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/db/prisma";
import { mayAccessClient, sessionFrom } from "@/features/editor/server/access";

export const runtime = "nodejs";

import type { EditQueueRow } from "@/features/editor/model/queue";

// Upload keys are "videos/<Date.now()>-<name>" (see /api/r2/presign and /api/r2/multipart), so
// the arrival time of a raw clip is in its url. Fall back to the draft's updatedAt.
function footageArrivedAt(urls: string[], fallback: Date): Date {
  let best = 0;
  for (const u of urls) {
    const m = /\/videos\/(\d{13})-/.exec(u);
    if (m) best = Math.max(best, Number(m[1]));
  }
  return best ? new Date(best) : fallback;
}

// GET /api/edit-projects/queue — every draft that has raw footage and no finished cut yet,
// newest footage first. The CapCut page in the sidebar lists these.
export async function GET(req: NextRequest) {
  const session = await sessionFrom(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const drafts = await prisma.scriptDraft.findMany({
    where: { isSavedIdea: false, rawContentUrls: { not: "[]" }, OR: [{ editedVideoUrl: null }, { editedVideoUrl: "" }] },
    select: {
      id: true, title: true, clientId: true, rawContentUrls: true, updatedAt: true,
      client: { select: { id: true, name: true, color: true } },
      stage: { select: { name: true, color: true } },
      editProject: { select: { id: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
  const rows: EditQueueRow[] = [];
  for (const d of drafts) {
    if (!mayAccessClient(session, d.clientId)) continue;
    let urls: string[] = [];
    try { urls = JSON.parse(d.rawContentUrls || "[]"); } catch { urls = []; }
    urls = urls.filter((u) => typeof u === "string" && u);
    if (urls.length === 0) continue;
    rows.push({
      draftId: d.id, title: d.title, client: d.client, stage: d.stage,
      clipCount: urls.length, footageAt: footageArrivedAt(urls, d.updatedAt).toISOString(), hasProject: !!d.editProject,
    });
  }
  rows.sort((a, b) => b.footageAt.localeCompare(a.footageAt));
  return NextResponse.json({ rows });
}
