// Canonical workflow stages per client per platform, and the seeder that makes a client's
// board match them. Used by POST /api/workflow/ensure-defaults (every Kanban load) and by
// PUT /api/clients/[id] when a platform is switched on, so Content Scheduling's lane for that
// platform has its stages before anyone opens the board.
import { prisma } from "@/shared/db/prisma";
import { logActivity } from "@/shared/activity";
import type { PlatformId } from "@/shared/agencyPlatforms";

type StageDef = { name: string; color: string; order: number };

// Instagram: Record → Edit → Final Check → Schedule. ("Check 1" was removed; see MERGE_INTO_FINAL_CHECK.)
const INSTAGRAM_STAGES: StageDef[] = [
  { name: "Record",       color: "#3b82f6", order: 1 },
  { name: "Edit",         color: "#f97316", order: 2 },
  { name: "Final Check",  color: "#a855f7", order: 3 },
  { name: "Schedule",     color: "#22c55e", order: 4 },
];

// YouTube: the same first three names on purpose. The Kanban keys behaviour on stage NAMES
// ("Edit" hosts raw-footage upload and "Open in editor", /check/i is a review stage) and Content
// Scheduling treats the last stage as the ready-to-post gate. The last stage is "Publish", not
// "Schedule": nothing schedules YouTube from ORDO, the owner uploads in YouTube Studio.
const YOUTUBE_STAGES: StageDef[] = [
  { name: "Record",       color: "#3b82f6", order: 1 },
  { name: "Edit",         color: "#f97316", order: 2 },
  { name: "Final Check",  color: "#a855f7", order: 3 },
  { name: "Publish",      color: "#ef4444", order: 4 },
];

export const DEFAULT_STAGES_BY_PLATFORM: Record<PlatformId, StageDef[]> = {
  instagram: INSTAGRAM_STAGES,
  tiktok: INSTAGRAM_STAGES,   // data-only in the agency app; keeps the pre-YouTube behaviour for stored rows
  youtube: YOUTUBE_STAGES,
};

// Stages that are MERGED into Final Check rather than dropped: the removed "Check 1" and the
// older lowercase "Check" it used to be renamed to. Their drafts and StageHistory rows move
// to Final Check, then the stage row is deleted. (Renaming instead would collide with an
// existing Final Check and leave two stages with the same name, which Kanban keys on.)
const MERGE_INTO_FINAL_CHECK = ["check 1", "check"];

const norm = (name: string) => name.trim().toLowerCase();

/** Make `clientId`'s `platform` board match its canonical stage list and return the stages in
 *  order (with assignees). Idempotent; safe to run concurrently. */
export async function ensureDefaultStages(clientId: number, platform: string) {
  const defaults = DEFAULT_STAGES_BY_PLATFORM[platform as PlatformId] ?? INSTAGRAM_STAGES;
  const standardNames = defaults.map((d) => norm(d.name));

  const existing = await prisma.workflowStage.findMany({ where: { clientId, platform } });

  // 1. Standard stages first: update order/colour if present, create if missing. This runs
  //    BEFORE any deletion so Final Check is guaranteed to exist when drafts are moved into it.
  for (const def of defaults) {
    const match = existing.find((s) => norm(s.name) === norm(def.name));
    if (match) {
      await prisma.workflowStage.update({ where: { id: match.id }, data: { order: def.order, color: def.color, name: def.name } });
    } else {
      const created = await prisma.workflowStage.create({
        data: { clientId, platform, name: def.name, color: def.color, order: def.order },
      });
      existing.push(created);
    }
  }

  // 2. Non-standard stages. Merge stages hand their drafts + history to Final Check; anything
  //    else is unassigned (as before). Moves and deletes run in ONE transaction so no other
  //    board load can observe a deleted stage with unmoved drafts (ScriptDraft.stageId is
  //    onDelete: SetNull and StageHistory.stageId is onDelete: Cascade — the delete must
  //    never run first). Both statements are idempotent, so concurrent loads are harmless.
  const nonStandard = existing.filter((s) => !standardNames.includes(norm(s.name)));
  if (nonStandard.length > 0) {
    const finalCheck = existing.find((s) => norm(s.name) === "final check")!;
    const mergeIds = nonStandard.filter((s) => MERGE_INTO_FINAL_CHECK.includes(norm(s.name))).map((s) => s.id);
    const dropIds = nonStandard.filter((s) => !MERGE_INTO_FINAL_CHECK.includes(norm(s.name))).map((s) => s.id);
    const results = await prisma.$transaction([
      ...(mergeIds.length ? [
        prisma.scriptDraft.updateMany({ where: { stageId: { in: mergeIds } }, data: { stageId: finalCheck.id } }),
        prisma.stageHistory.updateMany({ where: { stageId: { in: mergeIds } }, data: { stageId: finalCheck.id } }),
      ] : []),
      ...(dropIds.length ? [
        prisma.scriptDraft.updateMany({ where: { stageId: { in: dropIds } }, data: { stageId: null, status: "pending" } }),
      ] : []),
      prisma.workflowStage.deleteMany({ where: { id: { in: nonStandard.map((s) => s.id) } } }),
    ]);

    // 3. Report what the merge actually did, per client: to the function log (`vercel logs`)
    //    and, durably, as an ActivityEvent row so it can be read back later without a
    //    token-guarded route. Runs at most once per client+platform — the merged stage is
    //    gone afterwards, so the branch never fires again.
    if (mergeIds.length) {
      const [draftsMoved, historyMoved] = results as unknown as [{ count: number }, { count: number }];
      const merged = nonStandard.filter((s) => mergeIds.includes(s.id)).map((s) => `"${s.name}"(#${s.id})`).join(", ");
      const client = await prisma.client.findUnique({ where: { id: clientId }, select: { name: true } });
      const summary = `${merged} merged into "Final Check"(#${finalCheck.id}): ${draftsMoved.count} drafts moved, ${historyMoved.count} StageHistory rows re-pointed`;
      console.log(`[check1-merge] clientId=${clientId} client="${client?.name ?? "?"}" platform=${platform} ${summary}`);
      await logActivity({ clientId, actor: "System", type: "stage_moved", title: "Check 1 merged into Final Check", detail: `${platform}: ${summary}` });
    }
  }

  return prisma.workflowStage.findMany({
    where: { clientId, platform },
    orderBy: { order: "asc" },
    include: { assignedTo: true, assignedCreator: true },
  });
}
