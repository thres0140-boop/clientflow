import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/db/prisma";
import { isAdminToken } from "@/shared/auth/adminToken";
import { mirrorTablesExist, walkClient, mirrorSizes, labelStats } from "@/features/instagram/server/inboxMirror";

export const runtime = "nodejs";
export const maxDuration = 300;

// GET /api/admin/migrate/inbox-backfill?token=&clientId=<optional>
// Resumable backfill of the Instagram Inbox mirror: every conversation row, plus messages only
// for threads with unreadCount > 0 (just enough to set lastIncoming/OutgoingAt); cursor kept
// in ZernioSyncState. Call it again until every client reports done — the 15-minute reconcile
// cron also continues an unfinished backfill on its own. Returns real table sizes each time.
export async function GET(req: NextRequest) {
  if (!isAdminToken(req.nextUrl.searchParams.get("token"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await mirrorTablesExist())) return NextResponse.json({ error: "mirror_not_migrated", hint: "run ?inboxmirror=1 on /api/admin/migrate first" }, { status: 503 });

  const one = req.nextUrl.searchParams.get("clientId");
  const conns = await prisma.instagramConnection.findMany({ where: { zernioAccountId: { not: null }, ...(one ? { clientId: parseInt(one) } : {}) }, select: { clientId: true } });
  const budgetMs = Math.max(30_000, Math.floor(260_000 / Math.max(1, conns.length)));
  const results = [];
  for (const { clientId } of conns) {
    try { const r = await walkClient(clientId, { budgetMs, driftOnly: false }); results.push({ ...r, labels: await labelStats(clientId) }); }
    catch (e) { results.push({ clientId, error: e instanceof Error ? e.message : String(e) }); }
  }
  return NextResponse.json({ ok: true, budgetMsPerClient: budgetMs, results, sizes: await mirrorSizes() });
}
