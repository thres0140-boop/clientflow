import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { addConceptExample } from "@/lib/conceptExamples";
import { verifySessionToken } from "@/lib/session";
import { sendWhatsApp } from "@/lib/notify";
import { canEditPage } from "@/lib/permissions";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const draft = await prisma.scriptDraft.findUnique({
    where: { id: parseInt(id) },
    include: {
      concept: { select: { name: true, conceptType: true } },
      client: { select: { name: true, color: true } },
      stage: true,
    },
  });
  if (!draft) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(draft);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  // Scheduling/calendar fields are Content-Scheduling edit actions — block view-only members.
  const touchesScheduling = body.scheduledDate !== undefined || body.zernioBooked !== undefined || body.zernioPostId !== undefined;
  if (touchesScheduling && !(await canEditPage(req, "pipeline"))) {
    return NextResponse.json({ error: "You have view-only access to Content Scheduling." }, { status: 403 });
  }

  const data: Record<string, unknown> = {};

  if (body.status !== undefined) data.status = body.status;
  if (body.stageId !== undefined) data.stageId = body.stageId ? parseInt(body.stageId) : null;
  if (body.resurfaceAt !== undefined) data.resurfaceAt = body.resurfaceAt;
  if (body.isSavedIdea !== undefined) data.isSavedIdea = body.isSavedIdea;
  if (body.hook !== undefined) data.hook = body.hook;
  if (body.script !== undefined) data.script = body.script;
  if (body.caption !== undefined) data.caption = body.caption;
  if (body.title !== undefined) data.title = body.title;
  if (body.rawContentUrl !== undefined) data.rawContentUrl = body.rawContentUrl;
  if (body.rawContentUrls !== undefined) data.rawContentUrls = JSON.stringify(body.rawContentUrls);
  if (body.editedVideoUrl !== undefined) data.editedVideoUrl = body.editedVideoUrl || null;
  if (body.checkReviewerIds !== undefined) data.checkReviewerIds = JSON.stringify(body.checkReviewerIds);
  if (body.scheduledDate !== undefined) data.scheduledDate = body.scheduledDate || null;
  if (body.zernioBooked !== undefined) data.zernioBooked = body.zernioBooked === true;
  if (body.zernioPostId !== undefined) data.zernioPostId = body.zernioPostId || null;
  if (body.rejectionFeedback !== undefined) data.rejectionFeedback = body.rejectionFeedback || null;

  // Capture the previous stage + whether it was sent-back (for acceptance + move alerts).
  let prevStageId: number | null | undefined = undefined;
  let wasSentBack = false;
  if (body.stageId !== undefined) {
    const prev = await prisma.scriptDraft.findUnique({ where: { id: parseInt(id) }, select: { stageId: true, rejectionFeedback: true } });
    prevStageId = prev?.stageId ?? null;
    wasSentBack = !!prev?.rejectionFeedback;
  }

  const draft = await prisma.scriptDraft.update({
    where: { id: parseInt(id) },
    data,
    include: {
      concept: { select: { name: true, conceptType: true } },
      client: { select: { name: true, color: true } },
      stage: true,
    },
  });

  // On first acceptance into the pipeline, add the script to the concept's example
  // pool as an accepted-but-unproven draft (labeled recent context, not canon).
  if (prevStageId === null && data.stageId && draft.conceptId && draft.script) {
    addConceptExample(draft.conceptId, draft.script, "accepted_draft", { scriptDraftId: draft.id }).catch(() => {});
  }

  // Stage moved → WhatsApp the owner. Only for moves done BY a team member/client
  // (the owner doesn't need to be alerted about their own moves).
  if (body.stageId !== undefined && prevStageId !== undefined && (data.stageId ?? null) !== (prevStageId ?? null)) {
    try {
      const token = req.cookies.get("cf_session")?.value;
      const session = token ? await verifySessionToken(token) : null;
      if (session && session.type === "member") {
        const actor = session.name || "A team member";
        const newName = draft.stage?.name ?? "Ideas";
        let prevName = "Ideas";
        if (prevStageId) {
          const ps = await prisma.workflowStage.findUnique({ where: { id: prevStageId }, select: { name: true } });
          prevName = ps?.name ?? "a stage";
        }
        const who = draft.client?.name ? ` · ${draft.client.name}` : "";
        const cLabel = draft.concept
          ? (draft.concept.conceptType ? `${draft.concept.conceptType} · ${draft.concept.name}` : draft.concept.name)
          : null;
        const conceptStr = cLabel ? ` (${cLabel})` : "";
        const appUrl = process.env.APP_URL || "https://www.ordoagency.com";
        // Link straight to the thing to review: the finished video if there is one,
        // otherwise the app (Script Kanban).
        const link = draft.editedVideoUrl || appUrl;
        // If this card had been sent back with feedback and is now moving forward,
        // it's a fix → make that explicit instead of a generic "moved".
        const movingForward = (prevStageId ?? -1) < (draft.stageId ?? -1);
        const header = (wasSentBack && movingForward)
          ? `✅ ${actor} fixed & resubmitted "${draft.title}"${conceptStr}${who}\n(you'd sent it back) — now in ${newName}`
          : `📋 ${actor} moved "${draft.title}"${conceptStr}${who}\nfrom ${prevName} → ${newName}`;
        sendWhatsApp(`${header}\n🔗 Check it: ${link}`).catch(() => {});
      }
    } catch { /* non-fatal */ }
  }

  return NextResponse.json(draft);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.scriptDraft.delete({ where: { id: parseInt(id) } });
  return NextResponse.json({ ok: true });
}
