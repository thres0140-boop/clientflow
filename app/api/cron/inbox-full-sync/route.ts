import { NextResponse } from "next/server";
import { prisma } from "@/shared/db/prisma";
import { mirrorTablesExist, walkClient } from "@/features/instagram/server/inboxMirror";

export const runtime = "nodejs";
export const maxDuration = 300;

// Vercel Cron, every 6 hours: the FULL walk. Follows the conversation cursor through every page
// (resumable across runs) and refetches messages only for drifted threads. Clients still in
// backfill are left to the 15-minute cron.
export async function GET() {
  if (!(await mirrorTablesExist())) return NextResponse.json({ ok: true, skipped: "mirror_not_migrated" });
  const conns = await prisma.instagramConnection.findMany({ where: { zernioAccountId: { not: null } }, select: { clientId: true } });
  const budgetMs = Math.max(20_000, Math.floor(240_000 / Math.max(1, conns.length)));
  const results = [];
  for (const { clientId } of conns) {
    try {
      const state = await prisma.zernioSyncState.findUnique({ where: { clientId } });
      if (!state || (state.phase !== "live" && state.phase !== "full")) { results.push({ clientId, skipped: "backfill_pending" }); continue; }
      results.push(await walkClient(clientId, { budgetMs, driftOnly: true }));
    } catch (e) { results.push({ clientId, error: e instanceof Error ? e.message : String(e) }); }
  }
  return NextResponse.json({ ok: true, budgetMsPerClient: budgetMs, results });
}
