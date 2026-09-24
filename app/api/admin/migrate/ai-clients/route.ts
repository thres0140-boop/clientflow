import { NextRequest, NextResponse } from "next/server";
import { prisma as agency } from "@/shared/db/prisma";
import { prisma as ai } from "@/ai/db/prisma";
import { isAdminToken } from "@/shared/auth/adminToken";

export const runtime = "nodejs";
export const maxDuration = 300;

// ─────────────────────────────────────────────────────────────────────────────
// THE ONE DELIBERATE BRIDGE BETWEEN THE TWO DATABASES (phase 3 of the AI split).
//
// This file is the single allow-listed exception in scripts/check-db-boundaries.mjs: it may
// import both Prisma clients because its whole job is to COPY the TikTok-enabled clients from
// the agency database into the (empty) AI database, ids preserved. It never writes to the
// agency database — `agency` is only ever read. Delete this route once the copy is done.
//
//   GET  ?token=                 → the candidate clients (tiktokEnabled = true) with a row count
//                                  per related table, plus the relation graph. Read-only.
//   POST ?token=&confirm=1,2,3   → copy those clients (ids must match the candidate list exactly).
//                                  DISABLED: requires AI_CLIENT_COPY_ENABLED=1, which is unset.
//                                  Refuses unless the AI Client table is empty. Uses createMany
//                                  with skipDuplicates so a partial run can be resumed. Resets
//                                  every id sequence afterwards.
// ─────────────────────────────────────────────────────────────────────────────

type Rows = Record<string, any[]>;
const A = agency as any;

// Relation graph, in FK-safe insert order. `via` documents how each table is reached.
const GRAPH: { table: string; via: string }[] = [
  { table: "Workspace",              via: "Client.workspaceId → Workspace.id (only workspaces the copied clients belong to)" },
  { table: "Client",                 via: "root: tiktokEnabled = true" },
  { table: "InstagramConnection",    via: "clientId" },
  { table: "Creator",                via: "clientId, plus any Creator referenced by a copied WorkflowStage.assignedCreatorId" },
  { table: "TeamMember",             via: "clientId, plus members referenced by copied WorkflowStage.assignedToId, StageHistory.completedById, Notification.memberId, PushSubscription.memberId" },
  { table: "WorkflowStage",          via: "clientId, plus GLOBAL stages (clientId IS NULL), plus stages referenced by copied ScriptDraft.stageId / StageHistory.stageId" },
  { table: "Concept",                via: "clientId, plus GLOBAL concepts (clientId IS NULL), plus concepts referenced by copied drafts / pieces / videos / analytics / feedback / TikTokVideoConcept" },
  { table: "ConceptExample",         via: "conceptId ∈ copied Concepts" },
  { table: "Competitor",             via: "clientId" },
  { table: "CompetitorReel",         via: "competitorId ∈ copied Competitors" },
  { table: "CompetitorReelSnapshot", via: "reelId ∈ copied CompetitorReels" },
  { table: "CompetitorCandidate",    via: "clientId (no FK)" },
  { table: "ScriptDraft",            via: "clientId" },
  { table: "DraftNote",              via: "draftId ∈ copied ScriptDrafts" },
  { table: "DraftChange",            via: "draftId ∈ copied ScriptDrafts" },
  { table: "DraftReview",            via: "draftId ∈ copied ScriptDrafts" },
  { table: "ContentPiece",           via: "clientId" },
  { table: "StageHistory",           via: "contentId ∈ copied ContentPieces" },
  { table: "Notification",           via: "contentId ∈ copied ContentPieces" },
  { table: "TrackedVideo",           via: "clientId" },
  { table: "AnalyticsEntry",         via: "clientId" },
  { table: "DmLead",                 via: "clientId" },
  { table: "Message",                via: "clientId" },
  { table: "ConceptFeedback",        via: "clientId" },
  { table: "Board",                  via: "clientId" },
  { table: "ActivityEvent",          via: "clientId (no FK). Rows with clientId IS NULL (system-wide) are NOT copied" },
  { table: "ReelSnapshot",           via: "clientId (no FK)" },
  { table: "TikTokInstructions",     via: "clientId (no FK)" },
  { table: "TikTokVideoConcept",     via: "clientId (no FK)" },
  { table: "TikTokDailySnapshot",    via: "clientId (no FK)" },
  { table: "PushSubscription",       via: "clientId (member subs of copied clients) plus subscriberType = 'owner' (the owner's own devices, clientId IS NULL)" },
];

