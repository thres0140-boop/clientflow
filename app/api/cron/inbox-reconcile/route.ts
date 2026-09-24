import { NextResponse } from "next/server";
import { prisma } from "@/shared/db/prisma";
import { mirrorTablesExist, reconcileLight, walkClient } from "@/features/instagram/server/inboxMirror";

export const runtime = "nodejs";
export const maxDuration = 300;

// Vercel Cron, every 15 minutes: the LIGHT reconcile. Fetches only Zernio's newest page of
// conversations per client and refetches the newest messages of threads whose updatedTime is
// newer than the mirror. A client whose backfill has not finished gets the backfill continued
// instead, so the backlog drains without anyone calling the admin action repeatedly.
export async function GET() {
  if (!(await mirrorTablesExist())) return NextResponse.json({ ok: true, skipped: "mirror_not_migrated" });
  const conns = await prisma.instagramConnection.findMany({ where: { zernioAccountId: { not: null } }, select: { clientId: true } });
  const budgetMs = Math.max(20_000, Math.floor(240_000 / Math.max(1, conns.length)));
  const results = [];
  for (const { clientId } of conns) {
    try {
      const state = await prisma.zernioSyncState.findUnique({ where: { clientId } });
      const backfillPending = !state || state.phase !== "live";
      results.push(backfillPending ? await walkClient(clientId, { budgetMs, driftOnly: false }) : await reconcileLight(clientId, budgetMs));
    } catch (e) { results.push({ clientId, error: e instanceof Error ? e.message : String(e) }); }
  }
  return NextResponse.json({ ok: true, budgetMsPerClient: budgetMs, results });
}
