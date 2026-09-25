import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/db/prisma";
import { canEditPage } from "@/shared/auth/permissions";
import { mayAccessClient, sessionFrom } from "@/features/editor/server/access";
import { createClipDraft } from "@/features/youtube/server/clips";

export const runtime = "nodejs";

// POST /api/clipping/clips
// { sourceDraftId, sourceUrl, platform, conceptId, title, inMs, outMs, script, meta? }
// Creates the clip's draft in the target platform's Edit stage and its edit project trimmed to
// the window, and answers { draftId, projectId, editUrl }.
export async function POST(req: NextRequest) {
  const session = await sessionFrom(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await canEditPage(req, "ytclipping"))) return NextResponse.json({ error: "You have view-only access to Clipping." }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const sourceDraftId = parseInt(String(body?.sourceDraftId ?? ""), 10);
  const conceptId = parseInt(String(body?.conceptId ?? ""), 10);
  if (!Number.isFinite(sourceDraftId) || !Number.isFinite(conceptId)) return NextResponse.json({ error: "sourceDraftId and conceptId required" }, { status: 400 });
  const source = await prisma.scriptDraft.findUnique({ where: { id: sourceDraftId }, select: { clientId: true } });
  if (!source) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!mayAccessClient(session, source.clientId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const r = await createClipDraft({
    sourceDraftId,
    sourceUrl: String(body?.sourceUrl || ""),
    platform: String(body?.platform || "instagram"),
    conceptId,
    title: String(body?.title || ""),
    inMs: Number(body?.inMs),
    outMs: Number(body?.outMs),
    script: String(body?.script || ""),
    meta: body?.meta && typeof body.meta === "object" ? body.meta : undefined,
    actor: session.type === "owner" ? "Owner" : session.name || "Member",
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ draftId: r.draftId, projectId: r.projectId, editUrl: `/edit/${r.draftId}` });
}
