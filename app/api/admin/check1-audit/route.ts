import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/db/prisma";
import { isAdminToken } from "@/shared/auth/adminToken";

export const runtime = "nodejs";

// GET /api/admin/check1-audit?token=<ADMIN_TOKEN>
//
// READ-ONLY. Reports what the "Check 1" removal will touch before anything is changed:
// every stage that will be merged into Final Check (legacy "Check" and "Check 1"), the
// ScriptDrafts sitting in it (ScriptDraft.stageId is onDelete: SetNull — they would drop
// off the board) and the StageHistory rows pointing at it (onDelete: Cascade — they would
// be deleted). Grouped per client + platform, with totals.
const MERGE_NAMES = ["check", "check 1"];

export async function GET(req: NextRequest) {
  if (!isAdminToken(req.nextUrl.searchParams.get("token"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const stages = await prisma.workflowStage.findMany({
    include: { client: { select: { id: true, name: true } } },
    orderBy: [{ clientId: "asc" }, { platform: "asc" }, { order: "asc" }],
  });
  const merge = stages.filter((s) => MERGE_NAMES.includes(s.name.trim().toLowerCase()));
  const ids = merge.map((s) => s.id);

  const [draftGroups, historyGroups] = await Promise.all([
    prisma.scriptDraft.groupBy({ by: ["stageId"], where: { stageId: { in: ids } }, _count: { _all: true } }),
    prisma.stageHistory.groupBy({ by: ["stageId"], where: { stageId: { in: ids } }, _count: { _all: true } }),
  ]);
  const drafts = new Map(draftGroups.map((g) => [g.stageId, g._count._all]));
  const history = new Map(historyGroups.map((g) => [g.stageId, g._count._all]));

  const rows = merge.map((s) => {
    const finalCheck = stages.find((t) => t.clientId === s.clientId && t.platform === s.platform && t.name.trim().toLowerCase() === "final check");
    return {
      stageId: s.id, stageName: s.name, clientId: s.clientId, clientName: s.client?.name ?? null, platform: s.platform,
      draftsInStage: drafts.get(s.id) ?? 0,
      stageHistoryRows: history.get(s.id) ?? 0,
      finalCheckExists: !!finalCheck, finalCheckStageId: finalCheck?.id ?? null,
    };
  });

  return NextResponse.json({
    readOnly: true,
    plan: "each listed stage: move its drafts and StageHistory rows to that client's Final Check (created first if missing), then delete the stage",
    totals: {
      stagesToRemove: rows.length,
      draftsToMove: rows.reduce((n, r) => n + r.draftsInStage, 0),
      stageHistoryRowsToMove: rows.reduce((n, r) => n + r.stageHistoryRows, 0),
      clientsMissingFinalCheck: rows.filter((r) => !r.finalCheckExists).length,
    },
    rows,
  });
}
