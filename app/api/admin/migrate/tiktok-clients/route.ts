import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/db/prisma";
import { isAdminToken } from "@/shared/auth/adminToken";

export const runtime = "nodejs";
export const maxDuration = 120;

// GET /api/admin/migrate/tiktok-clients?token=   (read-only inventory for the TikTok removal)
//
//   toDelete  — TikTok-ONLY clients: tiktokEnabled = true AND instagramEnabled = false.
//   losingTab — clients with BOTH platforms on: kept, they only lose the TikTok tab.
//
// Each toDelete entry carries a row count per related table so the blast radius of a
// Client delete is visible before it runs. "cascade" tables are removed by the FK when the
// client row goes; "orphan" tables have a clientId but no FK and must be cleaned explicitly.

const P = prisma as any;

async function counts(clientId: number) {
  const cid = { clientId };
  const drafts = await P.scriptDraft.findMany({ where: cid, select: { id: true } });
  const draftIds = drafts.map((d: any) => d.id);
  const pieces = await P.contentPiece.findMany({ where: cid, select: { id: true } });
  const pieceIds = pieces.map((p: any) => p.id);
  const comps = await P.competitor.findMany({ where: cid, select: { id: true } });
  const compIds = comps.map((c: any) => c.id);
  const reels = compIds.length ? await P.competitorReel.findMany({ where: { competitorId: { in: compIds } }, select: { id: true } }) : [];
  const reelIds = reels.map((r: any) => r.id);
  const concepts = await P.concept.findMany({ where: cid, select: { id: true } });
  const conceptIds = concepts.map((c: any) => c.id);
  const or = (ids: number[]) => (ids.length ? ids : [-1]);
  return {
    cascade: {
      InstagramConnection: await P.instagramConnection.count({ where: cid }),
      Creator: await P.creator.count({ where: cid }),
      Message: await P.message.count({ where: cid }),
      TeamMember: await P.teamMember.count({ where: cid }),
      WorkflowStage: await P.workflowStage.count({ where: cid }),
      Board: await P.board.count({ where: cid }),
      Competitor: comps.length,
      CompetitorReel: reels.length,
      CompetitorReelSnapshot: await P.competitorReelSnapshot.count({ where: { reelId: { in: or(reelIds) } } }),
      Concept: concepts.length,
      ConceptExample: await P.conceptExample.count({ where: { conceptId: { in: or(conceptIds) } } }),
      ScriptDraft: drafts.length,
      DraftNote: await P.draftNote.count({ where: { draftId: { in: or(draftIds) } } }),
      DraftChange: await P.draftChange.count({ where: { draftId: { in: or(draftIds) } } }),
      DraftReview: await P.draftReview.count({ where: { draftId: { in: or(draftIds) } } }),
      ContentPiece: pieces.length,
      StageHistory: await P.stageHistory.count({ where: { contentId: { in: or(pieceIds) } } }),
      Notification: await P.notification.count({ where: { contentId: { in: or(pieceIds) } } }),
      TrackedVideo: await P.trackedVideo.count({ where: cid }),
      AnalyticsEntry: await P.analyticsEntry.count({ where: cid }),
      DmLead: await P.dmLead.count({ where: cid }),
      ConceptFeedback: await P.conceptFeedback.count({ where: cid }),
    },
    orphan: {
      CompetitorCandidate: await P.competitorCandidate.count({ where: cid }),
      ActivityEvent: await P.activityEvent.count({ where: cid }),
      ReelSnapshot: await P.reelSnapshot.count({ where: cid }),
      TikTokInstructions: await P.tikTokInstructions.count({ where: cid }),
      TikTokVideoConcept: await P.tikTokVideoConcept.count({ where: cid }),
      TikTokDailySnapshot: await P.tikTokDailySnapshot.count({ where: cid }),
      PushSubscription: await P.pushSubscription.count({ where: cid }),
    },
    // R2 objects referenced by rows that will go (NOT removed by a DB delete — orphaned).
    r2: {
      competitorReelVideos: await P.competitorReel.count({ where: { competitorId: { in: or(compIds) }, cachedVideoUrl: { not: null } } }),
      competitorReelThumbs: await P.competitorReel.count({ where: { competitorId: { in: or(compIds) }, thumbnailUrl: { contains: "r2" } } }),
      draftsWithMedia: await P.scriptDraft.count({ where: { clientId, OR: [{ editedVideoUrl: { not: null } }, { rawContentUrls: { not: "[]" } }, { exampleVideoUrl: { not: null } }] } }),
    },
  };
}

export async function GET(req: NextRequest) {
  if (!isAdminToken(req.nextUrl.searchParams.get("token"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sel = { id: true, name: true, workspaceId: true, tiktokHandle: true, instagramEnabled: true, tiktokEnabled: true, workspace: { select: { name: true } } };
  const tiktokOnly = await P.client.findMany({ where: { tiktokEnabled: true, instagramEnabled: false }, select: sel, orderBy: { id: "asc" } });
  const both = await P.client.findMany({ where: { tiktokEnabled: true, instagramEnabled: true }, select: sel, orderBy: { id: "asc" } });
  const toDelete = [];
  for (const c of tiktokOnly) toDelete.push({ id: c.id, name: c.name, workspace: c.workspace?.name ?? null, tiktokHandle: c.tiktokHandle, ...(await counts(c.id)) });
  return NextResponse.json({
    toDelete,
    losingTab: both.map((c: any) => ({ id: c.id, name: c.name, workspace: c.workspace?.name ?? null, tiktokHandle: c.tiktokHandle })),
    totalClients: await P.client.count(),
  });
}
