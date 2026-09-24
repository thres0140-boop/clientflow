import { NextResponse } from "next/server";
import { prisma } from "@/shared/db/prisma";
import { syncClientPipeline } from "@/features/content/server/syncPipeline";

// Vercel Cron — runs on a schedule (see vercel.json).
// Keeps every connected client's DM pipeline + analytics in sync in the background,
// so detection isn't limited to when someone has a page open.
// Whole-function budget is 300s; each client gets a slice so one huge inbox can't starve the rest.
export const maxDuration = 300;

export async function GET() {
  const connections = await prisma.instagramConnection.findMany({
    where: { zernioAccountId: { not: null } },
    select: { clientId: true },
  });

  let created = 0, answered = 0, linked = 0;
  const perClient: any[] = [];
  const budgetMs = Math.max(20_000, Math.floor(240_000 / Math.max(1, connections.length)));
  for (const { clientId } of connections) {
    try {
      const r = await syncClientPipeline(clientId, { budgetMs });
      created += r.created; answered += r.answered; linked += r.linked;
      perClient.push({ clientId, total: r.total, scanned: r.scanned, pages: r.pages, truncated: r.truncated, budgetHit: r.budgetHit, created: r.created, unidentified: r.unidentified, unidentifiedWithId: r.unidentifiedWithId, skipped: r.skipped });
    } catch (e) {
      console.error(`[cron/sync-pipeline] client ${clientId} error:`, e);
    }
  }

  console.log(`[cron/sync-pipeline] done — ${created} created, ${answered} answered, ${linked} linked`);
  return NextResponse.json({ ok: true, clients: connections.length, created, answered, linked, budgetMsPerClient: budgetMs, perClient });
}