const model = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
const ids = (rows: any[], k = "id") => Array.from(new Set(rows.map((r) => r[k]).filter((v) => v != null)));
const inList = (list: any[]) => (list.length ? list : [-1]);

// Read every row that belongs to the given clients, following the graph above.
async function collect(clientIds: number[]): Promise<Rows> {
  const R: Rows = {};
  const cid = { in: inList(clientIds) };
  R.Client = await A.client.findMany({ where: { id: cid } });
  R.Workspace = await A.workspace.findMany({ where: { id: { in: inList(ids(R.Client, "workspaceId")) } } });
  R.InstagramConnection = await A.instagramConnection.findMany({ where: { clientId: cid } });

  // Client-keyed tables
  R.ScriptDraft = await A.scriptDraft.findMany({ where: { clientId: cid } });
  R.ContentPiece = await A.contentPiece.findMany({ where: { clientId: cid } });
  R.TrackedVideo = await A.trackedVideo.findMany({ where: { clientId: cid } });
  R.AnalyticsEntry = await A.analyticsEntry.findMany({ where: { clientId: cid } });
  R.DmLead = await A.dmLead.findMany({ where: { clientId: cid } });
  R.Message = await A.message.findMany({ where: { clientId: cid } });
  R.ConceptFeedback = await A.conceptFeedback.findMany({ where: { clientId: cid } });
  R.Board = await A.board.findMany({ where: { clientId: cid } });
  R.Competitor = await A.competitor.findMany({ where: { clientId: cid } });
  R.CompetitorCandidate = await A.competitorCandidate.findMany({ where: { clientId: cid } });
  R.ActivityEvent = await A.activityEvent.findMany({ where: { clientId: cid } });
  R.ReelSnapshot = await A.reelSnapshot.findMany({ where: { clientId: cid } });
  R.TikTokInstructions = await A.tikTokInstructions.findMany({ where: { clientId: cid } });
  R.TikTokVideoConcept = await A.tikTokVideoConcept.findMany({ where: { clientId: cid } });
  R.TikTokDailySnapshot = await A.tikTokDailySnapshot.findMany({ where: { clientId: cid } });

  // Children of children
  R.DraftNote = await A.draftNote.findMany({ where: { draftId: { in: inList(ids(R.ScriptDraft)) } } });
  R.DraftChange = await A.draftChange.findMany({ where: { draftId: { in: inList(ids(R.ScriptDraft)) } } });
  R.DraftReview = await A.draftReview.findMany({ where: { draftId: { in: inList(ids(R.ScriptDraft)) } } });
  R.StageHistory = await A.stageHistory.findMany({ where: { contentId: { in: inList(ids(R.ContentPiece)) } } });
  R.Notification = await A.notification.findMany({ where: { contentId: { in: inList(ids(R.ContentPiece)) } } });
  R.CompetitorReel = await A.competitorReel.findMany({ where: { competitorId: { in: inList(ids(R.Competitor)) } } });
  R.CompetitorReelSnapshot = await A.competitorReelSnapshot.findMany({ where: { reelId: { in: inList(ids(R.CompetitorReel)) } } });

  // Stages: client's own + global + any referenced (FK targets must exist on the new side)
  const stageRefs = [...ids(R.ScriptDraft, "stageId"), ...ids(R.StageHistory, "stageId"), ...ids(R.ContentPiece, "currentStageId")];
  R.WorkflowStage = await A.workflowStage.findMany({ where: { OR: [{ clientId: cid }, { clientId: null }, { id: { in: inList(stageRefs) } }] } });

  // Concepts: client's own + global + any referenced
  const conceptRefs = [
    ...ids(R.ScriptDraft, "conceptId"), ...ids(R.ContentPiece, "conceptId"), ...ids(R.TrackedVideo, "conceptId"),
    ...ids(R.AnalyticsEntry, "conceptId"), ...ids(R.ConceptFeedback, "conceptId"), ...ids(R.TikTokVideoConcept, "conceptId"),
  ];
  R.Concept = await A.concept.findMany({ where: { OR: [{ clientId: cid }, { clientId: null }, { id: { in: inList(conceptRefs) } }] } });
  R.ConceptExample = await A.conceptExample.findMany({ where: { conceptId: { in: inList(ids(R.Concept)) } } });

  // People: client's members + anyone referenced by copied rows; owner push subs
  R.PushSubscription = await A.pushSubscription.findMany({ where: { OR: [{ clientId: cid }, { subscriberType: "owner" }] } });
  const memberRefs = [
    ...ids(R.WorkflowStage, "assignedToId"), ...ids(R.StageHistory, "completedById"),
    ...ids(R.Notification, "memberId"), ...ids(R.PushSubscription, "memberId"),
  ];
  R.TeamMember = await A.teamMember.findMany({ where: { OR: [{ clientId: cid }, { id: { in: inList(memberRefs) } }] } });
  const creatorRefs = ids(R.WorkflowStage, "assignedCreatorId");
  R.Creator = await A.creator.findMany({ where: { OR: [{ clientId: cid }, { id: { in: inList(creatorRefs) } }] } });

  return R;
}

async function candidates() {
  return A.client.findMany({ where: { tiktokEnabled: true }, select: { id: true, name: true, workspaceId: true, tiktokHandle: true, tiktokZernioAccountId: true }, orderBy: { id: "asc" } });
}

export async function GET(req: NextRequest) {
  if (!isAdminToken(req.nextUrl.searchParams.get("token"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const cands = await candidates();
  const perClient: any[] = [];
  for (const c of cands) {
    const R = await collect([c.id]);
    const counts: Record<string, number> = {};
    for (const g of GRAPH) counts[g.table] = (R[g.table] ?? []).length;
    perClient.push({ id: c.id, name: c.name, tiktokHandle: c.tiktokHandle, zernioLinked: !!c.tiktokZernioAccountId, counts });
  }
  const all = await collect(cands.map((c: any) => c.id));
  const totals: Record<string, number> = {};
  for (const g of GRAPH) totals[g.table] = (all[g.table] ?? []).length;
  let aiClientCount: number | string = "unknown";
  try { aiClientCount = await (ai as any).client.count(); } catch (e) { aiClientCount = `AI DB not ready: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`; }
  return NextResponse.json({ candidates: perClient, totalsIfAllCopied: totals, graph: GRAPH, aiClientCount });
}

export async function POST(req: NextRequest) {
  if (!isAdminToken(req.nextUrl.searchParams.get("token"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // DISABLED BY DECISION (phase 3, 2026-09-24): the AI side starts empty; nothing is copied.
  // The copy path stays for the record but cannot run unless AI_CLIENT_COPY_ENABLED=1 is set
  // in the environment — it is unset, so this returns 403 before touching either database.
  if (process.env.AI_CLIENT_COPY_ENABLED !== "1") {
    return NextResponse.json({ error: "copy_disabled", message: "Client copy is disabled (AI_CLIENT_COPY_ENABLED is not set)." }, { status: 403 });
  }
  const confirm = (req.nextUrl.searchParams.get("confirm") || "").split(",").map((s) => parseInt(s.trim())).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  const cands = (await candidates()).map((c: any) => c.id).sort((a: number, b: number) => a - b);
  if (!confirm.length || JSON.stringify(confirm) !== JSON.stringify(cands)) {
    return NextResponse.json({ error: "confirm_mismatch", message: "confirm= must list exactly the current candidate ids", candidates: cands, got: confirm }, { status: 400 });
  }
  const existing = await (ai as any).client.count();
  if (existing > 0) return NextResponse.json({ error: "target_not_empty", aiClientCount: existing }, { status: 409 });

  const R = await collect(cands);
  const copied: Record<string, number> = {};
  for (const g of GRAPH) {
    const rows = R[g.table] ?? [];
    if (!rows.length) { copied[g.table] = 0; continue; }
    // Insert in chunks; ids preserved (the row objects carry their agency ids).
    let n = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const res = await (ai as any)[model(g.table)].createMany({ data: rows.slice(i, i + 500), skipDuplicates: true });
      n += res.count;
    }
    copied[g.table] = n;
  }
  // Sequences: the next autoincrement id must be above every preserved id.
  const seq: Record<string, string> = {};
  for (const g of GRAPH) {
    try {
      await (ai as any).$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('"${g.table}"', 'id'), COALESCE((SELECT MAX("id") FROM "${g.table}"), 0) + 1, false)`);
      seq[g.table] = "ok";
    } catch (e) { seq[g.table] = e instanceof Error ? e.message.split("\n")[0] : String(e); }
  }
  // Verify: counts on the new side per table for the copied clients.
  const verify: Record<string, { source: number; target: number }> = {};
  for (const g of GRAPH) verify[g.table] = { source: (R[g.table] ?? []).length, target: await (ai as any)[model(g.table)].count() };
  return NextResponse.json({ copied, sequences: seq, verify });
}
